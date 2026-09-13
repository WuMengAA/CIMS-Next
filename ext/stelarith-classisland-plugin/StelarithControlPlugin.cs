using System;
using System.Text.Json;
using System.Threading.Tasks;
using ClassIsland.Core;
using ClassIsland.Core.Abstractions;
using ClassIsland.Core.Abstractions.Services;
using ClassIsland.Core.Attributes;
using ClassIsland.Core.Extensions.Registry;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace StelarithControlPlugin;

/// <summary>
/// 星璃·集控控制插件（对齐 ClassIsland 真实公开插件 SDK 形态，实测 SDK 1.4.3.1）。
///
/// 职责：
///  1) 在 Initialize 中向宿主 DI 注册后台服务 StelarithCommandHost，由其在宿主启动后
///     解析 IManagementService 并订阅集控连接（IManagementServerConnection）的 CommandReceived 事件，
///     捕获 CIMS 经集控通道下发的 stelarith-task 指令（真实 SDK 下"收到命令"的唯一钩子）；
///  2) 在本地执行轻量动作（锁屏 / 截图）或转发给本地代理 StelarithAgent 执行 OS 级动作；
///  3) 注册官方提醒提供方 StelarithNotificationProvider，使集控下发的播报在教室大屏播放
///     （对齐官方集控 SendNotification 语义，见 StelarithNotificationProvider 注释）；
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
public class StelarithControlPlugin : PluginBase
{
    // 注意：ClassIsland 通过 Activator.CreateInstance 实例化插件入口类，要求无参构造函数，
    // 因此不能在构造函数中注入服务。日志等依赖请在 Initialize / 后台服务中通过 GetService<T>() 取得。

    /// <summary>
    /// 抽象方法重写：向宿主 DI 容器注册本插件所需的后台服务与自身（作为通知提供方）。
    /// 此时宿主尚未完全构建，故不直接取 IManagementService；交由 StelarithCommandHost 在启动后取得。
    /// </summary>
    public override void Initialize(HostBuilderContext context, IServiceCollection services)
    {
        // 主动同步（cshua）：后台定时从 CIMS 客户端应用拉取当前下发的课表/组件配置。
        // 配置可经插件目录下的 stelarith-sync.json 覆盖（见 StelarithSyncOptions.Load）。
        var syncOptions = StelarithSyncOptions.Load();
        services.AddSingleton(syncOptions);
        services.AddHostedService<StelarithSyncService>();
        // 命令轮询自取后台服务：周期拉取 CIMS 命令队列（command_queue），
        // 执行 stelarith_task / 触发配置刷新。绕开本机未激活集控时 gRPC 命令通道不触发的问题。
        services.AddHostedService<StelarithCommandPollerService>();
        services.AddHostedService<StelarithCommandHost>();
        // 集控面板入口（托盘右键菜单 / 设置侧边栏）
        services.AddHostedService<StelarithPanelService>();
        // 设置侧边栏：注册「星璃·集控面板」设置页（External 类别，含打开面板入口）
        services.AddSettingsPage<StelarithPanelSettingsPage>();
        // 官方提醒提供方：注册后宿主会在【应用设置】→【提醒】列出「星璃·集控」，
        // 集控下发的 SendNotification 可直接在教室大屏播放「遮罩 + 正文」。
        // 必须走这个官方扩展方法——它会先把 [NotificationProviderInfo] 写入
        // NotificationProviderRegistryService，否则 NotificationProviderBase 的构造函数会抛异常。
        services.AddNotificationProvider<StelarithNotificationProvider>();
    }

    // ---- 电教委员快捷操作入口（在 ClassIsland 设置页 / 组件面板挂载按钮调用）----
    public Task QuickLock() => StelarithDispatch.RunAsync(new StelarithTask { Action = "lock" });
    public Task QuickScreenshot() => StelarithDispatch.RunAsync(new StelarithTask { Action = "screenshot" });
    public Task RequestRemoteControl() => StelarithDispatch.RunAsync(new StelarithTask { Action = "remote_control_start" });
    // 提醒提供方（INotificationProvider）已移至 StelarithNotificationProvider，
    // 由 services.AddNotificationProvider<T>() 注册，具备真正的推送能力。
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

    // 集控面板下发的载荷字段为小写（action/token/scope/ts），而 StelarithTask 属性是 PascalCase。
    // System.Text.Json 默认大小写敏感，不开这个开关会反序列化出 Action="" —— 表现为
    // 「指令下发成功 200，但设备端毫无反应」。必须显式开启。
    private static readonly JsonSerializerOptions TaskJson = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    /// <summary>解析集控命令载荷中的 stelarith_task 片段；非本插件指令返回 null。</summary>
    public static StelarithTask? Parse(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        try
        {
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.TryGetProperty("stelarith_task", out var t))
                return JsonSerializer.Deserialize<StelarithTask>(t.GetRawText(), TaskJson);
        }
        catch
        {
            // 非本插件指令（例如普通集控命令），忽略
        }
        return null;
    }

    /// <summary>
    /// 从命令队列载荷中提取 stelarith_task。兼容两种打包位置：
    ///   1) 载荷根级含 "stelarith_task"（如轮询直接填的任务原文）；
    ///   2) SendNotification 的 NotificationPayload —— stelarith_task 打包在其
    ///      MessageContent 字段内（面板经 send-notification 下发的形态）。
    /// 均取不到则返回 null。
    /// </summary>
    public static StelarithTask? ExtractTask(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        // 直接根级解析
        var direct = Parse(raw);
        if (direct is not null) return direct;
        // 兼容 NotificationPayload.MessageContent 内嵌
        try
        {
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.ValueKind == JsonValueKind.Object &&
                doc.RootElement.TryGetProperty("MessageContent", out var mc) &&
                mc.ValueKind == JsonValueKind.String)
            {
                var nestedValue = mc.GetString();
                if (nestedValue is not null)
                {
                    var nested = Parse(nestedValue);
                    if (nested is not null) return nested;
                }
            }
        }
        catch
        {
            // 忽略，返回 null
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
