using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace StelarithControlPlugin;

/// <summary>
/// 星璃·集控「主动同步」（cshua）配置。可通过插件目录下的 stelarith-sync.json 覆盖默认值。
///
/// **默认即公网**（2026-09-20 起）：默认 NetworkMode=wan，直接走公网入口
/// `https://demo-class.245959623.xyz`（BaseDomain=245959623.xyz），
/// 不再默认内网 127.0.0.1:8096 —— 教室机无论在校园网还是外网都能直接连通，
/// 装机后无需先切模式。内网直连作为备用保留（LanClientAppBase / LanBaseDomain）。
///
/// 覆盖示例（stelarith-sync.json，位于 PluginConfigFolder 或 DLL 同目录）：
/// {
///   "NetworkMode": "wan",
///   "ClientAppBase": "https://demo-class.245959623.xyz",
///   "BaseDomain": "245959623.xyz",
///   "Slug": "demo-class",
///   "ClientUid": "<本机 uid，留空则用机器名>",
///   "ClassPlanName": "default_classplan",
///   "ComponentsName": "default_components",
///   "RefreshIntervalSeconds": 30
/// }
///
/// ⚠️ 多租户部署**必须**同时改 `Slug` 与 `ClientAppBase` 的子域（二者同源）。
/// 只改其一的症状是「第一批请求就 403」——租户识别靠 Host 头，现象与原因毫无相似性。
/// （教训：曾写死评估环境 slug=e2e-school → 403 → CCProtect 自封 IP → 429 → 主界面空白。）
/// </summary>
public sealed class StelarithSyncOptions
{
    /// <summary>CIMS 客户端应用基址（教室端拉取配置的真实读取点）。默认 = 公网入口。</summary>
    public string ClientAppBase { get; set; } = "https://demo-class.245959623.xyz";

    /// <summary>租户基域（TenantMiddleware 按 Host: &lt;slug&gt;.&lt;BaseDomain&gt; 识别租户）。默认 = 公网基域。</summary>
    public string BaseDomain { get; set; } = "245959623.xyz";

    /// <summary>
    /// 租户 slug（TenantMiddleware 按 Host: &lt;slug&gt;.&lt;BaseDomain&gt; 识别租户）。
    /// 默认 `demo-class`，与默认公网入口 `https://demo-class.245959623.xyz` 的子域一致。
    /// **多租户部署必须覆盖**：改这里的同时也要改 ClientAppBase 的子域（二者同源，只改其一必 403）。
    /// 教训：写死一个**错误** slug 会让所有请求 403 → 触发 CCProtect 自封 IP（429）
    /// → 插件永远拉不到课表 → 主界面绑定 null → 前台空白（现象与原因毫无相似性）。
    /// </summary>
    public string Slug { get; set; } = "demo-class";

    /// <summary>本机在 CIMS 注册的客户端 uid（教室一体机标识）。留空则回落到机器名。</summary>
    public string ClientUid { get; set; } = "";

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

    // ─────────────── 网络模式（内网直连 ↔ 公网域名）───────────────
    //
    // 为什么要把这件事做成"一键切换"而不是让人去手改 JSON：
    // ClientAppBase 与 BaseDomain **必须成对修改**，且必须与服务端 .env 的
    // CIMS_BASE_DOMAIN 一致。只改一个的症状是「第一批请求就 403」——
    // 而 403 的原因（租户识别靠 Host 头）从现象上完全看不出来。
    // 因此这里把两套值都存下来，切换时一起写，杜绝半改。

    /// <summary>当前网络模式：`wan`（公网域名，默认）| `lan`（内网直连，备用）。</summary>
    public string NetworkMode { get; set; } = "wan";

    /// <summary>内网模式的服务基址（默认直连本机 CIMS）。</summary>
    public string LanClientAppBase { get; set; } = "http://127.0.0.1:8096";

    /// <summary>内网模式的租户基域。</summary>
    public string LanBaseDomain { get; set; } = "localhost";

    /// <summary>
    /// 公网模式的服务基址，默认 `https://demo-class.245959623.xyz`。
    /// 留空会被 ApplyNetworkMode 拒绝切换并提示（而不是写进一个空 URL 让整套同步静默失败）。
    /// </summary>
    public string WanClientAppBase { get; set; } = "https://demo-class.245959623.xyz";

    /// <summary>公网模式的租户基域，默认 `245959623.xyz`（与服务端 CIMS_BASE_DOMAIN 一致）。</summary>
    public string WanBaseDomain { get; set; } = "245959623.xyz";

