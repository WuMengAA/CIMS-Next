using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Shapes;
using Avalonia.Layout;
using Avalonia.Markup.Xaml.MarkupExtensions;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Threading;
using ClassIsland.Core.Abstractions.Controls;
using ClassIsland.Core.Attributes;

namespace StelarithControlPlugin;

/// <summary>
/// 上岛组件的共享设置。
///
/// 与官方的做法保持一致的两条：
///   ① 字号不写死 —— 用宿主注入的 <c>MainWindowBodyFontSize</c> 一类动态资源，
///      这样在岛上与 ClassIsland 原生组件视觉一致（用户在设置里调主界面字号时一起变）。
///   ② 前景色**完全不设** —— 继承父级主题画刷。此前设置页写死 <c>Brushes.White</c>，
///      浅色主题下白字白底看不清，组件如果再犯同样错误会更严重（组件是常驻显示）。
/// </summary>
public sealed class StelarithIslandSettings : INotifyPropertyChanged
{
    private bool _showCover = true;
    private bool _showClassLabel = true;
    private int _queueCount = 6;
    private double _scrollPixelsPerSecond = 18;
    private bool _onlyOwnClass;

    /// <summary>点歌组件是否显示封面（关掉可减少带宽，树莓派/老机器建议关）。</summary>
    public bool ShowCover
    {
        get => _showCover;
        set { if (_showCover != value) { _showCover = value; Raise(); } }
    }

    /// <summary>是否在组件上显示「本班级」标签。</summary>
    public bool ShowClassLabel
    {
        get => _showClassLabel;
        set { if (_showClassLabel != value) { _showClassLabel = value; Raise(); } }
    }

    /// <summary>滚动名单里展示多少首（1~30）。</summary>
    public int QueueCount
    {
        get => _queueCount;
        set { var v = Math.Clamp(value, 1, 30); if (_queueCount != v) { _queueCount = v; Raise(); } }
    }

    /// <summary>名单滚动速度（像素/秒，0 = 不滚动）。</summary>
    public double ScrollPixelsPerSecond
    {
        get => _scrollPixelsPerSecond;
        set { var v = Math.Clamp(value, 0, 200); if (Math.Abs(_scrollPixelsPerSecond - v) > 0.01) { _scrollPixelsPerSecond = v; Raise(); } }
    }

    /// <summary>只看本班点歌（数据里带班级字段时生效）。</summary>
    public bool OnlyOwnClass
    {
        get => _onlyOwnClass;
        set { if (_onlyOwnClass != value) { _onlyOwnClass = value; Raise(); } }
    }

    // ─── 底部滚动通知条设置（marquee 组件）───
    private int _noticeCount = 5;
    private double _noticeScrollPixelsPerSecond = 24;
    private bool _showSpeaker = true;

    /// <summary>滚动条展示的最近通知条数（1~20）。</summary>
    public int NoticeCount
    {
        get => _noticeCount;
        set { var v = Math.Clamp(value, 1, 20); if (_noticeCount != v) { _noticeCount = v; Raise(); } }
    }

    /// <summary>滚动速度（像素/秒，0 = 静止显示最新一条）。</summary>
    public double NoticeScrollPixelsPerSecond
    {
        get => _noticeScrollPixelsPerSecond;
        set { var v = Math.Clamp(value, 0, 200); if (Math.Abs(_noticeScrollPixelsPerSecond - v) > 0.01) { _noticeScrollPixelsPerSecond = v; Raise(); } }
    }

