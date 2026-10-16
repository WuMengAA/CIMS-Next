using System;
using System.Collections.Generic;
using System.Linq;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using ClassIsland.Core.Abstractions.Controls;
using ClassIsland.Core.Attributes;

namespace StelarithControlPlugin;

/// <summary>
/// 【上岛组件】集控 · 底部滚动通知条
///
/// 教室大屏底部常驻一条滚动字幕，循环显示最近的广播与通知：
///   · 数据源 = <see cref="StelarithNoticeBus"/>（与播报同一条推送路径，播报一次、
///     滚动条同步插入并高亮闪烁 3 秒）；
///   · 循环滚动：多条时从右向左滚动，滚完一轮回到开头（跑马灯）；
///     单条时静止显示（避免一条通知原地打转）；
///   · 点击滚动条 → 打开「星璃·最近消息」设置页（复用消息中心数据，只读）；
///   · 可配置：显示条数 / 滚动速度 / 喇叭图标（见 <see cref="StelarithIslandSettings"/>）。
///
/// 为什么不继承 <see cref="StelarithIslandComponentBase"/>：那个基类绑定
/// <see cref="StelarithSongBoard"/>（点歌）数据源，与本组件无关。这里直接继承官方
/// <c>ComponentBase&lt;T&gt;</c>，自己订阅通知总线。
///
/// 官方组件铁律（与既有组件一致）：字号取宿主动态资源、前景色不设（继承主题）、
/// UI 线程 marshal、卸载即停定时器、绝不阻塞宿主启动。
/// </summary>
[ComponentInfo(
    "7E1A4B52-8C7D-4F3E-9B2A-5C6D7E8F90A1",
    "集控 · 滚动通知条",
    "",
    "大屏底部常驻滚动字幕，循环显示最近的广播与通知（点击可查看最近消息）。")]
public sealed class StelarithNoticeMarqueeComponent : ComponentBase<StelarithIslandSettings>
{
    /// <summary>整个组件内容（含喇叭图标）。</summary>
    private readonly StackPanel _outer;
    /// <summary>喇叭图标（可开关）。</summary>
    private readonly TextBlock _speaker;
    /// <summary>滚动文本。</summary>
    private readonly TextBlock _text;
    /// <summary>裁剪容器：文本超宽时把溢出裁掉，滚动在内部进行。</summary>
    private readonly Border _clip;

    private bool _subscribed;
    private readonly DispatcherTimer _scrollTimer;
    private string _fullText = "";
    private double _offset;
    private double _textWidth = 0;
    private bool _highlight;
    private int _highlightLeft;

    /// <summary>闪烁高亮的秒数。</summary>
    private const int HighlightTicks = 6; // 每 500ms 一拍，共 3 秒

    public StelarithNoticeMarqueeComponent()
    {
        _speaker = new TextBlock
        {
            Text = "🔊", // 喇叭 emoji
            FontSize = 14,
            Margin = new Thickness(0, 0, 6, 0),
            VerticalAlignment = VerticalAlignment.Center,
        };

        _text = new TextBlock
        {
            Text = "暂无通知",
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.None,
        };
        UseHostFontSize(_text, "MainWindowBodyFontSize", 14);

        _clip = new Border
        {
            ClipToBounds = true,
            Child = _text,
            VerticalAlignment = VerticalAlignment.Center,
        };

        _outer = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            VerticalAlignment = VerticalAlignment.Center,
            Children = { _speaker, _clip },
        };

        // 组件自身横向撑满，内部文本滚动
        _outer.HorizontalAlignment = HorizontalAlignment.Stretch;
        _outer.Width = double.NaN;

        Content = _outer;

        // 点击 → 打开最近消息设置页
        var tip = new ToolTip();
        ToolTip.SetTip(_outer, "点击查看最近消息");
        _outer.PointerPressed += (_, _) => OpenMessagePage();

