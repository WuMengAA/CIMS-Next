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
    private static readonly HttpClient Http = new();
    // 静态服务定位器，供静态守护线程取配置（与 PanelService/Poller 一致的兜底模式）
    private static StelarithSyncOptions? _staticOpt;
    private static ILogger<StelarithSyncService>? _staticLogger;
    private static readonly object SyncLock = new();

    public StelarithSyncService(ILogger<StelarithSyncService> logger, StelarithSyncOptions opt)
    {
        _logger = logger;
        _opt = opt;
        _staticLogger = logger;
        _staticOpt = opt;
    }

    static StelarithSyncService()
    {
        // 兜底守护：宿主因其它插件启动异常可能不调 StartAsync，故用后台线程保证同步仍执行
        SyncDiag("static ctor: 拉起守护同步线程");
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

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // 启动即打印同步目标（诊断用途：确认 sync 是否以正确租户启动）
        SyncDiag($"ExecuteAsync entered. opt: slug={_opt.Slug} uid={_opt.ClientUid}");
        _logger.LogInformation(
            "Stelarith sync: 启动，同步目标 ClientAppBase={base} Host={host}",
            _opt.ClientAppBase, $"{_opt.Slug}.{_opt.BaseDomain}");
        // 进后台立即首拉一次，之后按间隔轮询；同时响应 StelarithSyncState.RequestRefresh
        // 的即时刷新信号（轮询服务收到 DataUpdated 时触发），避免干等下个周期。
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Math.Max(5, _opt.RefreshIntervalSeconds)));
        while (!stoppingToken.IsCancellationRequested)
        {
            var wake = await Task.WhenAny(
                timer.WaitForNextTickAsync(stoppingToken).AsTask(),
                // 收到即时刷新信号则立即执行一次（取消/信号冲突时容忍异常）
                StelarithSyncState.WaitForRefreshAsync(stoppingToken).ContinueWith(_ => true, TaskContinuationOptions.OnlyOnRanToCompletion));
            try
            {
                lock (SyncLock)
                {
                    if (_staticOpt is not null) RefreshSync(_staticOpt, _staticLogger).GetAwaiter().GetResult();
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Stelarith sync: 定时刷新失败，下个周期重试");
                StelarithSyncState.Update(new StelarithSyncSnapshot
                {
                    At = DateTimeOffset.UtcNow,
                    Ok = false,
                    Error = ex.Message,
                });
            }
            // 若因即时刷新信号醒来，本次已执行；下次仍按原 schedule。(wake 仅用于等待语义，成功即继续)
        }
    }

    /// <summary>
    /// 守护线程的同步刷新入口（静态可调用，不依赖宿主生命周期）。
    /// 对齐 ClassIsland 官方集控逻辑：先取 manifest（客户端清单），再按清单声明的
    /// 各 *Source.Value 逐项取用资源，而非写死资源名/路径——这样资源集合变化时无需改插件。
    /// </summary>
    private static async Task RefreshSync(StelarithSyncOptions opt, ILogger<StelarithSyncService>? logger)
    {
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
            ComponentsJson = bodies.TryGetValue("Components", out var co) ? co : null,
            Ok = manifest is not null,
        });

        var okCount = bodies.Values.Count(v => v is not null);
        SyncDiag($"resources refreshed {okCount}/{sources.Count} ok");
        logger?.LogInformation(
            "Stelarith sync: manifest {m}B，资源 {ok}/{n} 项已刷新",
            manifest?.Length ?? 0, okCount, sources.Count);
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

    /// <summary>文件诊断（不依赖宿主 logger；宿主启动异常时 logger 可能丢失）。写入 AppContext.BaseDirectory/ste-sync-diag.log。</summary>
    private static void SyncDiag(string msg)
    {
        try
        {
            File.AppendAllText(
                Path.Combine(AppContext.BaseDirectory, "ste-sync-diag.log"),
                $"{DateTime.Now:HH:mm:ss.fff} {msg}{Environment.NewLine}");
        }
        catch { /* 忽略诊断写失败 */ }
    }
}