    /// <summary>是否显示左侧喇叭图标。</summary>
    public bool ShowSpeaker
    {
        get => _showSpeaker;
        set { if (_showSpeaker != value) { _showSpeaker = value; Raise(); } }
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void Raise([CallerMemberName] string? name = null)
        => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

/// <summary>
/// 上岛组件的公共基类：统一处理
///   · 数据源订阅 / 退订（<see cref="StelarithSongBoard.Changed"/>）
///   · 把后台线程回调 marshal 到 UI 线程
///   · 宿主字号动态资源套用
///   · 卸载后彻底停止定时器（避免组件被移除后还在跑）
/// </summary>
public abstract class StelarithIslandComponentBase : ComponentBase<StelarithIslandSettings>
{
    private bool _subscribed;
    private readonly List<DispatcherTimer> _timers = new();

    /// <summary>组件可见的根容器（子类把自己的 UI 放这里）。</summary>
    protected readonly Panel Root = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };

    protected StelarithIslandComponentBase()
    {
        // 用 StackPanel 而非 Grid：岛上组件的可用宽度由排版决定，纵向堆叠最能自适应。
        var outer = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        outer.Children.Add(Root);
        Content = outer;
        ClipToBounds = true;
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        if (!_subscribed)
        {
            _subscribed = true;
            StelarithSongBoard.Changed += OnBoardChangedSafe;
        }
        // 首次立即渲染当前快照（守护线程可能早已拉到数据）
        SafeUpdate();
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnDetachedFromVisualTree(e);
        if (_subscribed)
        {
            _subscribed = false;
            StelarithSongBoard.Changed -= OnBoardChangedSafe;
        }
        foreach (var t in _timers) { try { t.Stop(); } catch { } }
        _timers.Clear();
    }

    private void OnBoardChangedSafe(SongBoardData data)
    {
        // 数据源在守护线程触发 → 必须切回 UI 线程再碰控件
        try { Dispatcher.UIThread.Post(SafeUpdate); }
        catch { /* 宿主正在退出 */ }
    }

    private void SafeUpdate()
    {
        try { Update((StelarithSongBoard.Current)); }
        catch (Exception ex) { StelarithSongBoard.Diag(GetType().Name + " Update exception: " + ex.Message); }
    }

    /// <summary>子类实现：按最新快照重建/刷新自己的 UI。</summary>
    protected abstract void Update(SongBoardData data);

    /// <summary>把字号挂到宿主动态资源上（资源不存在则保留 fallback，不会变 0）。</summary>
    protected static void UseHostFontSize(TextBlock tb, string resourceKey, double fallback)
    {
        tb.FontSize = fallback;
        try
        {
            tb[!TextBlock.FontSizeProperty] = new DynamicResourceExtension(resourceKey);
        }
        catch
        {
            // 宿主版本没有这个键：保留 fallback
        }
    }

    /// <summary>注册一个随组件生命周期自动停止的定时器。</summary>
    protected DispatcherTimer CreateTimer(TimeSpan interval, EventHandler tick)
    {
        var t = new DispatcherTimer { Interval = interval };
        t.Tick += tick;
        _timers.Add(t);
        return t;
    }

    /// <summary>设置类（可能尚未注入，取不到时用一份默认值，绝不因此崩组件）。</summary>
    protected StelarithIslandSettings CurrentSettings
    {
        get
        {
            try { return Settings ?? new StelarithIslandSettings(); }
            catch { return new StelarithIslandSettings(); }
        }
    }

    /// <summary>按「只看本班」过滤 + 截断。</summary>
    protected List<SongEntry> VisibleQueue(SongBoardData data)
    {
        var s = CurrentSettings;
        IEnumerable<SongEntry> q = data.Queue;
        if (s.OnlyOwnClass)
        {
            var own = StelarithClassIdentity.CurrentLabel;
            // 班级字段为空的条目视为「全校可见」，保留 —— 否则漏播比多播更难排查
            q = q.Where(x => string.IsNullOrWhiteSpace(x.Class)
                             || (!string.IsNullOrWhiteSpace(own) && x.Class.Contains(own, StringComparison.OrdinalIgnoreCase)));
        }
        return q.Take(s.QueueCount).ToList();
    }

    /// <summary>统一的占位文案块。</summary>
    protected static TextBlock Placeholder(string text, double size = 13)
    {
        var tb = new TextBlock { Text = text, VerticalAlignment = VerticalAlignment.Center };
        UseHostFontSize(tb, "MainWindowSecondaryFontSize", size);
        tb.Opacity = StelarithTheme.FaintOpacity;
        return tb;
    }
}

/// <summary>
/// 【上岛组件】本班级点歌 · 正在播放
///
/// 展示当前（或最近一首已播）的点歌歌曲：封面 + 歌名/歌手 + 点歌人，右上角标本班。
/// 数据来自 <see cref="StelarithSongBoard"/>（优先集控推送，其次直连点歌站）。
/// </summary>
[ComponentInfo(
    "8F3A2C41-7B6D-4E52-9A18-C2D4E6F8A0B1",
    "集控 · 正在播放",
    "\uE8D6",
    "显示本班正在播放的点歌歌曲（歌名、歌手、点歌人、封面）。数据来自集控推送或校园点歌站。")]
public sealed class StelarithNowPlayingComponent : StelarithIslandComponentBase
{
    private readonly Border _coverBox;
    private readonly Image _cover;
    private readonly TextBlock _head;
    private readonly TextBlock _title;
    private readonly TextBlock _sub;
    private readonly TextBlock _classTag;

