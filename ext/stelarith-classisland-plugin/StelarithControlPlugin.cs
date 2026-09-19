using System;
using System.IO;
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
    /// 静态构造函数：插件类型被触达的最早时刻，做两件"越早越好"的事 ——
    ///   ① <b>防关闭守卫</b>：关掉宿主的自动禁用插件开关。宿主在加载阶段就会根据
    ///      `AutoDisableCorruptPlugins` 决定要不要禁用坏插件，晚于加载就来不及了；
    ///   ② 记录一条"插件确实被加载了"的证据（用于区分「插件没被加载」与「插件加载了但没干活」，
    ///      这两种故障的现象完全不同，排查时第一步就要分清）。
    /// 全程不抛异常：静态构造函数抛异常会让类型彻底不可用，是最严重的失败方式。
    /// </summary>
    static StelarithControlPlugin()
    {
        // 只记一条「插件确实被加载」的证据（用于区分「没加载」与「加载了没干活」）。
        // ⚠️ 已移除原「防关闭守卫」（HostGuard）：它在插件类型被触达的最早时刻同步改写
        //    宿主 Settings.json，与 ClassIsland 自身读写设置文件抢文件/写坏，
        //    是「ClassIsland 后台运行、前台界面打不开」的高度嫌疑点。
        //    该项防护改由桌面客户端在启动 ClassIsland **之前**处理。
        try { DiagBridge("static ctor: 插件类型已触达"); }
        catch { /* 静态构造函数绝不抛异常 */ }
    }

    /// <summary>
    /// 抽象方法重写：向宿主 DI 容器注册本插件所需的后台服务与自身（作为通知提供方）。
    /// 此时宿主尚未完全构建，故不直接取 IManagementService；交由 StelarithCommandHost 在启动后取得。
    /// </summary>
    public override void Initialize(HostBuilderContext context, IServiceCollection services)
    {
        // 按 ClassIsland 官方规范，把本插件设置放在宿主提供的 PluginConfigFolder 下
        // （官方 PluginBase 文档：「插件的各项设置应当存放在此目录中」）。
        // 放插件安装目录的坏处：插件升级/重装会覆盖安装目录 → 设置丢失。
        try
        {
            StelarithSyncOptions.ConfigDir = PluginConfigFolder;
            StelarithLog.ConfigDir = PluginConfigFolder;
            DiagBridge("Initialize: 插件设置目录 -> " + PluginConfigFolder);
        }
        catch (Exception ex)
        {
            DiagBridge("Initialize: 解析 PluginConfigFolder 失败（回落程序集目录）：" + ex.Message);
        }

        // 把宿主的 IServiceProvider 登记给反射定位器：档案服务（ClassIsland.Services.ProfileService）
        // 只挂在宿主容器上，插件若不去容器里取，就永远拿不到 Profile 对象（写回只能降级）。
        // 这里用「构建后再取」的惰性登记——BuildServiceProvider 的返回值即为宿主根容器。
        services.AddSingleton<StelarithServiceProviderBridge>();

        // 主动同步（cshua）：后台定时从 CIMS 客户端应用拉取当前下发的课表/组件配置。
        // 配置可经插件目录下的 stelarith-sync.json 覆盖（见 StelarithSyncOptions.Load）。
        var syncOptions = StelarithSyncOptions.Load();
        services.AddSingleton(syncOptions);

        // 配置一读到就让两个「运行时单例」生效（它们各自持有守护线程/缓存）：
        //   · 来源名 —— 播报标题上显示的发送方，默认「集控广播」
        //   · 点歌看板 —— 上岛组件的唯一数据源（集控推送优先，其次直连点歌站）
        try
        {
            StelarithBranding.Apply(syncOptions);
            StelarithSongBoard.Configure(syncOptions);
        }
        catch (Exception ex)
        {
            DiagBridge("运行时单例配置异常（已忽略）：" + ex.Message);
        }

        services.AddHostedService<StelarithSyncService>();
        // 命令轮询自取后台服务：周期拉取 CIMS 命令队列（command_queue），
        // 执行 stelarith_task / 触发配置刷新。绕开本机未激活集控时 gRPC 命令通道不触发的问题。
        services.AddHostedService<StelarithCommandPollerService>();
        services.AddHostedService<StelarithCommandHost>();
        // 集控面板入口（托盘右键菜单 / 设置侧边栏）
        services.AddHostedService<StelarithPanelService>();
        // 状态心跳上报：把本机真实状态（在线/班级/版本/模块开关/插件清单）回报给 CIMS，
        // 面板「设备状态真实显示」的数据源就是它。
        services.AddHostedService<StelarithStatusReporter>();
        // 设置侧边栏：注册「星璃·集控」设置页（内嵌面板：状态 + 快捷入口 + 模块开关）
        services.AddSettingsPage<StelarithPanelSettingsPage>();
        // 设置侧边栏：注册「星璃·最近消息」消息页（岛内查看最近广播/通知，只读拉取）
        services.AddSettingsPage<StelarithMessagePage>();
        // 官方提醒提供方：注册后宿主会在【应用设置】→【提醒】列出本通道，
        // 集控下发的 SendNotification 可直接在教室大屏播放「遮罩 + 正文」。
        // 必须走这个官方扩展方法——它会先把 [NotificationProviderInfo] 写入
        // NotificationProviderRegistryService，否则 NotificationProviderBase 的构造函数会抛异常。
        services.AddNotificationProvider<StelarithNotificationProvider>();

        // ---- 上岛组件（可选，用户在【主界面排版】里手动添加；注册不强制渲染）----
        // 三个 ClassIsland 主界面小组件：正在播放 / 点歌名单 / 集控状态（含 StelarithIslandSettings）。
        // 严格遵循官方组件铁律：字号取宿主动态资源、前景色不设、UI 线程 marshal、卸载即停定时器，
        // 绝不阻塞宿主启动。组件渲染在用户排版时按需实例化，不会拖垮 AppStarted。
        services.AddComponent<StelarithNowPlayingComponent, StelarithIslandSettings>();
        services.AddComponent<StelarithSongQueueComponent, StelarithIslandSettings>();
        services.AddComponent<StelarithStatusComponent, StelarithIslandSettings>();
    }

    /// <summary>
    /// 插件级文件诊断（写 <c>ste-plugin-diag.log</c>）。
    /// 宿主 logger 在插件存活兜底场景下可能已 Dispose，故一律走文件。
    /// </summary>
    internal static void DiagBridge(string msg)
    {
        try
        {
            StelarithLog.Write("ste-plugin-diag.log", msg);
        }
        catch
        {
            // 诊断写失败忽略
        }
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

    /// <summary>
    /// 切班用：目标课表群 GUID（set_active_class 动作）。
    ///
    /// ⚠️ 必须显式标注 JSON 名：CIMS 侧打包用的是 **snake_case**（`group_id`），
    /// 而 System.Text.Json 的 `PropertyNameCaseInsensitive` 只忽略**大小写**，
    /// **不会**把 `group_id` 映射到 `GroupId`（下划线是结构性差异，不是大小写差异）。
    /// 不标这个特性时反序列化会静默得到 null —— 表现为「指令收到、ACK 成功，
    /// 但切班总是失败：未找到群 guid= name=」，极难排查。
    /// </summary>
    [System.Text.Json.Serialization.JsonPropertyName("group_id")]
    public string? GroupId { get; set; }

    /// <summary>切班用：目标课表群名称，如「3班课表群」（set_active_class 动作）。同样需显式映射。</summary>
    [System.Text.Json.Serialization.JsonPropertyName("group_name")]
    public string? GroupName { get; set; }

    // ---- 功能模块开关（set_module 动作）----
    // 面板可以把「要改哪个模块」写成单个字段，也可以整批下发（modules 字典）。
    // 同样必须显式标注 JSON 名：集控侧打包用小写，且 System.Text.Json 的大小写不敏感
    // 只解决大小写、解决不了结构性差异。

    /// <summary>单个模块 id（如 sync / os_actions）。</summary>
    [System.Text.Json.Serialization.JsonPropertyName("module")]
    public string? Module { get; set; }

    /// <summary>该模块的目标状态。</summary>
    [System.Text.Json.Serialization.JsonPropertyName("enabled")]
    public bool? Enabled { get; set; }

    /// <summary>批量开关：{moduleId: enabled}。</summary>
    [System.Text.Json.Serialization.JsonPropertyName("modules")]
    public System.Collections.Generic.Dictionary<string, bool>? Modules { get; set; }

    // ---- 未知字段透传（摄像头 / 媒体动作的参数走这里）----
    //
    // 为什么需要它：摄像头抓拍/录像/媒体调取这类动作的参数是**开放集合**
    // （camera / kind / name / params{kbps, scale, segment_seconds, retention_days…}），
    // 而它们对插件而言只是"要转交给本地代理的行李"——插件既不解读、也不校验。
    // 逐个加属性意味着：每加一个可调参数就要改一次插件、重新出包、全教室升级；
    // 而这些参数本来只跟"面板 ↔ 代理"有关，插件不该成为它们的版本瓶颈。
    //
    // [JsonExtensionData] 让 System.Text.Json 把未识别的字段原样收下，
    // 序列化时又原样写回根级 —— 正好是"透明转发"这个语义。
    //
    // ⚠️ 这不等于把通道放开：真正的动作白名单在插件的 switch（RunAsync）与代理的
    // execute 里，且代理仍要验签。透传只影响"同一条已授权指令带什么参数"。
    [System.Text.Json.Serialization.JsonExtensionData]
    public System.Collections.Generic.Dictionary<string, System.Text.Json.JsonElement>? Extra { get; set; }
}

