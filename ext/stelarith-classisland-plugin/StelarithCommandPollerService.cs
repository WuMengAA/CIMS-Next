using System;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace StelarithControlPlugin;

/// <summary>
/// 星璃·集控「命令轮询自取」后台服务（保留的兜底通道）。
///
/// 背景：本机 ClassIsland 尚未激活集控或被托管通道（IManagementService.Connection）不可用，
/// 因此 CIMS 经 gRPC 实时推送的 CommandReceived 事件永不触发。为绕开这一硬阻塞，
/// CIMS 后端在下发命令时把指令持久化到 command_queue（见 CIMS-backend
/// app/api/command/client_notification.py / client_control.py），教室端插件周期性地
/// 通过本服务调用 HTTP 轮询接口取走并执行——即「插件轮询自取」闭环。
///
/// 每条命令按官方 CommandTypes 语义（RestartApp / SendNotification / DataUpdated /
/// GetClientConfig）交 StelarithCommandHandler 统一处理——与 gRPC 实时通道语义完全一致，
/// 避免同一类命令在两通道各写一套逻辑。
///
/// 轮询端点（CIMS client_app，8096）：
///   GET {ClientAppBase}/api/v1/client/{ClientUid}/command/queued    Host: {Slug}.{BaseDomain}
/// 返回结构：{ "client_id": "...", "count": N, "commands": [ {id,type,payload,created_at} ] }
/// 该接口会原子地把取走的命令标记为 done，天然避免重复执行；空队列返回 count=0。
///
/// 存活机制（重要）：实测本机宿主启动时，其它插件（AIIsland 的考试通知过滤服务）会在
/// 非 UI 线程访问 Avalonia 属性抛 "Call from invalid thread"，导致宿主对 IHostedService
/// 的 StartAsync 序列异常中断，本插件的 BackgroundService 常不被启动（File 诊断显示
/// ExecuteAsync 未执行）。故与 StelarithPanelService 一致，采用「静态构造函数兜底」：
/// 类型一经实例化（宿主构建 DI 时会构造本服务），静态构造里即拉起一个独立守护线程执行
/// 轮询，不依赖宿主对 StartAsync 的调用。若宿主确实调用 StartAsync，则 ExecuteAsync 与
/// 守护线程可能各自轮询——为此守护线程用同一把锁（静态 _sync）互斥，保证同一时刻只有一个轮询循环在跑。
/// </summary>
public sealed class StelarithCommandPollerService : BackgroundService
{
    private readonly ILogger<StelarithCommandPollerService> _logger;
    private readonly StelarithSyncOptions _opt;
    private readonly StelarithCommandHandler _handler;
    private static readonly HttpClient Http = new();
    // 轮询优先取命令队列的间隔（最小 5 秒；与同步刷新间隔独立，避免互相干扰）
    private static readonly TimeSpan MinPollInterval = TimeSpan.FromSeconds(5);
    // 静态服务定位器（与 PanelService 一致），供静态守护线程取配置；构造时赋值
    private static StelarithSyncOptions? _staticOpt;
    private static ILogger<StelarithCommandPollerService>? _staticLogger;
    // 轮询循环互斥锁：宿主 StartAsync 与静态守护线程只能有一个在轮询
    private static readonly object PollLock = new();

    public StelarithCommandPollerService(
        ILogger<StelarithCommandPollerService> logger,
        StelarithSyncOptions opt)
    {
        _logger = logger;
        _opt = opt;
        _handler = new StelarithCommandHandler(logger);
        _staticLogger = logger;
        _staticOpt = opt;
    }

