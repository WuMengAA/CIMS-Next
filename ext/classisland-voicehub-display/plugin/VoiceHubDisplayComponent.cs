using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Threading;
using ClassIsland.Core.Abstractions.Controls;
using ClassIsland.Core.Attributes;

namespace VoiceHub.Display;

/// <summary>
/// 校园点歌看板显示组件（ClassIsland 2.1.0.1 / Avalonia 版）。
///
/// 迁移说明：
///   原实现是 WPF（UserControl + XAML + System.Windows.Threading.DispatcherTimer），
///   而 ClassIsland 2.x 已迁移到 Avalonia，WPF 类型不可用。
///   本版改为纯代码构建 Avalonia UI（不依赖 AXAML 编译），并按本机真实 API：
///     · 组件基类 ClassIsland.Core.Abstractions.Controls.ComponentBase`1；
///     · 注册特性为 ComponentInfo（不存在 ComponentMetadata）；
///     · 无 ComponentControl 基类，直接在代码中设置 Content。
/// </summary>
[ComponentInfo(
    "a1f2c3b4-5d6e-4f7a-8b9c-0d1e2f3a4b5c",
    "校园点歌看板",
    "展示 voicehub 实时播放与队列，支持集控推送上屏")]
public class VoiceHubDisplayComponent : ComponentBase<VoiceHubSettings>
{
    private readonly HttpClient _http = new();
    private DispatcherTimer? _timer;

    private readonly TextBlock _forcedLabel = new()
    {
        Text = "· 集控已推送",
        FontSize = 10,
        Foreground = new SolidColorBrush(Color.Parse("#8a6bff")),
        Margin = new Avalonia.Thickness(8, 0, 0, 0),
        IsVisible = false,
        VerticalAlignment = Avalonia.Layout.VerticalAlignment.Center
    };
    private readonly TextBlock _title = new()
    {
        Text = "—", FontSize = 20, FontWeight = FontWeight.Bold,
        Foreground = new SolidColorBrush(Color.Parse("#eaf0ff"))
    };
    private readonly TextBlock _artist = new()
    {
        Text = "", FontSize = 13, Foreground = new SolidColorBrush(Color.Parse("#9aa6cf")),
        Margin = new Avalonia.Thickness(0, 2, 0, 0)
    };
    private readonly TextBlock _by = new()
    {
        Text = "", FontSize = 11, Foreground = new SolidColorBrush(Color.Parse("#9aa6cf")),
        Margin = new Avalonia.Thickness(0, 2, 0, 6)
    };
    private readonly StackPanel _queue = new() { MaxHeight = 120 };

    public VoiceHubDisplayComponent()
    {
        BuildUi();
        _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(Settings.RefreshSec) };
        _timer.Tick += async (_, _) => await RefreshAsync();
        _timer.Start();
        _ = RefreshAsync();
    }

    private void BuildUi()
    {
        var header = new StackPanel { Orientation = Avalonia.Layout.Orientation.Horizontal, Margin = new Avalonia.Thickness(0, 0, 0, 4) };
        header.Children.Add(new TextBlock
        {
            Text = "NOW PLAYING", FontSize = 10,
            Foreground = new SolidColorBrush(Color.Parse("#5b8cff")),
            VerticalAlignment = Avalonia.Layout.VerticalAlignment.Center
        });
        header.Children.Add(_forcedLabel);

        var root = new StackPanel { Margin = new Avalonia.Thickness(10, 6) };
        root.Children.Add(header);
        root.Children.Add(_title);
        root.Children.Add(_artist);
        root.Children.Add(_by);
        root.Children.Add(_queue);

        Content = new Border
        {
            Padding = new Avalonia.Thickness(10, 6),
            CornerRadius = new Avalonia.CornerRadius(10),
            BorderThickness = new Avalonia.Thickness(1),
            BorderBrush = new SolidColorBrush(Color.Parse("#232a44")),
            Background = new SolidColorBrush(Color.Parse("#141a2e")),
            Child = root
        };
    }

    private async Task RefreshAsync()
    {
        try
        {
            var json = await _http.GetStringAsync(Settings.BridgeUrl);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            var forcedEl = root.TryGetProperty("forced", out var f) && f.ValueKind != JsonValueKind.Null ? f : default;
            var now = forcedEl.ValueKind != JsonValueKind.Null && forcedEl.TryGetProperty("now", out var fn)
                ? fn
                : (root.TryGetProperty("now", out var n) ? n : default);

            if (now.ValueKind != JsonValueKind.Null)
            {
                _title.Text = now.TryGetProperty("title", out var t) ? t.GetString() ?? "—" : "—";
                _artist.Text = now.TryGetProperty("artist", out var a) ? a.GetString() ?? "" : "";
                _by.Text = now.TryGetProperty("by", out var b) ? b.GetString() ?? "" : "";
            }
            else
            {
                _title.Text = "暂无播放中曲目"; _artist.Text = ""; _by.Text = "";
            }

            bool forced = forcedEl.ValueKind != JsonValueKind.Null;
            _forcedLabel.IsVisible = forced;

            var queueEl = forced && forcedEl.TryGetProperty("queue", out var fq) && fq.ValueKind == JsonValueKind.Array
                ? fq
                : (root.TryGetProperty("queue", out var q) && q.ValueKind == JsonValueKind.Array ? q : default);

            _queue.Children.Clear();
            if (queueEl.ValueKind == JsonValueKind.Array)
            {
                int i = 1;
                foreach (var s in queueEl.EnumerateArray())
                {
                    var title = s.TryGetProperty("title", out var tt) ? tt.GetString() ?? "" : "";
                    var artist = s.TryGetProperty("artist", out var aa) ? aa.GetString() ?? "" : "";
                    var by = s.TryGetProperty("by", out var bb) ? bb.GetString() ?? "" : "";
                    _queue.Children.Add(new TextBlock
                    {
                        Text = $"{i++}. {title} — {artist}（{by}）",
                        FontSize = 12,
                        Foreground = new SolidColorBrush(Color.Parse("#c4ccea")),
                        Margin = new Avalonia.Thickness(0, 2)
                    });
                }
            }
        }
        catch
        {
            _title.Text = "代理未连接";
            _artist.Text = "";
            _by.Text = "";
        }
    }
}
