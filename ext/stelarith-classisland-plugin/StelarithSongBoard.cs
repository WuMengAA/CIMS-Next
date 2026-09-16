using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace StelarithControlPlugin;

/// <summary>点歌队列里的一首歌（展示用，字段已归一化）。</summary>
public sealed class SongEntry
{
    public string Title { get; set; } = "";
    public string Artist { get; set; } = "";
    public string Requester { get; set; } = "";
    public int Votes { get; set; }
    public int Sequence { get; set; }
    public string? Cover { get; set; }

    /// <summary>
    /// 点歌时登记的班级（VoiceHub 侧若未启用班级字段则为空）。
    /// 为空表示"全校可见"，组件在「只看本班」模式下会保留这类条目，避免漏播。
    /// </summary>
    public string Class { get; set; } = "";

    /// <summary>歌名 - 歌手（缺一自动省略）。</summary>
    public string TitleArtist =>
        string.IsNullOrWhiteSpace(Artist) ? Title : $"{Title} · {Artist}";

    /// <summary>名单里的一行：序号 + 歌名 + 点歌人。</summary>
    public string QueueLine
    {
        get
        {
            var head = Sequence > 0 ? $"{Sequence}. " : "";
            var by = string.IsNullOrWhiteSpace(Requester) ? "" : $"  — {Requester}";
            return $"{head}{TitleArtist}{by}";
        }
    }
}

/// <summary>点歌看板的完整快照。</summary>
public sealed class SongBoardData
{
    public SongEntry? Now { get; set; }
    public List<SongEntry> Queue { get; set; } = new();
    public DateTimeOffset At { get; set; } = DateTimeOffset.MinValue;
    public bool Ok { get; set; }
    public string? Error { get; set; }

    /// <summary>数据来源：cims（集控推送）/ voicehub（直连点歌站）/ none（未配置或未通）。</summary>
    public string Source { get; set; } = "none";

    /// <summary>本机所属班级的显示名（从宿主档案当前激活课表群推导，可能为空）。</summary>
    public string ClassLabel { get; set; } = "";

    public bool HasAny => Now is not null || Queue.Count > 0;

    /// <summary>面板/配件上的一行摘要（无数据时说明原因）。</summary>
    public string Summary
    {
        get
        {
            if (Now is not null) return $"正在播放：{Now.TitleArtist}";
            if (Queue.Count > 0) return $"待播 {Queue.Count} 首";
            if (!Ok) return string.IsNullOrWhiteSpace(Error) ? "点歌数据不可用" : $"点歌数据不可用：{Error}";
            return "今日暂无点歌";
        }
    }
}

