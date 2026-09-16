using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Threading;

// 注意：ClassIsland 插件 SDK 的命名空间/基类以你本地安装的版本为准。
// 本脚手架基于常见约定编写（ComponentBase<TSettings> + ComponentControl），
// 若编译报命名空间/属性错误，请对照 ClassIsland.Core / ClassIsland.Core.Abstractions 调整。
using ClassIsland.Core.Abstractions.Controls;

namespace VoiceHub.Display;

[ComponentMetadata(
    "VoiceHubDisplay",
    "校园点歌看板",
    "展示 voicehub 实时播放与队列，支持集控推送上屏",
    "Stellara")]
public class VoiceHubDisplayComponent : ComponentBase<VoiceHubSettings>
{
    private readonly HttpClient _http = new();
    private DispatcherTimer? _timer;

    private string _nowTitle = "—";
    private string _nowArtist = "";
    private string _nowBy = "";
    private bool _forced;
    private List<string> _queue = new();

    public string NowTitle { get => _nowTitle; set { _nowTitle = value; OnChanged(); } }
    public string NowArtist { get => _nowArtist; set { _nowArtist = value; OnChanged(); } }
    public string NowBy { get => _nowBy; set { _nowBy = value; OnChanged(); } }
    public bool Forced { get => _forced; set { _forced = value; OnChanged(); } }
    public List<string> Queue { get => _queue; set { _queue = value; OnChanged(); } }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnChanged([CallerMemberName] string? n = null)
        => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(n));

    public VoiceHubDisplayComponent()
    {
        _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(Settings.RefreshSec) };
        _timer.Tick += async (_, _) => await RefreshAsync();
        _timer.Start();
        _ = RefreshAsync();
    }

    private async Task RefreshAsync()
    {
        try
        {
            var json = await _http.GetStringAsync(Settings.BridgeUrl);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            var now = root.TryGetProperty("forced", out var f) && f.TryGetProperty("now", out var fn) && fn.ValueKind != JsonValueKind.Null
                ? fn : (root.TryGetProperty("now", out var n) ? n : default);
            if (now.ValueKind != JsonValueKind.Null)
            {
                NowTitle = now.GetProperty("title").GetString() ?? "—";
                NowArtist = now.TryGetProperty("artist", out var a) ? a.GetString() ?? "" : "";
                NowBy = now.TryGetProperty("by", out var b) ? b.GetString() ?? "" : "";
            }
            else
            {
                NowTitle = "暂无播放中曲目"; NowArtist = ""; NowBy = "";
            }

            Forced = root.TryGetProperty("forced", out var ff) && ff.ValueKind != JsonValueKind.Null;

            var queueEl = (Forced && ff.TryGetProperty("queue", out var fq) && fq.ValueKind == JsonValueKind.Array)
                ? fq : (root.TryGetProperty("queue", out var q) && q.ValueKind == JsonValueKind.Array ? q : default);
            var list = new List<string>();
            if (queueEl.ValueKind == JsonValueKind.Array)
            {
                int i = 1;
                foreach (var s in queueEl.EnumerateArray())
                {
                    var t = s.TryGetProperty("title", out var tt) ? tt.GetString() ?? "" : "";
                    var ar = s.TryGetProperty("artist", out var aa) ? aa.GetString() ?? "" : "";
                    var by = s.TryGetProperty("by", out var bb) ? bb.GetString() ?? "" : "";
                    list.Add($"{i++}. {t} — {ar}（{by}）");
                }
            }
            Queue = list;
        }
        catch
        {
            NowTitle = "代理未连接"; NowArtist = ""; NowBy = "";
        }
    }
}