    private string? _coverUrl;
    private static readonly Dictionary<string, Bitmap?> CoverCache = new(StringComparer.OrdinalIgnoreCase);

    public StelarithNowPlayingComponent()
    {
        _cover = new Image { Stretch = Stretch.UniformToFill, Width = 34, Height = 34 };
        _coverBox = new Border
        {
            Width = 38,
            Height = 38,
            CornerRadius = new CornerRadius(5),
            ClipToBounds = true,
            Margin = new Thickness(0, 0, 8, 0),
            VerticalAlignment = VerticalAlignment.Center,
            Child = _cover,
            IsVisible = false,
        };

        _head = new TextBlock { Text = "正在播放" };
        UseHostFontSize(_head, "MainWindowSecondaryFontSize", 12);
        _head.Opacity = StelarithTheme.SubtleOpacity;

        _title = new TextBlock { Text = "—", FontWeight = FontWeight.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 260 };
        UseHostFontSize(_title, "MainWindowBodyFontSize", 14);

        _sub = new TextBlock { Text = "", TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 260 };
        UseHostFontSize(_sub, "MainWindowSecondaryFontSize", 12);
        _sub.Opacity = StelarithTheme.SubtleOpacity;

        _classTag = new TextBlock { Text = "", VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(8, 0, 0, 0) };
        UseHostFontSize(_classTag, "MainWindowSecondaryFontSize", 12);
        _classTag.Opacity = StelarithTheme.SubtleOpacity;

        var texts = new StackPanel
        {
            Orientation = Orientation.Vertical,
            VerticalAlignment = VerticalAlignment.Center,
            Children = { _head, _title, _sub },
        };

        Root.Children.Add(_coverBox);
        Root.Children.Add(texts);
        Root.Children.Add(_classTag);
    }

    protected override void Update(SongBoardData data)
    {
        var s = CurrentSettings;
        _classTag.Text = s.ShowClassLabel ? data.ClassLabel : "";

        var now = data.Now;
        if (now is null)
        {
            _title.Text = data.HasAny ? "暂无播放中的点歌" : data.Summary;
            _sub.Text = "";
            _coverBox.IsVisible = false;
            _coverUrl = null;
            return;
        }

        _title.Text = now.TitleArtist;
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(now.Requester)) parts.Add($"点歌：{now.Requester}");
        if (now.Votes > 0) parts.Add($"{now.Votes} 票");
        _sub.Text = string.Join(" · ", parts);

        var showCover = s.ShowCover && !string.IsNullOrWhiteSpace(now.Cover);
        _coverBox.IsVisible = showCover;
        if (showCover) LoadCover(now.Cover!);
    }

