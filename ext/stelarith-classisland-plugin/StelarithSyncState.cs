using System;
using System.IO;
using System.Text.Json;

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
        return opt;
    }
}

/// <summary>最近一次同步的快照（供通知提供方 / UI 读取展示）。</summary>
public sealed class StelarithSyncSnapshot
{
    public DateTimeOffset At { get; set; }
    public string? ManifestJson { get; set; }
    public string? ClassPlanJson { get; set; }
    public string? ComponentsJson { get; set; }
    public bool Ok { get; set; }
    public string? Error { get; set; }
}

/// <summary>线程安全的当前同步快照持有者（插件内单例访问点）。</summary>
public static class StelarithSyncState
{
    private static StelarithSyncSnapshot _current = new() { Ok = false };
    private static readonly object Lock = new();

    public static StelarithSyncSnapshot Current
    {
        get { lock (Lock) return _current; }
    }

    public static void Update(StelarithSyncSnapshot snap)
    {
        lock (Lock) _current = snap;
    }
}
