using System;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using ClassIsland.Core.Abstractions.Services;
using ClassIsland.Core.Abstractions.Services.Management;
using ClassIsland.Shared.Abstraction.Services;
using ClassIsland.Shared.Interfaces;
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
/// </summary>
public class StelarithCommandHost : BackgroundService
{
    private readonly ILogger<StelarithCommandHost> _logger;
    private readonly IManagementService _management;
    private readonly INotificationHostService? _notificationHost;
    private readonly INotificationProvider _provider;
    private readonly StelarithCommandHandler _handler;

    public StelarithCommandHost(
        ILogger<StelarithCommandHost> logger,
        IManagementService management,
        INotificationHostService? notificationHost,
        INotificationProvider provider)
    {
        _logger = logger;
        _management = management;
        _notificationHost = notificationHost;
        _provider = provider;
        _handler = new StelarithCommandHandler(logger);
    }

    protected override Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // 订阅集控命令通道
        var conn = _management.Connection;
        if (conn is not null)
        {
            // lambda 订阅：编译器自动推断事件参数为 ClientCommandEventArgs，无需显式 using 其命名空间
            conn.CommandReceived += (_, e) =>
            {
                try
                {
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

                    // 处理器对 SendNotification 解析二进制；其余命令按字符串视图分派
                    _ = _handler.HandleRawAsync(type, raw, stoppingToken);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Stelarith: 解析/执行集控命令失败，已忽略该条");
                }
            };
            _logger.LogInformation("Stelarith: 已订阅集控命令通道 CommandReceived（官方 CommandTypes 语义）");
        }
        else
        {
            // 设备可能尚未加入集控或连接尚未建立；记录待后续排查（连接就绪后由宿主重连触发）。
            _logger.LogWarning("Stelarith: 集控连接暂不可用，命令通道未订阅（设备可能未加入集控）");
        }

        // 注册为通知提供方（展示侧），使星璃指令出现在 ClassIsland 通知中心
        try
        {
            _notificationHost?.RegisterNotificationProvider(_provider);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Stelarith: 注册通知提供方失败（不影响命令执行）");
        }

        return Task.CompletedTask;
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
}