    /// <summary>封面异步加载（带内存缓存；失败就隐藏封面，绝不让组件显示破图）。</summary>
    private void LoadCover(string url)
    {
        if (string.Equals(_coverUrl, url, StringComparison.OrdinalIgnoreCase)) return;
        _coverUrl = url;

        lock (CoverCache)
        {
            if (CoverCache.TryGetValue(url, out var cached))
            {
                _cover.Source = cached;
                return;
            }
        }

        _ = Task.Run(async () =>
        {
            Bitmap? bmp = null;
            try
            {
                var disk = CoverCachePath(url);
                byte[]? bytes = null;
                if (File.Exists(disk))
                {
                    bytes = await File.ReadAllBytesAsync(disk);
                }
                else
                {
                    using var http = new System.Net.Http.HttpClient { Timeout = TimeSpan.FromSeconds(8) };
                    bytes = await http.GetByteArrayAsync(url);
                    if (bytes.Length is > 0 and < 2 * 1024 * 1024)
                    {
                        try { File.WriteAllBytes(disk, bytes); } catch { }
                    }
                }
                if (bytes is { Length: > 0 and < 2 * 1024 * 1024 })
                {
                    using var ms = new MemoryStream(bytes);
                    bmp = Bitmap.DecodeToHeight(ms, 96);
                }
            }
            catch (Exception ex)
            {
                StelarithSongBoard.Diag("封面加载失败：" + ex.Message);
            }

            var loaded = bmp;
            Dispatcher.UIThread.Post(() =>
            {
                lock (CoverCache)
                {
                    if (CoverCache.Count > 24) CoverCache.Clear();
                    CoverCache[url] = loaded;
                }
                if (string.Equals(_coverUrl, url, StringComparison.OrdinalIgnoreCase))
                {
                    _cover.Source = loaded;
                    _coverBox.IsVisible = loaded is not null;
                }
            });
        });
    }

    /// <summary>
    /// 封面磁盘缓存路径。注意用 <c>System.IO.Path</c> 全名限定：本文件同时 using 了
    /// <c>Avalonia.Controls.Shapes</c>（为 Ellipse），其中的 <c>Path</c> 形状会与 IO 的 Path 撞名。
    /// </summary>
    private static string CoverCachePath(string url)
    {
        var dir = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "stelarith-covers");
        try { Directory.CreateDirectory(dir); } catch { }
        using var md5 = System.Security.Cryptography.MD5.Create();
        var hash = Convert.ToHexString(md5.ComputeHash(System.Text.Encoding.UTF8.GetBytes(url)));
        return System.IO.Path.Combine(dir, hash + ".img");
    }
}

/// <summary>
/// 【上岛组件】点歌名单（上下循环滚动）
///
/// 把待播队列竖向滚动展示。滚动用 <see cref="TranslateTransform"/> 位移实现，
/// 而不是 <c>ScrollViewer</c> 自动滚动 —— 后者在组件高度由宿主排版决定时容易拿不到
/// 正确的可滚动范围（组件会被压成零高），位移法只依赖内容实测高度，稳定得多。
/// 内容不足一屏时自动停止滚动，不留空白。
/// </summary>
[ComponentInfo(
    "8F3A2C42-7B6D-4E52-9A18-C2D4E6F8A0B2",
    "集控 · 点歌名单",
    "\uE8FD",
    "上下滚动展示校园点歌待播队列（序号、歌名、点歌人），支持只看本班。")]
public sealed class StelarithSongQueueComponent : StelarithIslandComponentBase
{
    private readonly TextBlock _head;
    private readonly Canvas _viewport;
    private readonly StackPanel _list;
    private readonly TranslateTransform _transform = new();
    private readonly DispatcherTimer _scrollTimer;

    private double _y;
    private double _contentHeight;
    private bool _paused = true;

    public StelarithSongQueueComponent()
    {
        _head = new TextBlock { Text = "点歌名单" };
        UseHostFontSize(_head, "MainWindowSecondaryFontSize", 12);
        _head.Opacity = StelarithTheme.SubtleOpacity;
        _head.Margin = new Thickness(0, 0, 10, 0);
        _head.VerticalAlignment = VerticalAlignment.Top;

        _list = new StackPanel { Orientation = Orientation.Vertical };
        _list.RenderTransform = _transform;

        _viewport = new Canvas
        {
            ClipToBounds = true,
            Height = 74,
            MinWidth = 190,
            Children = { _list },
        };

        Root.Children.Add(_head);
        Root.Children.Add(_viewport);

        _list.SizeChanged += (_, e) =>
        {
            _contentHeight = e.NewSize.Height;
            ResetIfNeeded();
        };
        _viewport.SizeChanged += (_, _) => ResetIfNeeded();

        // 20fps 足够顺滑，且比 60fps 省 CPU（教室一体机常年开机）
        _scrollTimer = CreateTimer(TimeSpan.FromMilliseconds(50), (_, _) => Step());
        _scrollTimer.Start();
    }

