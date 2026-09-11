using System;
using System.Net.Http;
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

    public StelarithSyncService(ILogger<StelarithSyncService> logger, StelarithSyncOptions opt)
    {
        _logger = logger;
        _opt = opt;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // 进后台立即首拉一次，之后按间隔轮询
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Math.Max(5, _opt.RefreshIntervalSeconds)));
        do
        {
            try
            {
                await RefreshAsync(stoppingToken);
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
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task RefreshAsync(CancellationToken ct)
    {
        var host = $"{_opt.Slug}.{_opt.BaseDomain}";
        var manifest = await GetAsync($"{_opt.ClientAppBase}/api/v1/client/{_opt.ClientUid}/manifest", host, ct);
        var classPlan = await GetAsync($"{_opt.ClientAppBase}/api/v1/client/ClassPlan?name={Uri.EscapeDataString(_opt.ClassPlanName)}", host, ct);
        var components = await GetAsync($"{_opt.ClientAppBase}/api/v1/client/Components?name={Uri.EscapeDataString(_opt.ComponentsName)}", host, ct);

        StelarithSyncState.Update(new StelarithSyncSnapshot
        {
            At = DateTimeOffset.UtcNow,
            ManifestJson = manifest,
            ClassPlanJson = classPlan,
            ComponentsJson = components,
            Ok = manifest is not null,
        });

        _logger.LogInformation(
            "Stelarith sync: 已刷新 manifest {m}B / classplan {c}B / components {co}B",
            manifest?.Length ?? 0, classPlan?.Length ?? 0, components?.Length ?? 0);
    }

    /// <summary>
    /// GET 并手动跟随重定向，逐跳保持 Host 头（客户端资源端点 302 到 /get?token=...，
    /// 自动重定向会改回 Host: 127.0.0.1:8096 导致 403，故必须手动跟随）。
    /// </summary>
    private async Task<string?> GetAsync(string url, string host, CancellationToken ct)
    {
        HttpRequestMessage? req = new(HttpMethod.Get, url) { Headers = { Host = host } };
        HttpResponseMessage resp = await Http.SendAsync(req, ct);
        var hops = 0;
        while ((int)resp.StatusCode >= 300 && (int)resp.StatusCode < 400 && resp.Headers.Location is not null && hops++ < 5)
        {
            var location = resp.Headers.Location;
            resp.Dispose();
            var next = location.IsAbsoluteUri ? location : new Uri(new Uri(url), location);
            req = new HttpRequestMessage(HttpMethod.Get, next) { Headers = { Host = host } };
            resp = await Http.SendAsync(req, ct);
        }

        if (!resp.IsSuccessStatusCode)
        {
            _logger.LogWarning("Stelarith sync: GET {url} -> {code}", url, (int)resp.StatusCode);
            resp.Dispose();
            return null;
        }

        var body = await resp.Content.ReadAsStringAsync(ct);
        resp.Dispose();
        return body;
    }
}