    /// <summary>
    /// 按模式把 `ClientAppBase` / `BaseDomain` 一起刷成该模式对应的值。
    /// 返回 null 表示成功，否则返回不能切换的原因（供 UI 直接显示）。
    /// </summary>
    public string? ApplyNetworkMode(string mode)
    {
        if (string.Equals(mode, "wan", StringComparison.OrdinalIgnoreCase))
        {
            if (string.IsNullOrWhiteSpace(WanClientAppBase) || string.IsNullOrWhiteSpace(WanBaseDomain))
            {
                return "尚未配置公网地址（WanClientAppBase / WanBaseDomain 为空）。"
                     + "请先填好公网入口 —— 半改这套地址会让所有请求直接 403。";
            }
            NetworkMode = "wan";
            ClientAppBase = WanClientAppBase.Trim().TrimEnd('/');
            BaseDomain = WanBaseDomain.Trim().Trim('.');
            return null;
        }
        NetworkMode = "lan";
        ClientAppBase = LanClientAppBase.Trim().TrimEnd('/');
        BaseDomain = LanBaseDomain.Trim().Trim('.');
        return null;
    }

    /// <summary>
    /// 官方插件设置目录（= ClassIsland <c>PluginBase.PluginConfigFolder</c>）。
    /// 由插件入口在 <c>Initialize</c> 中注入。
    ///
    /// 为什么要有这个：ClassIsland 官方规范明确「插件的各项设置应当存放在此目录中」
    /// （见 PluginBase.PluginConfigFolder 文档），而不是插件安装目录 ——
    /// 安装目录在插件升级/重装时会被覆盖，设置会丢。
    /// 未注入时（静态守护线程可能早于 Initialize 运行）回落到程序集目录，保持兼容。
    /// </summary>
    public static string? ConfigDir { get; set; }

    /// <summary>解析设置文件所在目录：优先官方配置目录，其次程序集目录（兜底）。</summary>
    private static string ResolveConfigDir()
    {
        var d = ConfigDir;
        if (!string.IsNullOrWhiteSpace(d))
        {
            try { Directory.CreateDirectory(d); return d!; }
            catch { /* 配置目录不可写则回落 */ }
        }
        return Path.GetDirectoryName(typeof(StelarithSyncOptions).Assembly.Location)
               ?? AppContext.BaseDirectory;
    }

    /// <summary>写回插件目录下的 stelarith-sync.json（保留未在本类声明的字段）。</summary>
    public void Save()
    {
        var path = Path.Combine(ResolveConfigDir(), "stelarith-sync.json");
        var json = JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(path, json);
        SyncOptionsDiag($"saved mode={NetworkMode} base={ClientAppBase} domain={BaseDomain}");
    }

    internal static void SyncOptionsDiag(string msg)
    {
        try
        {
                StelarithLog.Write("stelarith-sync-diag.log", msg);
        }
        catch { /* 忽略 */ }
    }

    /// <summary>从 stelarith-sync.json 读取覆盖；文件不存在则用默认值。</summary>
    public static StelarithSyncOptions Load()
    {
        var opt = new StelarithSyncOptions();
        try
        {
            var path = Path.Combine(ResolveConfigDir(), "stelarith-sync.json");
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
        // 客户端 uid 留空 → 优先读本机 agent 的 uid（与星集控共用同一设备名），
        // 读不到再回退机器名（每台教室机天然唯一）。
        if (string.IsNullOrWhiteSpace(opt.ClientUid))
        {
            opt.ClientUid = TryReadAgentUid() ?? Environment.MachineName;
        }
        // slug 留空 → 明确告警。不静默用一个错误默认值去请求：那会 403 → 被 CCProtect 自封 IP → 429，
        // 表现为「插件拉不到课表、主界面空白」，且现象与原因完全不相关，极难排查。
        if (string.IsNullOrWhiteSpace(opt.Slug))
            SyncOptionsDiag("警告：租户 slug 未配置（stelarith-sync.json 的 Slug）—— 所有 CIMS 请求会 403。");
        return opt;
    }

    /// 与星集控 agent 共用设备名：读本机 agent 的 uid（run-agent.cmd / agent-secret.cmd）。
    /// 教室机先装 agent（uid 固化），插件读到同一 uid → CIMS 设备表只有一条记录。
    /// 读取失败（agent 未装/文件被移）返回 null，调用方回退机器名。
    private static string? TryReadAgentUid()
    {
        try
        {
            var candidates = new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Stelarith", "agent", "device.uid"),
                @"C:ClassIslandagentun-agent.cmd",
                @"C:ClassIslandagentagent-secret.cmd",
            };
            foreach (var p in candidates)
            {
                if (!File.Exists(p)) continue;
                var text = File.ReadAllText(p);
                var m = System.Text.RegularExpressions.Regex.Match(text, "STELARITH_DEVICE_UID=([^\r\n\"]+)");
                if (m.Success && !string.IsNullOrWhiteSpace(m.Groups[1].Value))
                {
                    var uid = m.Groups[1].Value.Trim();
                    if (uid.Length <= 64) return uid;
                }
            }
        }
        catch { /* 读取失败静默，回退机器名 */ }
        return null;
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