    private bool CanScroll =>
        CurrentSettings.ScrollPixelsPerSecond > 0.5
        && _contentHeight > _viewport.Bounds.Height + 2
        && _viewport.Bounds.Height > 0;

    private void ResetIfNeeded()
    {
        if (_contentHeight <= _viewport.Bounds.Height + 2)
        {
            _y = 0;
            _transform.Y = 0;
            _paused = true;
        }
        else
        {
            _paused = false;
        }
    }

    private void Step()
    {
        if (_paused || !CanScroll) return;
        var speed = CurrentSettings.ScrollPixelsPerSecond;
        _y -= speed * 0.05;                       // 每 tick 50ms
        // 滚出整份内容后无缝回顶。留 12px 停顿时长，避免两首之间粘连看不清。
        if (-_y >= _contentHeight + 12) _y = 0;
        _transform.Y = _y;
    }

    protected override void Update(SongBoardData data)
    {
        var queue = VisibleQueue(data);
        _head.Text = queue.Count > 0 ? $"点歌名单 · {queue.Count}" : "点歌名单";

        _list.Children.Clear();
        if (queue.Count == 0)
        {
            _list.Children.Add(Placeholder(data.Summary));
            _y = 0;
            _transform.Y = 0;
            _paused = true;
            return;
        }

        foreach (var song in queue)
        {
            var line = new TextBlock
            {
                Text = song.QueueLine,
                TextTrimming = TextTrimming.CharacterEllipsis,
                MaxWidth = 300,
                Margin = new Thickness(0, 0, 0, 2),
            };
            UseHostFontSize(line, "MainWindowBodyFontSize", 13);
            _list.Children.Add(line);
        }

        // 重建后高度要等一次布局才有值 → 下一帧再判断是否需要滚动
        Dispatcher.UIThread.Post(() =>
        {
            try { _contentHeight = _list.Bounds.Height; } catch { }
            ResetIfNeeded();
        }, DispatcherPriority.Background);
    }
}

/// <summary>
/// 【上岛组件】集控状态
///
/// 一行小控件：状态点（在线/离线）+ 班级 + 设备标识 + 点歌数据来源。
/// 用途是让电教委员一眼看出「这台机器还在集控里吗、数据从哪来」，
/// 排障时不用去翻日志文件。
/// </summary>
[ComponentInfo(
    "8F3A2C43-7B6D-4E52-9A18-C2D4E6F8A0B3",
    "集控 · 状态",
    "\uE73E",
    "显示本机集控在线状态、所属班级、设备标识与点歌数据来源。")]
public sealed class StelarithStatusComponent : StelarithIslandComponentBase
{
    private readonly Ellipse _dot;
    private readonly TextBlock _text;

    public StelarithStatusComponent()
    {
        _dot = new Ellipse { Width = 8, Height = 8, Margin = new Thickness(0, 0, 7, 0), VerticalAlignment = VerticalAlignment.Center };
        _text = new TextBlock { Text = "集控状态读取中…", VerticalAlignment = VerticalAlignment.Center };
        UseHostFontSize(_text, "MainWindowBodyFontSize", 13);

        Root.Children.Add(_dot);
        Root.Children.Add(_text);
    }

    protected override void Update(SongBoardData data)
    {
        var opt = SafeOptions();
        var parts = new List<string>();

        var online = data.Source != "none";
        parts.Add(online ? "集控在线" : "集控离线");
        if (!string.IsNullOrWhiteSpace(data.ClassLabel)) parts.Add(data.ClassLabel);
        if (!string.IsNullOrWhiteSpace(opt?.ClientUid)) parts.Add(opt!.ClientUid);
        parts.Add(data.Source switch
        {
            "cims" => "来源：集控推送",
            "voicehub" => "来源：点歌站",
            _ => "来源：无",
        });

        _text.Text = string.Join(" · ", parts);
        _dot.Fill = online ? StelarithTheme.Success : StelarithTheme.Danger;
        // Tip 是附加属性，只能经 SetTip 设置（没有实例属性）
        ToolTip.SetTip(_dot, online ? "集控数据通道正常" : "未取到集控数据（检查网络或配置）");
    }

    private static StelarithSyncOptions? SafeOptions()
    {
        try { return StelarithSyncOptions.Load(); }
        catch { return null; }
    }
}
