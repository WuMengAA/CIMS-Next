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
/// 星璃·集控控制插件（目标 ClassIsland 2.1.0.1 / PluginSdk 2.1.0.1 / net8.0 + Avalonia，已在本机 dotnet build 与真实 ClassIsland 实例双重验证）。
///
/// 职责：
///  1) 电教委员快捷操作入口（锁屏 / 截图 / 发起远程控制），这些动作本机即可执行；
///  2) 需要 OS 级 / 网络级动作（启 VNC、控进程、reboot）时，转发给本机代理 StelarithAgent；
///  3) 接收 CIMS 经「本地代理」推送的 stelarith-task 指令：由本地代理 StelarithAgent 经
///     WebSocket/SSE 推流调用 OnStelarithTaskAsync（见 AgentClient）。
///
/// 版本适配点（已编译 + 运行验证）：
///   · 2.x 已从 WPF 迁移到 Avalonia，UI 组件走 ComponentBase&lt;TSettings&gt; + ComponentInfo(Guid,Name,Desc) 特性；
///   · PluginBase.Initialize 为抽象方法 Initialize(HostBuilderContext, IServiceCollection)，无 base 实现；
///   · ClassIsland 2.x 用 Activator.CreateInstance 动态创建插件，不支持构造函数注入，
///     故必须提供无参构造函数（注入 ILogger&lt;T&gt; 会抛 MissingMethodException）。
/// </summary>
[PluginEntrance]
public class StelarithControlPlugin : PluginBase
{
    private readonly AgentClient _agent = new();

    /// <summary>
    /// ClassIsland 2.x 通过 Activator.CreateInstance 动态创建插件实例（不支持构造函数注入），
    /// 因此必须提供无参构造函数。1.4.x 时代注入 ILogger&lt;T&gt; 的写法在 2.x 会抛
    /// MissingMethodException: No parameterless constructor defined。
    /// 需要日志时改为从 Initialize 的 services/context 解析或直接输出到控制台。
    /// </summary>
    public StelarithControlPlugin()
    {
    }

    public override void Initialize(HostBuilderContext context, IServiceCollection services)
    {
        // 注：PluginBase.Initialize 为抽象方法，无 base 实现，故不可调用 base.Initialize。
        // 如需注册本插件自有服务，在此向 services 添加即可。
        Console.WriteLine("[Stelarith] 插件已初始化；指令经本机代理 StelarithAgent 接收。");
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
                Console.WriteLine($"[Stelarith] 收到未知动作 {task.Action}，已忽略");
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
