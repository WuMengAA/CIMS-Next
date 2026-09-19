using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using ClassIsland.Core.Abstractions.Services;
using ClassIsland.Core.Abstractions.Services.Management;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace StelarithControlPlugin;

/// <summary>
/// 宿主启动后运行的后台服务：取得已构建的 IManagementService，订阅集控命令通道。
///
/// 命令到达时提取官方 CommandTypes（Type 数值枚举）+ 载荷（SendNotification 的 protobuf
/// 二进制），交 StelarithCommandHandler 统一处理——官方四种命令语义
/// （RestartApp / SendNotification / DataUpdated / GetClientConfig）与既有 stelarith_task
/// 原生指令均在此覆盖，与轮询通道共用同一处理器，保证语义一致。
///
/// 事件参数载荷字段名随 ClassIsland 版本变化，故用 dynamic 安全提取（仅依赖集合内公认的
/// Type / Payload 成员），避免写死字段导致编译失败。
///
/// 健壮性：宿主把各插件的 IHostedService 集中在同一个 Host 里顺序 StartAsync，
/// 若前面某个插件（实测 AIIsland）抛异常，整个序列会中断，本服务的 ExecuteAsync 就永远不会执行。
/// 因此订阅改为**静态构造函数拉起的守护线程**重试完成，不依赖宿主生命周期；
/// 诊断写文件（ste-cmdhost-diag.log），不依赖宿主 logger。
/// </summary>
public class StelarithCommandHost : BackgroundService
{
    private static ILogger? _staticLogger;
    private static IManagementService? _staticManagement;
    private static IServiceProvider? _staticServices;
    private static readonly object SubLock = new();

    /// <summary>命令通道是否已订阅成功（幂等标记）。</summary>
    private static bool _subscribed;

    /// <summary>
    /// ⚠️ 构造函数**不得**直接注入 <c>IManagementService</c>。
    ///
    /// 为什么：ClassIsland 在启动期会解析并构造所有插件的 IHostedService。
    /// 本机集控**未启用**（Management/Settings.json 的 IsManagementEnabled=false）时，
    /// <c>IManagementService</c> 可能无法解析 —— 构造函数抛异常会让宿主的
    /// <c>Host.StartAsync</c> 整个中断，表现为「进程在跑、AppStarted 永不触发、主界面不创建」。
    /// （实测：把本插件移出后可正常启动；装回即卡住。）
    ///
    /// 因此这里只注入**总是可解析**的 <c>IServiceProvider</c>，把 IManagementService
    /// 推迟到守护线程里用 GetService 惰性拿取，拿不到就静默重试，绝不阻断宿主启动。
    /// </summary>
    public StelarithCommandHost(ILogger<StelarithCommandHost> logger, IServiceProvider services)
    {
        _staticLogger = logger;
        _staticServices = services;
        _staticManagement = services.GetService(typeof(IManagementService)) as IManagementService;
        CmdHostDiag("ctor: 已注入 IServiceProvider（IManagementService 惰性解析，解析结果="
                    + (_staticManagement is null ? "null（集控可能未启用）" : "OK") + "）");
    }

    static StelarithCommandHost()
    {
        CmdHostDiag("static ctor: 拉起守护订阅线程");

        var t = new Thread(() =>
        {
            try
            {
                // 集控连接可能晚于插件加载建立，重试 5 分钟；成功订阅后立即退出
                var deadline = DateTime.UtcNow.AddMinutes(5);
                while (!_subscribed && DateTime.UtcNow < deadline)
                {
                    try { TrySubscribe(); }
                    catch (Exception ex) { CmdHostDiag("guard loop exception: " + ex.Message); }
                    if (_subscribed) break;
                    Thread.Sleep(2000);
                }
                if (!_subscribed) CmdHostDiag("guard: 超时仍未订阅（设备可能未加入集控）");
            }
            catch (Exception ex)
            {
                CmdHostDiag("guard thread fatal: " + ex);
            }
        })
        {
            IsBackground = true,
            Name = "stelarith-cmdhost-guard",
        };
        t.Start();
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // 先让出控制权：TrySubscribe() 内含同步解析/订阅，绝不能在宿主 StartAsync 的同步段里跑。
        await Task.Yield();

        // 宿主若能正常启动本服务，则立即尝试一次（与守护线程互斥，重复订阅由 _subscribed 挡掉）
        TrySubscribe();
    }

