using System;
using System.ComponentModel;
using System.Text.Json;
using System.Threading.Tasks;
using ClassIsland.Core;
using ClassIsland.Core.Abstractions;
using ClassIsland.Core.Attributes;
using Microsoft.Extensions.Logging;

namespace StelarithControlPlugin;

/// <summary>
/// 星璃·集控控制插件（对齐 ClassIsland 真实公开插件 SDK 形态）。
///
/// 职责：
///  1) 订阅 ClassIsland 通知服务，捕获 CIMS 经通知通道下发的 stelarith-task 指令；
///  2) 在本地执行轻量动作（锁屏 / 截图）或转发给本地代理 StelarithAgent 执行 OS 级动作；
///  3) 提供电教委员快捷操作入口（锁屏 / 截图 / 报修一键发起）。
///
/// 不直连任何虚构网关——所有"下令"都来自 CIMS 真实通知（经 ClassIsland 通知通道），
/// 所有"执行"都在本机（插件做轻动作，重动作交给本地代理）。
///
/// 版本适配点（本机无 .NET / ClassIsland SDK 环境，未编译验证；需在目标机
/// `dotnet build` 后部署。若目标 ClassIsland 版本以下符号有差异，按该版本源码调整）：
///   · using 命名空间：ClassIsland.Core / ClassIsland.Core.Abstractions / ClassIsland.Core.Attributes
///   · INotificationHost / NotificationReceived 事件
///   · Notification.MessageContent 字段名与类型
///   · PluginBase 提供的 GetService&lt;T&gt;() 解析入口
/// </summary>
[PluginEntrance]
public class StelarithControlPlugin : PluginBase
{
    private readonly ILogger<StelarithControlPlugin> _logger;
    private readonly AgentClient _agent = new();

    // 真实 ClassIsland 插件入口：通过构造函数注入 ILogger<T>（来自 PluginBase 基类）。
    public StelarithControlPlugin(ILogger<StelarithControlPlugin> logger)
    {
        _logger = logger;
    }

    public override void Initialize()
    {
        base.Initialize();

        // 真实集成点：通过 PluginBase.GetService<T>() 解析 ClassIsland 通知服务，
        // 订阅 NotificationReceived，捕获 CIMS 经通知下发的 stelarith-task。
        // 事件参数类型 / Notification.MessageContent 字段随 ClassIsland 版本，故用 dynamic
        // 安全提取，避免写死版本相关字段导致编译失败；解析失败仅忽略该条通知。
        try
        {
            var host = GetService<INotificationHost>();
            if (host is not null)
            {
                host.NotificationReceived += (_, e) =>
                {
                    try
                    {
                        dynamic dyn = e;
                        string? content = dyn?.Notification?.MessageContent?.ToString();
                        _ = OnStelarithTaskAsync(content ?? "");
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Stelarith: 解析通知内容失败，已忽略该条");
                    }
                };
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Stelarith: 订阅 ClassIsland 通知失败（可能 SDK 版本不匹配）");
        }
    }

    // ---- 通知 → 指令解析 ----
    /// <summary>由通知钩子调用：解析 stelarith-task 并分发到本地动作或本地代理。</summary>
    public async Task OnStelarithTaskAsync(string rawContent)
    {
        if (string.IsNullOrWhiteSpace(rawContent)) return;
        StelarithTask? task = TryParse(rawContent);
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
                await _agent.SendAsync(task);
                break;
            default:
                _logger.LogInformation("Stelarith: 收到未知动作 {Action}，已忽略", task.Action);
                break;
        }
    }

    private static StelarithTask? TryParse(string raw)
    {
        try
        {
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.TryGetProperty("stelarith_task", out var t))
                return JsonSerializer.Deserialize<StelarithTask>(t.GetRawText());
        }
        catch
        {
            // 非本插件指令（例如普通公告通知），忽略
        }
        return null;
    }

    // ---- 电教委员快捷操作入口（在 ClassIsland 设置页 / 组件面板挂载按钮调用）----
    // 真实挂载方式随版本：可实现 ISettingsPageProvider / IComponentProvider 或在设置页注册按钮，
    // 调用下方方法即可；此处仅声明行为，UI 绑定按目标 ClassIsland 版本接入。
    public void QuickLock() => OSActions.LockWorkStation();
    public void QuickScreenshot() => OSActions.CaptureScreen(
        Environment.GetFolderPath(Environment.SpecialFolder.MyPictures) + "\\stelarith_shot.png");
    public Task RequestRemoteControl() =>
        _agent.SendAsync(new StelarithTask { Action = "remote_control_start" });
}

/// <summary>CIMS 通知内约定的结构化指令（见 docs/扩展能力设计.md §1.2）。</summary>
public class StelarithTask
{
    public string Action { get; set; } = "";
    public string Token { get; set; } = "";
    public string Scope { get; set; } = "class";
    public long Ts { get; set; }
}