/// <summary>
/// 宿主 DI 容器桥：本类型被注册为单例，构造时即拿到宿主的 IServiceProvider
/// （单例构造发生在容器构建后，因此这里是「取根容器」的安全时机），
/// 立即转交 StelarithReflection 用于定位档案服务。
///
/// 为什么需要它：插件对宿主的 DI 访问只有三种时机——Initialize（服务未构建）、
/// 自己的 HostedService 构造（能注入 IServiceProvider，但启动序列可能被其它插件中断）、
/// 静态守护线程（无任何 DI 上下文）。用「单例构造」这个时机最可靠且不影响启动。
/// </summary>
public sealed class StelarithServiceProviderBridge
{
    public StelarithServiceProviderBridge(IServiceProvider sp)
    {
        try
        {
            StelarithReflection.RegisterProvider(sp);
        }
        catch (Exception ex)
        {
            StelarithControlPlugin.DiagBridge("Bridge ctor failed: " + ex.Message);
        }
    }
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
    // 注意：CaseInsensitive 只解决**大小写**差异，解决不了 group_id 这种**下划线**差异，
    // 后者靠 StelarithTask 上的 [JsonPropertyName] 显式映射。
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
    /// 解析一条**裸任务对象**（根级就是任务字段，没有 stelarith_task 外壳）。
    /// 供 <see cref="StelarithCommandHandler"/> 处理「直接把任务当载荷」的历史形态。
    /// </summary>
    public static StelarithTask? ParseBare(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        try
        {
            return JsonSerializer.Deserialize<StelarithTask>(raw, TaskJson);
        }
        catch
        {
            return null;
        }
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
            // 锁屏 / 截屏：本机 OS 级动作，**改由桌面客户端（本地代理）执行**。
            // 插件不再内联调用 OS API —— 减少插件面、避免在宿主进程里做高危动作。
            case "lock":
                if (!RequireModule(StelarithModules.OsActions, "锁屏")) break;
                await ForwardToAgentAsync(task, "锁屏");
                break;
            case "screenshot":
                if (!RequireModule(StelarithModules.OsActions, "截屏")) break;
                await ForwardToAgentAsync(task, "截屏");
                break;
            // 切班：把本机档案的「当前激活课表群」切到指定班级（集控通道下发不了
            // SelectedClassPlanGroupId，只能由本地插件改档案）。见 StelarithProfileWriter。
            case "set_active_class":
            case "switch_class":
                // 切班是纪律相关动作（考试期间不希望被打断）→ 单独一个模块可控。
                if (!RequireModule(StelarithModules.ClassSwitch, "远程切班")) break;
                StelarithReflection.EnsureResolved();
                var r = StelarithProfileWriter.SetActiveClassGroup(task.GroupId, task.GroupName);
                StelarithProfileWriter.Diag("dispatch set_active_class -> " + r);
                StelarithNotificationProvider.Current?.Push(
                    StelarithBranding.SourceName, $"课表切换：{r}", 6);
                break;
            // 功能模块开关：面板「插件管理 / 功能模块」的真实落点。
            // 关掉一个模块会立即改变本机行为，因此这是**双向**能力 —— 关闭核心模块会被拒绝。
            case "set_module":
            case "set_modules":
                var applyResult = StelarithModules.ApplyFromTask(task);
                StelarithModules.Diag("dispatch set_module -> " + applyResult);
                StelarithNotificationProvider.Current?.Push(StelarithBranding.SourceName, "功能模块调整：" + applyResult, 6);
                break;
            // 需要 OS 级 / 网络级动作的，一律交给本地代理（它才有权限启 VNC、控进程、验签）
            case "remote_control_start":
            case "remote_control_stop":
                if (!RequireModule(StelarithModules.RemoteControl, "远程控制")) break;
                await ForwardToAgentAsync(task, "远程控制");
                break;
            // 摄像头：抓拍单帧 / 短录像 / 媒体库（列举·删除）。真正的取流由本地代理做
            //（它才有 OS 级设备访问权），插件这层的职责是**门控**（隐私动作必须能一键全关）
            // 与**把失败原因推上大屏**。
            case "camera_snapshot":
            case "camera_record_start":
            case "camera_record_stop":
            case "camera_list":
            case "media_list":
            case "media_delete":
                if (!RequireModule(StelarithModules.CameraCapture, "摄像头")) break;
                await ForwardToAgentAsync(task, "摄像头");
                break;
            // P2P 媒体会话：本机作为点位被观看端直连（高带宽画面不过服务器）。
            // 关掉这个模块 = 只允许经服务器转发，属**降级**而非拒绝。
            case "media_session_start":
            case "media_session_stop":
                if (!RequireModule(StelarithModules.MediaP2P, "P2P 媒体")) break;
                await ForwardToAgentAsync(task, "P2P 媒体");
                break;
            case "shell":
            case "reboot":
                if (!RequireModule(StelarithModules.RemoteControl, "远程控制")) break;
                await ForwardToAgentAsync(task, "系统");
                break;
            default:
                break;
        }
    }

    /// <summary>
    /// 转发一条指令给本地代理，并**把失败原因变成可见信息**。
    /// </summary>
    /// <remarks>
    /// 代理对「拒绝执行」同样返回 HTTP 200 + {"error":...}（shell 默认关闭、验签失败/防重放、
    /// 未知动作、VNC 启动失败都会走这条路）。所以这里必须读回执里的 error 字段，不能只看状态码。
    /// 另一种失败是连接失败 —— 在代理进部署包之前，这是最可能的实际情况。
    /// 两者会给用户完全一样的现象：「面板下发 200，设备毫无反应」。
    /// 必须给它一个能被看见的出口，否则同一问题会被反复排查。
    /// </remarks>
    private static async Task ForwardToAgentAsync(StelarithTask task, string what)
    {
        var r = await Agent.SendAsync(task);
        if (r.Ok)
        {
            Diag($"agent ok: {task.Action}");
            return;
        }

        Diag($"agent FAIL: {task.Action} -> {r.Error}");
        StelarithNotificationProvider.Current?.Push(
            StelarithBranding.SourceName, $"{what}指令未执行：{r.Error}", 8);
    }

    internal static void Diag(string msg)
    {
        try
        {
            StelarithLog.Write("ste-dispatch-diag.log", msg);
        }
        catch { /* 忽略 */ }
    }

    /// <summary>
    /// 模块门控：模块被停用时拒绝执行并留下可见记录（而不是静默什么都不做 ——
    /// 静默失败是这套系统里最难排查的一类问题）。
    /// </summary>
    private static bool RequireModule(string moduleId, string what)
    {
        if (StelarithModules.IsEnabled(moduleId)) return true;
        StelarithModules.Diag($"dispatch: {what} 被拒 —— 模块 {moduleId} 已停用");
        StelarithNotificationProvider.Current?.Push(
            StelarithBranding.SourceName, $"{what} 指令未执行：对应功能模块已被停用（可在插件设置页重新启用）。", 6);
        return false;
    }
}
