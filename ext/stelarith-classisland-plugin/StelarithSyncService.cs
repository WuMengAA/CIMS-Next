using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace StelarithControlPlugin;

/// <summary>
/// 星璃·集控「主动同步」（cshua）：后台定时从 CIMS 客户端应用拉取当前已下发的
/// 课表/组件配置与设备清单，刷新插件内的展示快照，避免只被动等命令、展示永远滞后。
///
/// 拉取目标为 CIMS 客户端应用（默认 http://127.0.0.1:8096），其资源接口受 TenantMiddleware
/// 保护，必须带 Host: &lt;slug&gt;.&lt;BaseDomain&gt;，否则 403。资源接口会 302 到 /get?token=...，
/// 这里手动跟随重定向并逐跳保持 Host 头（HttpClient 自动重定向会丢失自定义 Host → 403）。
/// </summary>
public sealed class StelarithSyncService : BackgroundService
{
    private readonly ILogger<StelarithSyncService> _logger;
    private readonly StelarithSyncOptions _opt;
    // ⚠️ 必须显式设超时：HttpClient 默认要等 100s 才失败。
    // CIMS/网络不可达时，100s 的阻塞会让同步线程长时间挂住，表现为「离线时插件像死了」。
    // 对齐星集控铁律：所有对外 HttpClient 一律收紧到 5s。
    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        ConnectTimeout = TimeSpan.FromSeconds(3),
        PooledConnectionIdleTimeout = TimeSpan.FromSeconds(1),
    })
    { Timeout = TimeSpan.FromSeconds(5) };
    // 静态服务定位器，供静态守护线程取配置（与 PanelService/Poller 一致的兜底模式）
    private static StelarithSyncOptions? _staticOpt;
    private static ILogger<StelarithSyncService>? _staticLogger;
    private static readonly object SyncLock = new();

    public StelarithSyncService(ILogger<StelarithSyncService> logger, StelarithSyncOptions opt,
        IServiceProvider services, StelarithServiceProviderBridge bridge)
    {
        _logger = logger;
        _opt = opt;
        _staticLogger = logger;
        _staticOpt = opt;
        // 桥在此被宿主容器**真实解析**（构造注入），从而拿到根 IServiceProvider，
        // 交给反射定位器去取档案服务（ClassIsland.Services.ProfileService）。
        // 注意：仅在 Initialize 里 AddSingleton<T>() 是不够的——没人解析它，
        // 构造函数就永远不会跑。必须在某个**会被实例化**的服务里注入它。
        _ = bridge;
        try
        {
            StelarithReflection.RegisterProvider(services);
            SyncDiag("ctor: 已把宿主 IServiceProvider 登记给反射定位器");
        }
        catch (Exception ex)
        {
            SyncDiag("ctor: 登记 IServiceProvider 失败: " + ex.Message);
        }
    }

    static StelarithSyncService()
    {
        // 兜底守护：宿主因其它插件启动异常可能不调 StartAsync，故用后台线程保证同步仍执行
        SyncDiag("static ctor: 拉起守护同步线程");
        // ⚠️ 这里必须自行加载配置：本服务不再注册为 IHostedService（注册会阻塞宿主启动），
        // 因此**实例构造函数不会被执行**，_staticOpt 只能在这里兜底赋值，否则守护线程空转。
        try { _staticOpt ??= StelarithSyncOptions.Load(); } catch { }
        var t = new Thread(() =>
        {
            try
            {
                while (true)
                {
                    try
                    {
                        lock (SyncLock)
                        {
                            if (_staticOpt is not null) RefreshSync(_staticOpt, _staticLogger).GetAwaiter().GetResult();
                        }
                    }
                    catch (Exception ex)
                    {
                        SyncDiag($"guard sync exception: {ex.Message}");
                    }
                    Thread.Sleep(TimeSpan.FromSeconds(Math.Max(5, _staticOpt?.RefreshIntervalSeconds ?? 30)));
                }
            }
            catch (ThreadAbortException) { /* 进程退出 */ }
        });
        t.IsBackground = true;
        t.Name = "stelarith-sync-guard";
        t.Start();
    }

    /// <summary>
    /// 包的 StartAsync：把异常吞掉。
    ///
    /// 宿主把所有插件的 IHostedService 放在同一个启动序列里依次 StartAsync，任何一个抛异常
    /// 都会中断后续插件的启动（本插件曾因此在教室端完全不起作用）。本插件对"启动"的要求是
    /// **尽可能别让宿主失败**：真正的存活由静态守护线程保证（见类注释），
    /// 所以这里即使 base 抛了，功能也不会丢，只是少了一条启动路径。
    /// </summary>
    public override async Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            await base.StartAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            SyncDiag("StartAsync swallowed: " + ex.Message);
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // ⚠️ 本方法只是占位：真正的同步/轮询/上报考由**专用守护线程**执行（见静态构造函数）。
        // 为什么不能在这里做：BackgroundService.ExecuteAsync 跑在**线程池线程**上，
        // 而本项目的 HTTP 调用是同步阻塞（.GetAwaiter().GetResult()）→ 会持续占用线程池线程
        // → **线程池饥饿** → 宿主 Host.StartAsync 的异步续体排不上队 → AppStarted 永不触发
        // → ClassIsland 主界面不创建。实测：把工作挪出 ExecuteAsync 后主界面立刻恢复。
        await Task.Delay(Timeout.Infinite, stoppingToken).ConfigureAwait(false);
    }

    /// <summary>
    /// 守护线程的同步刷新入口（静态可调用，不依赖宿主生命周期）。
    /// 对齐 ClassIsland 官方集控逻辑：先取 manifest（客户端清单），再按清单声明的
    /// 各 *Source.Value 逐项取用资源，而非写死资源名/路径——这样资源集合变化时无需改插件。
    /// </summary>
    private static async Task RefreshSync(StelarithSyncOptions opt, ILogger<StelarithSyncService>? logger)
    {
        // 模块门控：面板/指令把「资源主动同步」停用后，这里必须真的不发请求 ——
        // 否则既浪费带宽，也会在服务端留下"设备还在同步"的假象。
        if (!StelarithModules.IsEnabled(StelarithModules.Sync))
        {
            SyncDiag("sync skipped: module 'sync' disabled");
            return;
        }

        var host = $"{opt.Slug}.{opt.BaseDomain}";

        // 第 1 步：取清单（manifest）。这是官方协议的资源发现入口。
        var manifest = await GetAsync(
            opt, $"{opt.ClientAppBase}/api/v1/client/{opt.ClientUid}/manifest", host, logger);
        var sources = ParseManifestSources(manifest);
        SyncDiag($"manifest {(manifest is null ? "FAIL" : "OK")} ({manifest?.Length ?? 0}B), sources=[{string.Join(",", sources.Keys)}]");

        // 第 2 步：按清单声明的资源类型逐个取用（资源由清单驱动）。
        var bodies = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        foreach (var kv in sources)
        {
            var url = $"{opt.ClientAppBase}/api/v1/client/{kv.Key}?name={Uri.EscapeDataString(kv.Value)}";
            bodies[kv.Key] = await GetAsync(opt, url, host, logger);
        }

        StelarithSyncState.Update(new StelarithSyncSnapshot
        {
            At = DateTimeOffset.UtcNow,
            ManifestJson = manifest,
            ClassPlanJson = bodies.TryGetValue("ClassPlan", out var cp) ? cp : null,
            TimeLayoutJson = bodies.TryGetValue("TimeLayout", out var tl) ? tl : null,
            SubjectsJson = bodies.TryGetValue("Subjects", out var sb) ? sb : null,
            ComponentsJson = bodies.TryGetValue("Components", out var co) ? co : null,
            Resources = new Dictionary<string, string?>(bodies, StringComparer.OrdinalIgnoreCase),
            Ok = manifest is not null,
        });

        var okCount = bodies.Values.Count(v => v is not null);
        SyncDiag($"resources refreshed {okCount}/{sources.Count} ok");
        logger?.LogInformation(
            "Stelarith sync: manifest {m}B，资源 {ok}/{n} 项已刷新",
            manifest?.Length ?? 0, okCount, sources.Count);

        // ---- 写回宿主档案：让 CIMS 下发的课表/作息/科目在教室端真正生效 ----
        // 只有拿到内容才写回；且必须同时满足两个开关：配置文件的 ResourceWriteBack
        // （部署级开关）与模块开关 writeback（运行时可切换）。
        if (opt.ResourceWriteBack && StelarithModules.IsEnabled(StelarithModules.WriteBack))
        {
            StelarithReflection.EnsureResolved();
            StelarithProfileWriter.WriteBack(
                bodies.TryGetValue("ClassPlan", out var wcp) ? wcp : null,
                bodies.TryGetValue("TimeLayout", out var wtl) ? wtl : null,
                bodies.TryGetValue("Subjects", out var wsb) ? wsb : null,
                logger);

            var snap = StelarithSyncState.Current;
            snap.ProfileWriteResult = StelarithProfileWriter.LastResult;
            SyncDiag("profile writeback: " + StelarithProfileWriter.LastResult);
        }
        else
        {
            SyncDiag("profile writeback: 已按配置关闭（ResourceWriteBack=false）");
        }
    }

    /// <summary>
    /// 从 manifest 解析「资源类型 -> 资源名」映射。
    /// manifest 中每项形如 <c>"ClassPlanSource": {"Value": "http://…/api/v1/client/ClassPlan?name=default_classplan", "Version": …}</c>，
    /// 这里取 URL 末段作为资源类型、查询串 name 作为资源名。
    /// </summary>
    private static Dictionary<string, string> ParseManifestSources(string? manifestJson)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(manifestJson)) return map;
        try
        {
            using var doc = JsonDocument.Parse(manifestJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return map;

            foreach (var prop in doc.RootElement.EnumerateObject())
            {
                if (!prop.Name.EndsWith("Source", StringComparison.Ordinal)) continue;
                if (!prop.Value.TryGetProperty("Value", out var valueEl)) continue;
                var value = valueEl.GetString();
                if (string.IsNullOrWhiteSpace(value) ||
                    !Uri.TryCreate(value, UriKind.Absolute, out var uri)) continue;

                var segs = uri.AbsolutePath.Trim('/').Split('/');
                var type = segs.Length > 0 ? segs[^1] : null;
                if (string.IsNullOrEmpty(type)) continue;

                map[type] = GetQueryParam(uri.Query, "name") ?? "default";
            }
        }
        catch
        {
            // 清单解析失败则本轮不取资源；下次周期重试
        }
        return map;
    }

    /// <summary>从查询串中取值（不依赖 System.Web，避免额外依赖）。</summary>
    private static string? GetQueryParam(string query, string key)
    {
        if (string.IsNullOrEmpty(query)) return null;
        foreach (var pair in query.TrimStart('?').Split('&'))
        {
            var i = pair.IndexOf('=');
            if (i <= 0) continue;
            if (string.Equals(pair[..i], key, StringComparison.OrdinalIgnoreCase))
                return Uri.UnescapeDataString(pair[(i + 1)..]);
        }
        return null;
    }

    /// <summary>GET 并手动跟随重定向，逐跳保持 Host 头（客户端资源端点 302 到 /get?token=...，自动重定向会改回 Host 导致 403）。</summary>
    private static async Task<string?> GetAsync(StelarithSyncOptions opt, string url, string host, ILogger<StelarithSyncService>? logger)
    {
        HttpRequestMessage? req = new(HttpMethod.Get, url) { Headers = { Host = host } };
        HttpResponseMessage resp = await Http.SendAsync(req, CancellationToken.None);
        var hops = 0;
        while ((int)resp.StatusCode >= 300 && (int)resp.StatusCode < 400 && resp.Headers.Location is not null && hops++ < 5)
        {
            var location = resp.Headers.Location;
            resp.Dispose();
            var next = location.IsAbsoluteUri ? location : new Uri(new Uri(url), location);
            req = new HttpRequestMessage(HttpMethod.Get, next) { Headers = { Host = host } };
            resp = await Http.SendAsync(req, CancellationToken.None);
        }

        if (!resp.IsSuccessStatusCode)
        {
            logger?.LogWarning("Stelarith sync: GET {url} -> {code}", url, (int)resp.StatusCode);
            resp.Dispose();
            return null;
        }

        var body = await resp.Content.ReadAsStringAsync();
        resp.Dispose();
        return body;
    }

    /// <summary>文件诊断（不依赖宿主 logger；宿主启动异常时 logger 可能丢失）。写入官方 PluginConfigFolder/logs/ste-sync-diag.log。</summary>
    private static void SyncDiag(string msg)
    {
        try
        {
                StelarithLog.Write("ste-sync-diag.log", msg);
        }
        catch { /* 忽略诊断写失败 */ }
    }
}
