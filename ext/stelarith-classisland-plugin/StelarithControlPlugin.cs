using System;
using System.Text.Json;
using System.Threading.Tasks;
using ClassIsland.Core;
using ClassIsland.Core.Abstractions;
using ClassIsland.Core.Abstractions.Services;
using ClassIsland.Core.Attributes;
using ClassIsland.Shared.Interfaces;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace StelarithControlPlugin;

/// <summary>
/// 星璃·集控控制插件（对齐 ClassIsland 真实公开插件 SDK 形态，实测 SDK 1.4.3.1）。
///
/// 职责：
///  1) 在 Initialize 中向宿主 DI 注册后台服务 StelarithCommandHost，由其在宿主启动后
///     解析 IManagementService 并订阅集控连接（IManagementServerConnection）的 CommandReceived 事件，
///     捕获 CIMS 经集控通道下发的 stelarith-task 指令（真实 SDK 下"收到命令"的唯一钩子）；
///  2) 在本地执行轻量动作（锁屏 / 截图）或转发给本地代理 StelarithAgent 执行 OS 级动作；
///  3) 注册为 INotificationProvider，使星璃指令出现在 ClassIsland 通知中心（展示侧）；
///  4) 提供电教委员快捷操作入口（锁屏 / 截图 / 一键远程控制）。
///
/// 不直连任何虚构网关——所有"下令"都来自 CIMS 真实集控通道，所有"执行"都在本机。
///
/// 真实 API 适配点（已对齐 SDK 1.4.3.1 实编验证）：
///   · PluginBase.Initialize(HostBuilderContext, IServiceCollection) 为抽象方法，必须重写；
///     服务注册放此处，宿主启动后由 IHostedService 取得已构建的服务。
///   · 命令接收：IManagementService.Connection(IManagementServerConnection).CommandReceived
///     （EventHandler&lt;ClientCommandEventArgs&gt;）。
///   · 通知展示：INotificationHostService.RegisterNotificationProvider(INotificationProvider)。
///   · 命令事件参数字段随 ClassIsland 版本，故用 dynamic 安全提取，避免写死字段名导致编译失败。
/// </summary>
[PluginEntrance]
public class StelarithControlPlugin : PluginBase, INotificationProvider
{
    private readonly ILogger<StelarithControlPlugin> _logger;

    // 真实 ClassIsland 插件入口：通过构造函数注入 ILogger<T>（来自 PluginBase 基类）。
    public StelarithControlPlugin(ILogger<StelarithControlPlugin> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// 抽象方法重写：向宿主 DI 容器注册本插件所需的后台服务与自身（作为通知提供方）。
    /// 此时宿主尚未完全构建，故不直接取 IManagementService；交由 StelarithCommandHost 在启动后取得。
    /// </summary>
    public override void Initialize(HostBuilderContext context, IServiceCollection services)
    {
        services.AddHostedService<StelarithCommandHost>();
        services.AddSingleton<INotificationProvider>(this);
    }

    // ---- 电教委员快捷操作入口（在 ClassIsland 设置页 / 组件面板挂载按钮调用）----
    public Task QuickLock() => StelarithDispatch.RunAsync(new StelarithTask { Action = "lock" });
    public Task QuickScreenshot() => StelarithDispatch.RunAsync(new StelarithTask { Action = "screenshot" });
    public Task RequestRemoteControl() => StelarithDispatch.RunAsync(new StelarithTask { Action = "remote_control_start" });

    // ---- INotificationProvider 实现（注册为通知提供方，展示侧）----
    public string Name { get; set; } = "星璃·集控";
    public string Description { get; set; } = "星璃多媒体统一集控指令通道";
    public Guid ProviderGuid { get; set; } = new Guid("9f1c2b3a-4d5e-6f7a-8b9c-0d1e2f3a4b5c");
    public object? SettingsElement { get; set; }
    public object? IconElement { get; set; }
}

/// <summary>CIMS 集控命令内约定的结构化指令（见 docs/扩展能力设计.md §1.2）。</summary>
public class StelarithTask
{
    public string Action { get; set; } = "";
    public string Token { get; set; } = "";
    public string Scope { get; set; } = "class";
    public long Ts { get; set; }
}

/// <summary>
/// 指令分发：本地轻动作（锁屏/截图）与转发本地代理（远程/VNC/Shell/重启）的唯一实现处。
/// 插件快捷操作与后台命令服务共用，避免逻辑重复。
/// </summary>
public static class StelarithDispatch
{
    private static readonly AgentClient Agent = new();

    /// <summary>解析集控命令载荷中的 stelarith_task 片段；非本插件指令返回 null。</summary>
    public static StelarithTask? Parse(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        try
        {
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.TryGetProperty("stelarith_task", out var t))
                return JsonSerializer.Deserialize<StelarithTask>(t.GetRawText());
        }
        catch
        {
            // 非本插件指令（例如普通集控命令），忽略
        }
        return null;
    }

    /// <summary>执行一条指令：本地轻动作或转发本地代理。</summary>
    public static async Task RunAsync(StelarithTask? task)
    {
        if (task is null) return;
        switch (task.Action)
        {
            case "lock":
                OSActions.LockWorkStation();
                break;
            case "screenshot":
                OSActions.CaptureScreen(Environment.GetFolderPath(
                    Environment.SpecialFolder.MyPictures) + "\\stelarith_shot.png");
                break;
            // 需要 OS 级 / 网络级动作的，一律交给本地代理（它才有权限启 VNC、控进程、验签）
            case "remote_control_start":
            case "remote_control_stop":
            case "shell":
            case "reboot":
                await Agent.SendAsync(task);
                break;
            default:
                break;
        }
    }
}