/// <summary>
/// 星璃·集控「点歌看板」数据源。
///
/// 两条来源，按优先级：
///   ① **集控推送**（source=cims）：集控面板 / voicehub-sync 适配器把当前播放与待播队列写进
///      CIMS 的 Components/songboard 资源，教室端只读拉取。这是「老师/电教委员强制上屏」的通道。
///   ② **直连点歌站**（source=voicehub）：直接调 VoiceHub 开放 API（需 songs:read 的 x-api-key）。
///      用于没有经过 CIMS 中转、或集控侧没推过数据的场景。
///
/// 取值放在**静态构造函数拉起的守护线程**里（与 <see cref="StelarithStatusReporter"/> 同范式）：
/// 第三方插件的 BackgroundService 会因宿主启动序列被别的插件异常打断而整个不执行，
/// 守护线程不受影响 —— 这是本插件「存活不依赖宿主 hosted service」铁律的延续。
/// 全程 try-catch，任何网络异常只写日志、绝不外抛。
/// </summary>
public static class StelarithSongBoard
{
    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        PooledConnectionLifetime = TimeSpan.FromSeconds(5),
        PooledConnectionIdleTimeout = TimeSpan.FromSeconds(2),
        AutomaticDecompression = System.Net.DecompressionMethods.All,
    })
    { Timeout = TimeSpan.FromSeconds(10) };

    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };
    private static readonly object Lock = new();

    private static SongBoardData _current = new();
    private static StelarithSyncOptions? _opt;

    /// <summary>最近一次成功从 CIMS 拿到数据的时间（用于判断集控推送是否还新鲜）。</summary>
    private static DateTimeOffset _cimsFreshUntil = DateTimeOffset.MinValue;

    /// <summary>强制刷新标志（配置变更或 UI 手动刷新时置位）。</summary>
    private static volatile bool _force;

    /// <summary>当前快照（线程安全读取）。</summary>
    public static SongBoardData Current { get { lock (Lock) return _current; } }

    /// <summary>数据更新后触发（在后台线程，订阅方需自行 marshal 到 UI 线程）。</summary>
    public static event Action<SongBoardData>? Changed;

    /// <summary>请求立即刷新一次（不阻塞调用方）。</summary>
    public static void RequestRefresh() => _force = true;

    /// <summary>应用配置（Initialize 时调用；也可在设置页保存后再次调用）。</summary>
    public static void Configure(StelarithSyncOptions opt)
    {
        _opt = opt;
        _force = true;
    }

    internal static void Diag(string msg)
    {
        try
        {
            File.AppendAllText(
                Path.Combine(AppContext.BaseDirectory, "ste-songboard-diag.log"),
                $"{DateTime.Now:HH:mm:ss.fff} {msg}{Environment.NewLine}");
        }
        catch { /* 诊断写入失败忽略 */ }
    }

    static StelarithSongBoard()
    {
        Diag("static ctor: 拉起点歌看板守护线程");
        var t = new Thread(() =>
        {
            try
            {
                while (true)
                {
                    var delay = TimeSpan.FromSeconds(15);
                    try
                    {
                        var opt = _opt;
                        if (opt is not null)
                        {
                            delay = TimeSpan.FromSeconds(Math.Max(5, opt.SongboardRefreshSeconds));
                            var snap = FetchAsync(opt).GetAwaiter().GetResult();
                            Publish(snap);
                            // 一个来源都拿不到时拉长重试间隔，别把点歌站打爆
                            if (snap.Source == "none")
                                delay = TimeSpan.FromSeconds(Math.Max(30, opt.SongboardRefreshSeconds * 2));
                        }
                    }
                    catch (Exception ex)
                    {
                        Diag("guard loop exception: " + ex.Message);
                    }
                    SleepInterruptible(delay);
                }
            }
            catch (ThreadAbortException) { /* 进程退出 */ }
        })
        {
            IsBackground = true,
            Name = "stelarith-songboard-guard",
        };
        t.Start();
    }

    /// <summary>可被打断的等待：RequestRefresh() 置位后最多 250ms 内醒来，而不必干等整个周期。</summary>
    private static void SleepInterruptible(TimeSpan delay)
    {
        var left = (int)delay.TotalMilliseconds;
        while (left > 0)
        {
            if (_force) { _force = false; return; }
            var step = Math.Min(250, left);
            Thread.Sleep(step);
            left -= step;
        }
        _force = false;
    }

    private static void Publish(SongBoardData snap)
    {
        lock (Lock) _current = snap;
        try { Changed?.Invoke(snap); }
        catch (Exception ex) { Diag("Changed handler exception: " + ex.Message); }
    }

    /// <summary>拉一轮：先 CIMS 推送，再直连点歌站；都拿不到就返回一个带原因的空快照。</summary>
    private static async Task<SongBoardData> FetchAsync(StelarithSyncOptions opt)
    {
        var classLabel = StelarithClassIdentity.CurrentLabel;

        // ① 集控推送（CIMS Components/songboard）
        if (!string.IsNullOrWhiteSpace(opt.SongboardResource))
        {
            try
            {
                var json = await GetCimsResourceAsync(opt, opt.SongboardResource);
                var parsed = ParseSongboardJson(json, "cims");
                if (parsed is not null)
                {
                    parsed.ClassLabel = classLabel;
                    _cimsFreshUntil = DateTimeOffset.Now.AddMinutes(10);
                    return parsed;
                }
            }
            catch (Exception ex)
            {
                Diag("CIMS songboard 拉取失败：" + ex.Message);
            }
        }

        // ② 直连点歌站（VoiceHub 开放 API）
        if (!string.IsNullOrWhiteSpace(opt.VoiceHubBase))
        {
            try
            {
                var snap = await FetchFromVoiceHubAsync(opt);
                snap.ClassLabel = classLabel;
                return snap;
            }
            catch (Exception ex)
            {
                Diag("voicehub 直连失败：" + ex.Message);
                return new SongBoardData
                {
                    Ok = false,
                    Error = ex.Message,
                    Source = "voicehub",
                    At = DateTimeOffset.Now,
                    ClassLabel = classLabel,
                };
            }
        }

        return new SongBoardData
        {
            Ok = false,
            Error = string.IsNullOrWhiteSpace(opt.SongboardResource) ? "未配置点歌站" : "集控暂无点歌数据",
            Source = "none",
            At = DateTimeOffset.Now,
            ClassLabel = classLabel,
        };
    }

    /// <summary>读 CIMS 客户端资源（租户 Host 头 + 手动跟随 302，理由见 StelarithSyncService）。</summary>
    private static async Task<string?> GetCimsResourceAsync(StelarithSyncOptions opt, string resourceName)
    {
        var host = $"{opt.Slug}.{opt.BaseDomain}";
        var url = $"{opt.ClientAppBase}/api/v1/client/{Uri.EscapeDataString(resourceName)}?name={Uri.EscapeDataString(resourceName)}";
        var current = new Uri(url);
        for (var hop = 0; hop < 4; hop++)
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, current) { Headers = { Host = host } };
            using var resp = await Http.SendAsync(req, HttpCompletionOption.ResponseContentRead);
            if (resp.StatusCode is System.Net.HttpStatusCode.Redirect
                or System.Net.HttpStatusCode.Found
                or System.Net.HttpStatusCode.TemporaryRedirect
                or System.Net.HttpStatusCode.MovedPermanently)
            {
                var loc = resp.Headers.Location;
                if (loc is null) return null;
                current = loc.IsAbsoluteUri ? loc : new Uri(current, loc);
                continue;
            }
            if (!resp.IsSuccessStatusCode) return null;
            return await resp.Content.ReadAsStringAsync();
        }
        return null;
    }

    /// <summary>把集控写入的 {now, queue} 或裸数组解析成快照。</summary>
    private static SongBoardData? ParseSongboardJson(string? json, string source)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            // 资源可能被包一层 {value: "...json..."} 或 {"Value": {...}}（CIMS 资源信封）
            if (root.ValueKind == JsonValueKind.Object)
            {
                foreach (var key in new[] { "value", "Value", "data", "Data" })
                {
                    if (root.TryGetProperty(key, out var inner))
                    {
                        if (inner.ValueKind == JsonValueKind.String && inner.GetString() is { Length: > 0 } s)
                            return ParseSongboardJson(s, source);
                        if (inner.ValueKind == JsonValueKind.Object) root = inner;
                        break;
                    }
                }
            }

            SongEntry? now = null;
            var queue = new List<SongEntry>();

            if (root.ValueKind == JsonValueKind.Array)
            {
                queue = root.EnumerateArray().Select(e => ReadEntry(e)).Where(e => e is not null).Select(e => e!).ToList();
            }
            else if (root.ValueKind == JsonValueKind.Object)
            {
                if (root.TryGetProperty("now", out var n) && n.ValueKind == JsonValueKind.Object)
                    now = ReadEntry(n);
                if (root.TryGetProperty("queue", out var q) && q.ValueKind == JsonValueKind.Array)
                    queue = q.EnumerateArray().Select(e => ReadEntry(e)).Where(e => e is not null).Select(e => e!).ToList();
            }
            else
            {
                return null;
            }

            for (var i = 0; i < queue.Count; i++)
                if (queue[i].Sequence <= 0) queue[i].Sequence = i + 1;

            return new SongBoardData
            {
                Now = now,
                Queue = queue,
                Ok = true,
                Source = source,
                At = DateTimeOffset.Now,
            };
        }
        catch (Exception ex)
        {
            Diag("ParseSongboardJson 失败：" + ex.Message);
            return null;
        }
    }

    private static SongEntry? ReadEntry(JsonElement e)
    {
        if (e.ValueKind != JsonValueKind.Object) return null;
        string S(string k)
        {
            if (!e.TryGetProperty(k, out var v)) return "";
            return v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : v.ToString();
        }
        int I(string k)
        {
            if (!e.TryGetProperty(k, out var v)) return 0;
            if (v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n)) return n;
            return int.TryParse(v.ToString(), out var m) ? m : 0;
        }

        var title = S("title");
        if (string.IsNullOrWhiteSpace(title)) title = S("Title");
        if (string.IsNullOrWhiteSpace(title) && e.TryGetProperty("song", out var song) && song.ValueKind == JsonValueKind.Object)
            return ReadEntry(song);
        if (string.IsNullOrWhiteSpace(title)) return null;

        var cover = S("cover");
        if (string.IsNullOrWhiteSpace(cover)) cover = S("Cover");

        return new SongEntry
        {
            Title = title,
            Artist = FirstNonEmpty(S("artist"), S("Artist")),
            Requester = FirstNonEmpty(S("by"), S("requester"), S("Requester")),
            Votes = I("votes") is 0 ? I("voteCount") : I("votes"),
            Sequence = FirstInt(I("sequence"), I("Sequence")),
            Cover = string.IsNullOrWhiteSpace(cover) ? null : cover,
            Class = FirstNonEmpty(S("class"), S("className"), S("classRoom"), S("Class")),
        };
    }

    private static string FirstNonEmpty(params string[] vals) => vals.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v)) ?? "";
    private static int FirstInt(params int[] vals) => vals.FirstOrDefault(v => v != 0);

    /// <summary>直连 VoiceHub 开放 API：当前播放（最近已播）+ 待播队列。</summary>
    private static async Task<SongBoardData> FetchFromVoiceHubAsync(StelarithSyncOptions opt)
    {
        var b = opt.VoiceHubBase.TrimEnd('/');
        var nowJson = await VhubGetAsync(b, opt.VoiceHubKey,
            "/api/open/songs?played=true&sortBy=playedAt&sortOrder=desc&limit=1");
        var queueJson = await VhubGetAsync(b, opt.VoiceHubKey,
            "/api/open/songs?played=false&sortBy=createdAt&sortOrder=asc&limit=20");

        var now = ReadFirstSong(nowJson);
        var queue = new List<SongEntry>();
        try
        {
            using var doc = JsonDocument.Parse(queueJson);
            if (doc.RootElement.TryGetProperty("data", out var d) && d.TryGetProperty("songs", out var songs) && songs.ValueKind == JsonValueKind.Array)
            {
                var i = 1;
                foreach (var s in songs.EnumerateArray())
                {
                    var e = ReadEntry(s);
                    if (e is null) continue;
                    e.Sequence = i++;
                    queue.Add(e);
                }
            }
        }
        catch (Exception ex)
        {
            Diag("解析 voicehub 队列失败：" + ex.Message);
        }

        return new SongBoardData
        {
            Now = now,
            Queue = queue,
            Ok = true,
            Source = "voicehub",
            At = DateTimeOffset.Now,
        };
    }

    private static SongEntry? ReadFirstSong(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("data", out var d)
                && d.TryGetProperty("songs", out var songs)
                && songs.ValueKind == JsonValueKind.Array
                && songs.GetArrayLength() > 0)
            {
                return ReadEntry(songs[0]);
            }
        }
        catch (Exception ex) { Diag("解析 voicehub 当前播放失败：" + ex.Message); }
        return null;
    }

    private static async Task<string> VhubGetAsync(string baseUrl, string key, string path)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, baseUrl + path);
        if (!string.IsNullOrWhiteSpace(key)) req.Headers.TryAddWithoutValidation("x-api-key", key);
        using var resp = await Http.SendAsync(req);
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadAsStringAsync();
    }
}
