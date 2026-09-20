using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using ClassIsland.Core.Abstractions.Services;
using ClassIsland.Core.Enums;
using ClassIsland.Core.Models.Plugin;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace StelarithControlPlugin;

/// <summary>最近一次状态上报的结果（供插件设置页直接显示"面板看到的是什么"）。</summary>
public sealed class StelarithStatusSnapshot
{
    public DateTimeOffset At { get; set; }
    public bool Ok { get; set; }
    public string? Error { get; set; }
    public int PluginCount { get; set; }
    public string ClassId { get; set; } = "";
    public string ActiveClassGroup { get; set; } = "";
    public string PayloadJson { get; set; } = "";
    /// <summary>连续失败次数（>0 表示正在退避重试）。</summary>
    public int FailStreak { get; set; }
}

/// <summary>
/// 星璃·集控「状态心跳上报」—— 面板能看到**真实**设备状态的前提。
///
/// 上报内容（POST /api/v1/client/{client_id}/status，见 CIMS app/api/client/status.py）：
///   · 机器身份：host（机器名）、ip（服务端按来源地址回填）、version（插件版本）
///   · 归属与生效态：class_id（管理端权威班级，经 GET 回读）、active_class_group（本地实际生效的课表群）
///   · 模块开关：stelarith-modules.json 的全量快照
///   · 插件清单：`IPluginService.LoadedPluginsInternal` 的真实枚举（名称/版本/启用/加载状态）
///   · 零散遥测：同步是否成功、最近同步时间、消息条数、运行时长等
///
/// 设计要点：
///   1) **不能打爆**：心跳周期 20s，失败时指数退避到最长 5 分钟。这不是洁癖 —— CIMS 的
///      反爬中间件按「同 IP 60 秒内 ≥5 次 ≥400 响应」封禁 60 秒，一旦被封，该 IP 的
///      **所有**请求（含命令轮询）全部被拒，教室端会静默失联。所以任何新接口的探测都必须
///      低频 + 失败退避。
///   2) **不依赖宿主生命周期**：与 SyncService / Poller 一致，用静态构造函数拉起守护线程。
///      宿主可能因其它插件在启动期抛异常而中断 IHostedService 的 StartAsync 序列。
///   3) **绝不抛异常**：所有异常都收敛到诊断文件。上报失败只影响面板显示，不影响教室上课。
/// </summary>
public sealed class StelarithStatusReporter : BackgroundService
{
    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        PooledConnectionLifetime = TimeSpan.FromSeconds(2),
        PooledConnectionIdleTimeout = TimeSpan.FromSeconds(1),
        AutomaticDecompression = System.Net.DecompressionMethods.All,
    });

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    /// <summary>正常运行时的上报间隔。</summary>
    private static readonly TimeSpan NormalInterval = TimeSpan.FromSeconds(20);
    /// <summary>失败退避上限（避免被封 IP）。</summary>
    private static readonly TimeSpan MaxBackoff = TimeSpan.FromMinutes(5);
    /// <summary>每隔多少个成功周期回读一次权威班级归属（管理端 client_profiles 是权威）。</summary>
    private const int ReadBackEveryNCycles = 15; // ≈ 5 分钟

    private readonly ILogger<StelarithStatusReporter>? _logger;
    private readonly StelarithSyncOptions _opt;

    private static StelarithSyncOptions? _staticOpt;
    private static ILogger<StelarithStatusReporter>? _staticLogger;
    private static readonly object ReportLock = new();

    private static StelarithStatusSnapshot _last = new() { Ok = false, Error = "尚未上报" };
    /// <summary>管理端权威班级归属（由 GET /status 回读缓存）。</summary>
    private static string _authoritativeClassId = "";
    private static int _cycle;

    /// <summary>最近一次上报快照（插件设置页读它显示状态）。</summary>
    public static StelarithStatusSnapshot Last => _last;

    public StelarithStatusReporter(ILogger<StelarithStatusReporter> logger, StelarithSyncOptions opt)
    {
        _logger = logger;
        _opt = opt;
        _staticLogger = logger;
        _staticOpt = opt;
    }

    static StelarithStatusReporter()
    {
        ReportDiag("static ctor: 拉起守护上报线程");
        try { _staticOpt ??= StelarithSyncOptions.Load(); } catch { }

        // 模块开关一变就让面板立刻看到新状态（不用等下一个 20 秒周期）
        try
        {
            StelarithModules.Changed += (_, _) => StelarithStatusBridge.RequestImmediateReport();
        }
        catch { /* 订阅失败只是晚一轮上报，无功能影响 */ }

        var t = new Thread(() =>
        {
            try
            {
                while (true)
                {
                    var delay = NormalInterval;
                    try
                    {
                        lock (ReportLock)
                        {
                            var opt = _staticOpt;
                            if (opt is not null) delay = ReportOnce(opt, _staticLogger);
                        }
                    }
                    catch (Exception ex)
                    {
                        ReportDiag("guard loop exception: " + ex.Message);
                    }

                    // 设置页点了「立即上报状态」时，把等待切成 1 秒（不打断正常的退避节奏）
                    var waited = TimeSpan.Zero;
                    while (waited < delay)
                    {
                        if (StelarithStatusBridge.ConsumeRequest()) break;
                        Thread.Sleep(TimeSpan.FromSeconds(1));
                        waited += TimeSpan.FromSeconds(1);
                    }
                }
            }
            catch (ThreadAbortException) { /* 进程退出 */ }
        })
        {
            IsBackground = true,
            Name = "stelarith-status-guard",
        };
        t.Start();
    }

    /// <summary>包的 StartAsync：吞掉异常，避免中断宿主的插件启动序列（存活由静态守护线程保证）。</summary>
    public override async Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            await base.StartAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            ReportDiag("StartAsync swallowed: " + ex.Message);
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

    /// <summary>执行一次上报，返回下次应等待的时长（成功=常规间隔，失败=指数退避）。</summary>
    private static TimeSpan ReportOnce(StelarithSyncOptions opt, ILogger? logger)
    {
        if (!StelarithModules.IsEnabled(StelarithModules.Heartbeat))
        {
            // 心跳被关（理论上核心模块关不掉，此处是防御性分支）
            return MaxBackoff;
        }

        var json = BuildPayload(opt, out var pluginCount);
        var (ok, err) = PostStatus(opt, json).GetAwaiter().GetResult();

        var snap = new StelarithStatusSnapshot
        {
            At = DateTimeOffset.Now,
            Ok = ok,
            Error = err,
            PluginCount = pluginCount,
            ClassId = _authoritativeClassId,
            ActiveClassGroup = StelarithProfileWriter.CurrentActiveClassGroupName(),
            PayloadJson = json,
            FailStreak = ok ? 0 : _last.FailStreak + 1,
        };
        _last = snap;

        if (!ok)
        {
            // 指数退避：20s → 40s → 80s → … → 5min
            var backoff = TimeSpan.FromSeconds(
                Math.Min(MaxBackoff.TotalSeconds, NormalInterval.TotalSeconds * Math.Pow(2, Math.Min(snap.FailStreak, 5))));
            ReportDiag($"report FAILED ({err}), backoff {backoff.TotalSeconds:0}s");
            logger?.LogWarning("Stelarith status: 上报失败 {err}，退避 {s}s", err, backoff.TotalSeconds);
            return backoff;
        }

        // 成功：周期性回读权威班级归属（管理端指派的才是权威）
        _cycle++;
        if (_cycle % ReadBackEveryNCycles == 1)
        {
            ReadBackAuthoritativeClass(opt);
        }

        logger?.LogInformation("Stelarith status: 已上报（{n} 个插件，class={cls}）", pluginCount, _authoritativeClassId);
        return NormalInterval;
    }

    /// <summary>组装上报体。字段名与服务端 status.py 对齐（小写）。</summary>
    private static string BuildPayload(StelarithSyncOptions opt, out int pluginCount)
    {
        var plugins = CollectPlugins(out pluginCount);
        var snap = StelarithSyncState.Current;

        var payload = new Dictionary<string, object?>
        {
            ["host"] = SafeHostName(),
            ["version"] = PluginVersion(),
            // 设备自报的班级：优先用最近一次消息拉取里服务端给的 class_id
            ["class_id"] = string.IsNullOrEmpty(_authoritativeClassId)
                ? StelarithMessageFeed.Last.ClassId
                : _authoritativeClassId,
            ["active_class_group"] = StelarithProfileWriter.CurrentActiveClassGroupName(),
            ["modules"] = StelarithModules.Snapshot(),
            ["plugins"] = plugins,
            ["extra"] = new Dictionary<string, object?>
            {
                ["client_uid"] = opt.ClientUid,
                ["slug"] = opt.Slug,
                ["sync_ok"] = snap.Ok,
                ["sync_at"] = snap.At == default ? null : snap.At.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss"),
                ["sync_error"] = snap.Error,
                ["sync_writeback"] = snap.ProfileWriteResult,
                ["messages"] = StelarithMessageFeed.Last.Messages.Count,
                ["message_feed_ok"] = StelarithMessageFeed.Last.Ok,
                ["uptime_seconds"] = (long)(DateTime.Now - _processStart).TotalSeconds,
                ["process_id"] = Environment.ProcessId,
                ["is_64bit"] = Environment.Is64BitProcess,
                ["os"] = Environment.OSVersion.VersionString,
                ["modules_revision"] = StelarithModules.Revision,
            },
        };

        return JsonSerializer.Serialize(payload);
    }

    private static readonly DateTime _processStart = Process.GetCurrentProcess().StartTime;

    /// <summary>
    /// 枚举 ClassIsland 真实插件清单（委托给唯一采集点 <see cref="PluginInventory"/>）。
    ///
    /// 取不到时返回空数组而不是抛异常 —— 面板会显示"插件信息不可用"，
    /// 这比让整条心跳失败更有用（心跳还带着在线状态、模块开关等关键信息）。
    /// </summary>
    private static List<object> CollectPlugins(out int count)
    {
        List<PluginRow> rows;
        try
        {
            rows = PluginInventory.Snapshot();
        }
        catch (Exception ex)
        {
            ReportDiag("CollectPlugins exception: " + ex.Message);
            rows = new List<PluginRow>();
        }

        if (rows.Count == 0)
            ReportDiag("CollectPlugins: 未取到任何插件（宿主插件服务尚未就绪或静态注册表为空）");

        count = rows.Count;
        return rows.Select(r => (object)new
        {
            id = r.Id,
            name = r.Name,
            version = r.Version,
            author = r.Author,
            description = r.Description,
            enabled = r.Enabled,
            status = r.Status,
            folder = r.Folder,
            // 星集控插件自身：面板对它只读（防关闭）
            isStelarith = r.IsStelarith,
            error = r.Error,
        }).ToList();
    }

    /// <summary>GET /v1/client/{uid}/status 回读，取管理端权威的班级归属。</summary>
    private static void ReadBackAuthoritativeClass(StelarithSyncOptions opt)
    {
        try
        {
            var url = $"{opt.ClientAppBase}/api/v1/client/{Uri.EscapeDataString(opt.ClientUid)}/status";
            using var req = new HttpRequestMessage(HttpMethod.Get, url)
            {
                Headers = { Host = $"{opt.Slug}.{opt.BaseDomain}" },
            };
            using var resp = Http.SendAsync(req, CancellationToken.None).GetAwaiter().GetResult();
            if (!resp.IsSuccessStatusCode) return;
            var body = resp.Content.ReadAsStringAsync().GetAwaiter().GetResult();
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("class_id", out var cid))
                _authoritativeClassId = cid.GetString() ?? "";
            // bound 缺失（旧后端）时用 class_id 是否为空兜底推导；OOBE 状态机据此决定是否弹引导。
            bool bound = doc.RootElement.TryGetProperty("bound", out var bEl)
                ? bEl.ValueKind == System.Text.Json.JsonValueKind.True
                : !string.IsNullOrEmpty(_authoritativeClassId);
            StelarithOobE.Update(bound, _authoritativeClassId);

            // OOBE：缓存可选班级清单，供设置页下拉展示（设备端自助选班）。
            try
            {
                if (doc.RootElement.TryGetProperty("suggest", out var sEl)
                    && sEl.ValueKind == System.Text.Json.JsonValueKind.Array)
                {
                    var list = new List<StelarithOobE.ClassSuggestion>();
                    foreach (var item in sEl.EnumerateArray())
                    {
                        list.Add(new StelarithOobE.ClassSuggestion
                        {
                            ClassId = item.TryGetProperty("class_id", out var c) ? (c.GetString() ?? "") : "",
                            Name = item.TryGetProperty("name", out var n) ? (n.GetString() ?? "") : "",
                            Code = item.TryGetProperty("code", out var cd) ? (cd.GetString() ?? "") : "",
                            Selectable = item.TryGetProperty("selectable", out var se)
                                && se.ValueKind == System.Text.Json.JsonValueKind.True,
                        });
                    }
                    StelarithOobE.SetSuggestions(list);
                }
            }
            catch { /* suggest 解析失败不影响回读主流程 */ }

            ReportDiag($"readback class_id={_authoritativeClassId} bound={bound}");
        }
        catch (Exception ex)
        {
            ReportDiag("ReadBackAuthoritativeClass failed: " + ex.Message);
        }
    }

    private static async Task<(bool Ok, string? Error)> PostStatus(StelarithSyncOptions opt, string json)
    {
        try
        {
            var url = $"{opt.ClientAppBase}/api/v1/client/{Uri.EscapeDataString(opt.ClientUid)}/status";
            using var req = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Headers = { Host = $"{opt.Slug}.{opt.BaseDomain}" },
                Content = new StringContent(json, Encoding.UTF8, "application/json"),
            };
            using var resp = await Http.SendAsync(req, CancellationToken.None);
            if (resp.IsSuccessStatusCode) return (true, null);
            return (false, $"HTTP {(int)resp.StatusCode}");
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    /// <summary>
    /// 设备自助注册班级（OOBE 收口）。POST /api/v1/client/{uid}/register，租户经 Host 头识别，
    /// 与心跳同一信任链，无需会话凭证。服务端只接受「已审核」班级，且「一班一号」——
    /// 已属别的班时返回 409（需先调 <see cref="UnregisterClass"/>）。
    /// 返回 (Ok, Error)；任何异常都收敛为 Error，绝不抛给调用方（UI 直接显示）。
    /// </summary>
    public static (bool Ok, string? Error) RegisterClass(string classId)
    {
        try
        {
            var opt = _staticOpt;
            if (opt is null) return (false, "配置未加载");
            if (string.IsNullOrWhiteSpace(classId)) return (false, "未选择班级");
            var url = $"{opt.ClientAppBase}/api/v1/client/{Uri.EscapeDataString(opt.ClientUid)}/register";
            using var req = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Headers = { Host = $"{opt.Slug}.{opt.BaseDomain}" },
                Content = new StringContent("{\"class_id\":\"" + classId.Replace("\"", "") + "\"}",
                    Encoding.UTF8, "application/json"),
            };
            using var resp = Http.SendAsync(req, CancellationToken.None).GetAwaiter().GetResult();
            if (resp.IsSuccessStatusCode)
                return (true, null);
            var body = resp.Content.ReadAsStringAsync().GetAwaiter().GetResult();
            return (false, $"HTTP {(int)resp.StatusCode} {body}");
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    /// <summary>
    /// 设备自助解除班级绑定（重新注册入口）：POST /api/v1/client/{uid}/unregister。
    /// 解绑后下次回读 bound=false，OOBE 引导重新弹出，引导教师重选班。
    /// </summary>
    public static (bool Ok, string? Error) UnregisterClass()
    {
        try
        {
            var opt = _staticOpt;
            if (opt is null) return (false, "配置未加载");
            var url = $"{opt.ClientAppBase}/api/v1/client/{Uri.EscapeDataString(opt.ClientUid)}/unregister";
            using var req = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Headers = { Host = $"{opt.Slug}.{opt.BaseDomain}" },
                Content = new StringContent("{}", Encoding.UTF8, "application/json"),
            };
            using var resp = Http.SendAsync(req, CancellationToken.None).GetAwaiter().GetResult();
            if (resp.IsSuccessStatusCode)
                return (true, null);
            var body = resp.Content.ReadAsStringAsync().GetAwaiter().GetResult();
            return (false, $"HTTP {(int)resp.StatusCode} {body}");
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    private static string SafeHostName()
    {
        try { return Environment.MachineName; }
        catch { return ""; }
    }

    /// <summary>本插件版本（取自程序集信息，与 manifest.yml 的 version 同源维护）。</summary>
    public static string PluginVersion()
    {
        try
        {
            var asm = typeof(StelarithStatusReporter).Assembly;
            var infoVersion = asm.GetCustomAttributes(typeof(System.Reflection.AssemblyInformationalVersionAttribute), false)
                .OfType<System.Reflection.AssemblyInformationalVersionAttribute>()
                .FirstOrDefault()?.InformationalVersion;
            if (!string.IsNullOrWhiteSpace(infoVersion))
                return infoVersion.Split('+')[0];
            return asm.GetName().Version?.ToString() ?? "";
        }
        catch { return ""; }
    }

    internal static void ReportDiag(string msg)
    {
        try
        {
                StelarithLog.Write("ste-status-diag.log", msg);
        }
        catch { /* 忽略 */ }
    }
}