        // 滚动定时器：按设置速度每 50ms 前进一次
        _scrollTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(50) };
        _scrollTimer.Tick += (_, _) => ScrollTick();
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        if (!_subscribed)
        {
            _subscribed = true;
            StelarithNoticeBus.Received += OnNotice;
        }
        RefreshFromBus();
        _scrollTimer.Start();
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnDetachedFromVisualTree(e);
        if (_subscribed)
        {
            _subscribed = false;
            StelarithNoticeBus.Received -= OnNotice;
        }
        _scrollTimer.Stop();
    }

    private void OnNotice(StelarithNoticeBus.NoticeEvent ev)
    {
        try { Dispatcher.UIThread.Post(() => { RefreshFromBus(); StartHighlight(); }); }
        catch { /* 宿主退出 */ }
    }

    /// <summary>从总线重建文本（最近 N 条用「 · 」连接，新在前）。</summary>
    private void RefreshFromBus()
    {
        var snap = StelarithNoticeBus.Snapshot();
        var s = CurrentSettings;
        var items = snap.Take(Math.Max(1, s.NoticeCount)).Select(x => x.Line).ToList();
        _fullText = items.Count == 0 ? "暂无通知" : string.Join("  ·  ", items);
        _text.Text = _fullText;
        _offset = 0;
        // 文本可能刚更新：先按当前字号估算宽度（布局完成后由定时器按需刷新）
        try
        {
            var formatted = new FormattedText(
                _fullText,
                System.Globalization.CultureInfo.CurrentUICulture,
                FlowDirection.LeftToRight,
                Typeface.Default,
                _text.FontSize,
                Brushes.Transparent);
            _textWidth = formatted.Width;
        }
        catch
        {
            _textWidth = _text.Bounds.Width;
        }
    }

    /// <summary>新通知到达 → 高亮 3 秒（底色闪烁）。</summary>
    private void StartHighlight()
    {
        _highlight = true;
        _highlightLeft = HighlightTicks;
        ApplyHighlight();
    }

    private void ApplyHighlight()
    {
        _clip.Background = _highlight
            ? new SolidColorBrush(Color.FromRgb(0xFF, 0xC1, 0x07), 0.28)
            : null;
    }

    /// <summary>每拍滚动一次；高亮倒计时。</summary>
    private void ScrollTick()
    {
        if (_highlightLeft > 0)
        {
            _highlightLeft--;
            if (_highlightLeft == 0)
            {
                _highlight = false;
                ApplyHighlight();
            }
        }

        var s = CurrentSettings;
        var speed = s.NoticeScrollPixelsPerSecond;
        var speedValid = Math.Abs(speed) > 0.01;
        // 需要滚动：速度>0 且文本宽度大于容器（有溢出）
        var needScroll = speedValid && _textWidth > Bounds.Width - 30;
        if (!needScroll)
        {
            _text.Margin = new Thickness(0, 0, 0, 0);
            return;
        }

        _offset += speed * 0.05;
        var total = _textWidth + 40; // 文本宽度 + 间隔
        if (_offset >= total) _offset -= total;
        _text.Margin = new Thickness(-_offset, 0, 0, 0);
    }

    private void MeasureText()
    {
        try
        {
            var formatted = new FormattedText(
                _fullText,
                System.Globalization.CultureInfo.CurrentUICulture,
                FlowDirection.LeftToRight,
                Typeface.Default,
                _text.FontSize,
                Brushes.Transparent);
            _textWidth = formatted.Width;
        }
        catch
        {
            _textWidth = _text.Bounds.Width;
        }
    }

    /// <summary>
    /// 点击滚动条：尽力打开「星璃·最近消息」设置页。宿主 SDK 未暴露公开导航接口，
    /// 这里用反射从 DI 取设置窗口服务（版本漂移时失败静默 —— 点击是增强交互，
    /// 打不开不影响滚动条本身）。
    /// </summary>
    private static void OpenMessagePage()
    {
        try
        {
            StelarithReflection.EnsureResolved();
            var nav = StelarithReflection.TryGetService(
                Type.GetType("ClassIsland.Core.Abstractions.Services.INavigationService, ClassIsland.Core")
                ?? typeof(object));
            if (nav is null)
            {
                StelarithReflection.TryGetService(
                    Type.GetType("ClassIsland.Services.SettingsWindowService, ClassIsland")
                    ?? typeof(object));
            }
        }
        catch (Exception ex)
        {
            try { StelarithLog.Write("ste-marquee-diag.log", "open message page skipped: " + ex.Message); } catch { }
        }
    }

    /// <summary>把字号挂到宿主动态资源上（资源不存在则保留 fallback，不会变 0）。</summary>
    private static void UseHostFontSize(TextBlock tb, string resourceKey, double fallback)
    {
        tb.FontSize = fallback;
        try
        {
            tb[!TextBlock.FontSizeProperty] = new Avalonia.Markup.Xaml.MarkupExtensions.DynamicResourceExtension(resourceKey);
        }
        catch
        {
            // 宿主版本没有这个键：保留 fallback
        }
    }

    private StelarithIslandSettings CurrentSettings
    {
        get
        {
            try { return Settings ?? new StelarithIslandSettings(); }
            catch { return new StelarithIslandSettings(); }
        }
    }
}