    static StelarithCommandPollerService()
    {
        // 兜底守护：宿主可能不调 StartAsync（AIIsland 启动异常连累），此处直接用后台线程拉起轮询
        PollerDiag("static ctor: 拉起守护轮询线程");
        var t = new Thread(() =>
        {
            try
            {
                while (true)
                {
                    try
                    {
                        // 仅在宿主未启动轮询时由守护线程执行（锁保证唯一）
                        if (_staticOpt is not null)
                            RunLoopGuarded();
                    }
                    catch (Exception ex)
                    {
                        PollerDiag($"guard loop exception: {ex.Message}");
                        Thread.Sleep(MinPollInterval);
                    }
                }
            }
            catch (ThreadAbortException) { /* 进程退出 */ }
        });
        t.IsBackground = true;
        t.Name = "stelarith-poller-guard";
        t.Start();
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // 宿主正常启动路径（可能不会被调用，见类注释）
        PollerDiag($"ExecuteAsync entered. opt: slug={_opt.Slug} uid={_opt.ClientUid}");
        _logger.LogInformation(
            "Stelarith poller: 宿主启动路径，轮询 Host={host} URL={url}（Slug={slug}, ClientUid={uid}）",
            $"{_opt.Slug}.{_opt.BaseDomain}",
            $"{_opt.ClientAppBase}/api/v1/client/{_opt.ClientUid}/command/queued",
            _opt.Slug, _opt.ClientUid);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                // 通过静态锁，保证与守护线程互斥
                lock (PollLock)
                {
                    if (_staticOpt is not null) PollOnceAsync(_staticOpt, _staticLogger).GetAwaiter().GetResult();
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Stelarith poller: 轮询命令队列失败，下个周期重试");
            }
            await Task.Delay(MinPollInterval, stoppingToken);
        }
    }

    /// <summary>守护线程循环：与 ExecuteAsync 互斥地持续轮询。</summary>
    private static void RunLoopGuarded()
    {
        while (true)
        {
            lock (PollLock)
            {
                PollOnceAsync(_staticOpt!, _staticLogger).GetAwaiter().GetResult();
            }
            Thread.Sleep(MinPollInterval);
        }
    }

    /// <summary>拉取一次命令队列并逐条交给统一处理器执行。</summary>
    private static async Task PollOnceAsync(StelarithSyncOptions opt, ILogger<StelarithCommandPollerService>? logger)
    {
        var host = $"{opt.Slug}.{opt.BaseDomain}";
        var url = $"{opt.ClientAppBase}/api/v1/client/{opt.ClientUid}/command/queued";

        using var req = new HttpRequestMessage(HttpMethod.Get, url) { Headers = { Host = host } };
        using var resp = await Http.SendAsync(req, CancellationToken.None);
        PollerDiag($"PollOnceAsync -> HTTP {(int)resp.StatusCode} (Host={host})");
        if (!resp.IsSuccessStatusCode)
        {
            logger?.LogWarning("Stelarith poller: GET {url} -> {code}", url, (int)resp.StatusCode);
            return;
        }

        var body = await resp.Content.ReadAsStringAsync();
        if (string.IsNullOrWhiteSpace(body)) return;

        BatchResponse? batch;
        try
        {
            batch = JsonSerializer.Deserialize<BatchResponse>(body);
        }
        catch (Exception ex)
        {
            logger?.LogWarning(ex, "Stelarith poller: 响应解析失败，忽略本轮");
            return;
        }
        if (batch is null || batch.Commands is null) return;

        foreach (var cmd in batch.Commands)
        {
            PollerDiag($"process cmd type={cmd.Type}");
            var handler = logger is null
                ? new StelarithCommandHandler(Microsoft.Extensions.Logging.Abstractions.NullLogger<StelarithCommandPollerService>.Instance)
                : new StelarithCommandHandler(logger);
            await handler.HandleAsync(cmd.Type, cmd.Payload, CancellationToken.None);
        }

        if (batch.Count > 0)
        {
            logger?.LogInformation("Stelarith poller: 本轮取走并处理 {n} 条命令", batch.Count);
        }
    }

    /// <summary>命令队列批量响应（对应 command_poll.py 返回结构）。</summary>
    private sealed class BatchResponse
    {
        public string? ClientId { get; set; }
        public int Count { get; set; }
        public QueuedCommand[]? Commands { get; set; }
    }

    /// <summary>
    /// 文件诊断（不依赖宿主 logger；宿主启动异常时 logger 可能被 Dispose 丢失）。
    /// 写入 AppContext.BaseDirectory/ste-poller-diag.log。
    /// </summary>
    private static void PollerDiag(string msg)
    {
        try
        {
            File.AppendAllText(
                Path.Combine(AppContext.BaseDirectory, "ste-poller-diag.log"),
                $"{DateTime.Now:HH:mm:ss.fff} {msg}{Environment.NewLine}");
        }
        catch { /* 忽略诊断写失败 */ }
    }

    /// <summary>单条待执行命令。</summary>
    private sealed class QueuedCommand
    {
        public long Id { get; set; }
        public string? Type { get; set; }
        public string? Payload { get; set; }
        public string? CreatedAt { get; set; }
    }
}