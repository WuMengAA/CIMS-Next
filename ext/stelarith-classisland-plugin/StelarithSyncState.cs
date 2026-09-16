using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace StelarithControlPlugin;

/// <summary>
/// 星璃·集控「主动同步」（cshua）配置。可通过插件目录下的 stelarith-sync.json 覆盖默认值。
/// 默认值对齐本机 e2e 评估环境（账户 slug=e2e-school，客户端 uid=lab-pc-001）。
///
/// 部署时按真实环境改 stelarith-sync.json 即可，无需重新编译：
/// {
///   "ClientAppBase": "http://127.0.0.1:8096",
///   "BaseDomain": "localhost",
///   "Slug": "e2e-school",
///   "ClientUid": "lab-pc-001",
///   "ClassPlanName": "default_classplan",
///   "ComponentsName": "default_components",
///   "RefreshIntervalSeconds": 30
/// }
/// </summary>
public sealed class StelarithSyncOptions
{
    /// <summary>CIMS 客户端应用基址（教室端拉取配置的真实读取点）。</summary>
    public string ClientAppBase { get; set; } = "http://127.0.0.1:8096";

    /// <summary>租户基域（TenantMiddleware 按 Host: &lt;slug&gt;.&lt;BaseDomain&gt; 识别租户）。</summary>
    public string BaseDomain { get; set; } = "localhost";

    /// <summary>租户 slug（来自 CIMS /account/list 首个账户；e2e 环境为 e2e-school）。</summary>
    public string Slug { get; set; } = "e2e-school";

    /// <summary>本机在 CIMS 注册的客户端 uid（教室一体机标识）。</summary>
    public string ClientUid { get; set; } = "lab-pc-001";

    /// <summary>课表资源名（ClassPlan）。</summary>
    public string ClassPlanName { get; set; } = "default_classplan";

    /// <summary>组件资源名（Components）。</summary>
    public string ComponentsName { get; set; } = "default_components";

    /// <summary>刷新间隔（秒，最小 5）。</summary>
    public int RefreshIntervalSeconds { get; set; } = 30;

    /// <summary>
    /// 是否把同步到的课表/作息/科目写回宿主 ClassIsland 档案（默认开启）。
    /// 关闭后仅存插件内快照、不动宿主档案 —— 便于排障或「只读同步」部署。
    /// </summary>
    public bool ResourceWriteBack { get; set; } = true;

    /// <summary>消息中心可读的 website 端点基址（留空则用 ClientAppBase 的 CIMS 只读端点）。</summary>
    public string MessageFeedBase { get; set; } = "";

    /// <summary>
    /// 播报「来源名称」—— 教室大屏上遮罩显示的发送方。默认「集控广播」。
    /// 改 stelarith-sync.json 的 NotificationSourceName 即可换成学校自己的叫法（如「校园广播站」），
    /// 无需重新编译。留空则回落到默认值。
    /// </summary>
    public string NotificationSourceName { get; set; } = "集控广播";

    /// <summary>
    /// 点歌站（VoiceHub）基址，如 https://voicehub.example.edu。留空 = 不启用点歌类组件。
    /// 与 voicehubKey 一起配置后，「点歌名单 / 正在播放」组件才会上屏。
    /// </summary>
    public string VoiceHubBase { get; set; } = "";

    /// <summary>VoiceHub 开放 API Key（需 songs:read 权限）。</summary>
    public string VoiceHubKey { get; set; } = "";

    /// <summary>
    /// CIMS 上「点歌看板」资源名（默认 songboard）。集控面板/同步适配器把当前播放与待播队列
    /// 写进该资源，教室端优先展示它（= 集控强制推送）；资源为空或过期时才回退直连点歌站。
    /// </summary>
    public string SongboardResource { get; set; } = "songboard";

    /// <summary>点歌数据刷新间隔（秒，最小 5）。</summary>
    public int SongboardRefreshSeconds { get; set; } = 15;

    /// <summary>从插件目录下的 stelarith-sync.json 读取覆盖；文件不存在则用默认值。</summary>
    public static StelarithSyncOptions Load()
    {
        var opt = new StelarithSyncOptions();
        try
        {
            var dir = Path.GetDirectoryName(typeof(StelarithSyncOptions).Assembly.Location);
            var path = Path.Combine(dir ?? AppContext.BaseDirectory, "stelarith-sync.json");
            if (File.Exists(path))
            {
                var json = File.ReadAllText(path);
                var fromFile = JsonSerializer.Deserialize<StelarithSyncOptions>(json);
                if (fromFile is not null) opt = fromFile;
            }
        }
        catch
        {
            // 读取失败则保持默认值
        }
        // 空串视为「配置了但没填」，回落到默认，避免 UI 上出现空白来源名
        if (string.IsNullOrWhiteSpace(opt.NotificationSourceName)) opt.NotificationSourceName = "集控广播";
        return opt;
    }
}

/// <summary>最近一次同步的快照（供通知提供方 / UI 读取展示）。</summary>
public sealed class StelarithSyncSnapshot
{
    public DateTimeOffset At { get; set; }
    public string? ManifestJson { get; set; }
    public string? ClassPlanJson { get; set; }
    public string? TimeLayoutJson { get; set; }
    public string? SubjectsJson { get; set; }
    public string? ComponentsJson { get; set; }
    /// <summary>本轮拿到的全部资源（资源类型 → 原文），供 profile 写回按需取用。</summary>
    public Dictionary<string, string?> Resources { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public bool Ok { get; set; }
    public string? Error { get; set; }
    /// <summary>最近一次 profile 写回结果（由 StelarithProfileWriter 回填）。</summary>
    public string? ProfileWriteResult { get; set; }
}

/// <summary>线程安全的当前同步快照持有者（插件内单例访问点）。</summary>
public static class StelarithSyncState
{
    private static StelarithSyncSnapshot _current = new() { Ok = false };
    private static readonly object Lock = new();
    // 即时刷新信号：轮询服务收到 DataUpdated 时释放，同步服务据此立即拉取一次，
    // 而不必干等下一个 RefreshInterval 周期。
    private static readonly SemaphoreSlim RefreshSignal = new(0);

    public static StelarithSyncSnapshot Current
    {
        get { lock (Lock) return _current; }
    }

    public static void Update(StelarithSyncSnapshot snap)
    {
        lock (Lock) _current = snap;
    }

    /// <summary>请求一次即时刷新（非阻塞；最多累积一个待刷新信号）。</summary>
    public static void RequestRefresh()
    {
        if (RefreshSignal.CurrentCount == 0)
        {
            try { RefreshSignal.Release(); }
            catch (SemaphoreFullException) { /* 已有一个待处理信号，忽略 */ }
        }
    }

    /// <summary>供同步服务等待 "即时刷新请求" 的异步句柄。</summary>
    internal static Task WaitForRefreshAsync(CancellationToken ct) => RefreshSignal.WaitAsync(ct);
}