    /// <summary>订阅集控命令通道（幂等）。连接尚未建立时静默返回，由守护线程稍后重试。</summary>
    private static void TrySubscribe()
    {
        if (_subscribed) return;

        // 惰性解析：集控可能在插件构造之后才启用/建立连接，故每轮重试时再解析一次。
        // 解析不到就静默返回，由守护线程稍后重试 —— 绝不抛异常（异常会中断宿主启动）。
        try
        {
            _staticManagement ??= _staticServices?.GetService(typeof(IManagementService)) as IManagementService;
        }
        catch (Exception ex)
        {
            CmdHostDiag("解析 IManagementService 失败（忽略）: " + ex.Message);
        }

        var conn = _staticManagement?.Connection;
        if (conn is null)
        {
            // 设备可能尚未加入集控或连接尚未建立；不写文件刷屏，由守护线程重试
            return;
        }

        lock (SubLock)
        {
            if (_subscribed) return;
            conn.CommandReceived += OnCommandReceived;
            _subscribed = true;
        }

        CmdHostDiag("已订阅集控命令通道 CommandReceived");
        _staticLogger?.LogInformation("Stelarith: 已订阅集控命令通道 CommandReceived（官方 CommandTypes 语义）");
    }

    private static void OnCommandReceived(object? sender, object e)
    {
        try
        {
            var handler = _staticLogger is null
                ? new StelarithCommandHandler(Microsoft.Extensions.Logging.Abstractions
                    .NullLogger<StelarithCommandHost>.Instance)
                : new StelarithCommandHandler(_staticLogger);

            // dynamic 安全提取命令载荷，避免写死版本相关字段名导致编译失败。
            dynamic dyn = e;
            int type = 0;
            object? typeObj = SafeObj(dyn?.Type) ?? SafeObj(dyn?.Command?.Type);
            if (typeObj is not null && int.TryParse(typeObj.ToString(), out var parsed))
                type = parsed;

            // Payload：SendNotification 在 gRPC 通道为 protobuf 二进制（byte[]）。
            // 原样传给处理器，由其反解 wire 格式提取 MessageContent/stelarith_task。
            byte[]? raw = GetRawBytes(dyn?.Payload) ?? GetRawBytes(dyn?.Command?.Payload);
            string? action = SafeStr(dyn?.Action);

            if (type == 0 && raw is null && !string.IsNullOrWhiteSpace(action))
                raw = System.Text.Encoding.UTF8.GetBytes(action);

            CmdHostDiag($"gRPC 命令到达: type={type} payloadBytes={raw?.Length ?? 0}");
            _ = handler.HandleRawAsync(type, raw, CancellationToken.None);
        }
        catch (Exception ex)
        {
            CmdHostDiag("解析/执行集控命令失败: " + ex.Message);
        }
    }

    private static string? SafeStr(object? o) => o?.ToString();

    private static object? SafeObj(object? o) => o;

    /// <summary>把动态载荷原始值转 byte[]（protobuf 二进制的 SendNotification payload 为 byte[]）。</summary>
    private static byte[]? GetRawBytes(object? o)
    {
        if (o is null) return null;
        return o switch
        {
            byte[] b => b,
            string s => System.Text.Encoding.UTF8.GetBytes(s),
            _ => null,
        };
    }

    /// <summary>文件诊断：写 AppContext.BaseDirectory/ste-cmdhost-diag.log。</summary>
    internal static void CmdHostDiag(string msg)
    {
        try
        {
            File.AppendAllText(
                Path.Combine(AppContext.BaseDirectory, "ste-cmdhost-diag.log"),
                $"{DateTime.Now:HH:mm:ss.fff} {msg}{Environment.NewLine}");
        }
        catch { /* 诊断写入失败忽略 */ }
    }
}
