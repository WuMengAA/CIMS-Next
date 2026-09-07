using System;
using System.ComponentModel;
using System.Text.Json;
using System.Threading.Tasks;
using ClassIsland.Core;
using ClassIsland.Core.Abstractions;
using ClassIsland.Core.Attributes;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace StelarithControlPlugin;

/// <summary>
/// 星璃·集控控制插件（对齐 ClassIsland 真实公开插件 SDK 1.4.x 形态，已在本机 dotnet build 验证）。
///
/// 职责：
///  1) 电教委员快捷操作入口（锁屏 / 截图 / 发起远程控制），这些动作本机即可执行；
///  2) 需要 OS 级 / 网络级动作（启 VNC、控进程、reboot）时，转发给本机代理 StelarithAgent；
///  3) 接收 CIMS 经「本地代理」推送的 stelarith-task 指令：由本地代理 StelarithAgent 经
///     WebSocket/SSE 推流调用 OnStelarithTaskAsync（见 AgentClient）。
///
/// 版本适配点（目标 ClassIsland 1.4.3.1 / PluginSdk 1.4.3.1，已编译验证）：
///   · PluginBase.Initialize 为抽象方法 Initialize(HostBuilderContext, IServiceCollection)，无 base 实现；
///   · 服务经构造函数注入 IServiceProvider 获取；本插件未使用 INotificationHost（该类型不存在——
///     ClassIsland 通知服务为 INotificationHostService，仅提供 RegisterNotificationProvider，不暴露
///     "订阅全部到达通知"的事件），故指令接收不走通知订阅，改由本地代理推流。
/// </summary>
[PluginEntrance]
public class StelarithControlPlugin : PluginBase
{
    private readonly ILogger<StelarithControlPlugin> _logger;
    private readonly AgentClient _agent = new();

    public StelarithControlPlugin(ILogger<StelarithControlPlugin> logger)
    {
        _logger = logger;
    }

    public override void Initialize(HostBuilderContext context, IServiceCollection services)
    {
        // 注：PluginBase.Initialize 为抽象方法，无 base 实现，故不可调用 base.Initialize。
        // 如需注册本插件自有服务，在此向 services 添加即可。
        _logger.LogInformation("Stelarith: 插件已初始化；指令经本机代理 StelarithAgent 接收。");
        // TODO(集成): 在 AgentClient 中实现 WebSocket/SSE 接收循环，收到 stelarith-task 即调用 OnStelarithTaskAsync。
    }

    // ---- 指令接收（由本地代理推流调用）----
    /// <summary>由本地代理推流调用：解析 stelarith-task 并分发到本机动作或本地代理。</summary>
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
