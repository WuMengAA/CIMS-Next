using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace StelarithControlPlugin;

/// <summary>
/// 星璃·集控「消息中心」数据源：拉取本机最近的广播 / 通知历史，供 ClassIsland 岛内
/// （设置页「星璃·最近消息」与托盘入口）展示「年级电教委员聊天渠道 + 广播」的最近消息。
///
/// 数据来自 CIMS 客户端应用的**只读**消息端点（与命令轮询通道同租户、同 Host 头鉴权）：
///     GET {ClientAppBase}/api/v1/classisland/messages?client_id={uid}&limit=N
/// 该端点回读 command_queue 的广播类历史行，**不消费任何待执行命令**，
/// 因此可以在 UI 上反复刷新而不影响命令语义（详见 CIMS-backend/app/api/client/messages.py）。
///
/// 若 stelarith-sync.json 配了 MessageFeedBase（指向 website 侧聚合端点），则优先用它，
/// 以便把网页端「消息广播 + RSS 推送」的内容一并纳入教室端消息中心。
/// </summary>
public sealed class StelarithMessageFeed
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

    /// <summary>一条展示用消息。</summary>
    public sealed class Message
    {
        public long Id { get; set; }
        public string Type { get; set; } = "";
        public string Title { get; set; } = "";
        public string Content { get; set; } = "";
        public string Scope { get; set; } = "";
        public string Severity { get; set; } = "";
        public string At { get; set; } = "";
        public string Ack { get; set; } = "";

        /// <summary>用于列表展示的一行摘要。</summary>
        public string OneLine => $"[{At}] {Content}";

        /// <summary>友好时间（尽量转本地时间）。</summary>
        public string TimeText
        {
            get
            {
                if (DateTimeOffset.TryParse(At, out var dt)) return dt.ToLocalTime().ToString("MM-dd HH:mm");
                return At;
            }
        }
    }

    /// <summary>拉取结果。</summary>
    public sealed class FeedResult
    {
        public bool Ok { get; set; }
        public string? Error { get; set; }
        public string ClassId { get; set; } = "";
        public string ClassName { get; set; } = "";
        public List<Message> Messages { get; set; } = new();
        /// <summary>今日课表（若可用），供岛内一并展示。</summary>
        public List<string> TodayLessons { get; set; } = new();
    }

    /// <summary>最近一次拉取结果缓存（UI 首屏可直接渲染，避免空白等待）。</summary>
    public static FeedResult Last { get; private set; } = new() { Ok = false, Error = "尚未拉取" };

    public static void Diag(string msg)
    {
        try
        {
            File.AppendAllText(
                Path.Combine(AppContext.BaseDirectory, "ste-feed-diag.log"),
                $"{DateTime.Now:HH:mm:ss.fff} {msg}{Environment.NewLine}");
        }
        catch { /* 忽略 */ }
    }

    /// <summary>拉取最近消息（同步阻塞版，供 Avalonia 事件处理器直接调用）。</summary>
    public static FeedResult Fetch(StelarithSyncOptions opt, int limit = 20)
    {
        try
        {
            var r = FetchAsync(opt, limit, CancellationToken.None).GetAwaiter().GetResult();
            Last = r;
            return r;
        }
        catch (Exception ex)
        {
            Diag("Fetch exception: " + ex.Message);
            Last = new FeedResult { Ok = false, Error = ex.Message };
            return Last;
        }
    }

    /// <summary>拉取最近消息。</summary>
    public static async Task<FeedResult> FetchAsync(
        StelarithSyncOptions opt, int limit = 20, CancellationToken ct = default)
    {
        var host = $"{opt.Slug}.{opt.BaseDomain}";
        var baseUrl = string.IsNullOrWhiteSpace(opt.MessageFeedBase)
            ? opt.ClientAppBase
            : opt.MessageFeedBase.TrimEnd('/');
        var url =
            $"{baseUrl}/api/v1/classisland/messages?client_id={Uri.EscapeDataString(opt.ClientUid)}&limit={limit}";

        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, url)
            {
                Headers = { Host = host },
            };
            using var resp = await Http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode)
            {
                var err = $"HTTP {(int)resp.StatusCode}";
                Diag($"Fetch -> {err} ({url})");
                return new FeedResult { Ok = false, Error = err };
            }

            var body = await resp.Content.ReadAsStringAsync(ct);
            var dto = JsonSerializer.Deserialize<MessagesDto>(body, JsonOpts);
            var result = new FeedResult
            {
                Ok = true,
                ClassId = dto?.ClassId ?? "",
                ClassName = dto?.ClassName ?? "",
                Messages = new List<Message>(),
            };
            foreach (var m in dto?.Messages ?? new List<MessageDto>())
            {
                result.Messages.Add(new Message
                {
                    Id = m.Id,
                    Type = m.Type ?? "",
                    Title = m.Title ?? StelarithBranding.SourceName,
                    Content = m.Content ?? "",
                    Scope = m.Scope ?? "",
                    Severity = m.Severity ?? "",
                    At = m.At ?? "",
                    Ack = m.Ack ?? "",
                });
            }
            Diag($"Fetch ok: {result.Messages.Count} 条 (class={result.ClassId})");
            return result;
        }
        catch (Exception ex)
        {
            Diag("FetchAsync exception: " + ex.Message);
            return new FeedResult { Ok = false, Error = ex.Message };
        }
    }

    /// <summary>
    /// 拉取本班今日课表（走 CIMS 管理端 /class/{id}/schedule 的只读镜像端点）。
    /// 该端点需管理端鉴权，故这里只做「尽力而为」：失败静默，不影响消息展示。
    /// </summary>
    public static async Task<List<string>> FetchTodayLessonsAsync(
        StelarithSyncOptions opt, string classId, CancellationToken ct = default)
    {
        var outList = new List<string>();
        if (string.IsNullOrWhiteSpace(classId)) return outList;
        try
        {
            var url =
                $"{opt.ClientAppBase}/api/v1/client/{Uri.EscapeDataString(opt.ClientUid)}/schedule";
            var host = $"{opt.Slug}.{opt.BaseDomain}";
            using var req = new HttpRequestMessage(HttpMethod.Get, url) { Headers = { Host = host } };
            using var resp = await Http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode) return outList;
            var body = await resp.Content.ReadAsStringAsync(ct);
            using var doc = JsonDocument.Parse(body);
            // 端点未就绪时静默返回空；就绪后按「今天」的 ClassPlan 取课时名
            if (doc.RootElement.TryGetProperty("today_lessons", out var tl) &&
                tl.ValueKind == JsonValueKind.Array)
            {
                foreach (var x in tl.EnumerateArray())
                    outList.Add(x.GetString() ?? "");
            }
        }
        catch (Exception ex)
        {
            Diag("FetchTodayLessons failed: " + ex.Message);
        }
        return outList;
    }

    private sealed class MessagesDto
    {
        public string? ClientId { get; set; }
        public string? ClassId { get; set; }
        public string? ClassName { get; set; }
        public int Count { get; set; }
        public List<MessageDto>? Messages { get; set; }
    }

    private sealed class MessageDto
    {
        public long Id { get; set; }
        public string? Type { get; set; }
        public string? Title { get; set; }
        public string? Content { get; set; }
        public string? Scope { get; set; }
        public string? Severity { get; set; }
        public string? At { get; set; }
        public string? Ack { get; set; }
    }
}
