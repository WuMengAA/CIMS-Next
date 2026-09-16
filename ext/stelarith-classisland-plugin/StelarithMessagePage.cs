using System;
using System.Threading.Tasks;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using ClassIsland.Core.Abstractions.Controls;
using ClassIsland.Core.Attributes;
using ClassIsland.Core.Enums.SettingsWindow;

namespace StelarithControlPlugin;

/// <summary>
/// 星璃·消息中心（展示于 ClassIsland 设置窗口侧边栏，Category=External）。
///
/// 满足「可在 ClassIsland 上岛查看最近消息」：教室一体机上不必打开浏览器，
/// 直接在设置窗口里看到本机所属班级的**最近广播/通知**（来自
/// <see cref="StelarithMessageFeed"/>，只读、不消费命令）。
///
/// 配色：**不再写死任何前景色**。旧实现整页 `Brushes.White` / `#C8FFFFFF`，
/// 在浅色主题下白字白底完全不可读（见 <see cref="StelarithTheme"/> 的说明）。
/// 现在正文继承宿主主题前景色，层级靠 `Opacity`，卡片底色/边框按主题分支取色，
/// 并订阅主题切换实时刷新。
/// </summary>
[SettingsPageInfo(
    "stelarith_messages",
    "星璃·最近消息",
    false,
    SettingsPageCategory.External)]
public class StelarithMessagePage : SettingsPageBase
{
    private readonly StackPanel _listPanel;
    private readonly TextBlock _statusText;
    private readonly TextBlock _profileText;
    private readonly TextBox _groupBox;
    private readonly Border _listCard;

    public StelarithMessagePage()
    {
        StelarithTheme.EnsureHooked();
        StelarithTheme.Changed += ApplyTheme;

        // 标题与说明：继承主题前景色，仅用透明度做层级
        var title = Text("星璃·最近消息", 26, FontWeight.Bold, 1.0);

        var desc = Text(
            "年级电教委员广播与集控播报的最近消息（只读）。数据来自集控服务器，\n"
            + "刷新不会消费待执行命令，可放心反复刷新。",
            14, FontWeight.Normal, StelarithTheme.SubtleOpacity, wrap: true);

        _statusText = Text("尚未拉取。", 13, FontWeight.Normal, StelarithTheme.SubtleOpacity, wrap: true);
        _profileText = Text("档案：读取中…", 13, FontWeight.Normal, StelarithTheme.FaintOpacity, wrap: true);

        var refreshBtn = Button("刷新最近消息", () => Refresh(alsoPushNotification: false));
        var pushBtn = Button("在岛内弹出最近一条", () => Refresh(alsoPushNotification: true));
        var panelBtn = Button("打开集控面板", StelarithPanelService.OpenPanel);

        // ---- 切班：把本机显示切换到指定班级的课表群 ----
        // 集控通道下发不了 SelectedClassPlanGroupId（只合资源字典），所以「这台机器显示哪一班」
        // 只能本地改档案。日常由集控 `set_active_class` 指令远程切；此处保留手动入口便于排障。
        _groupBox = new TextBox
        {
            Watermark = "课表群名称或 GUID（如：3班课表群）",
            FontSize = 14,
            MinWidth = 280,
        };
        var switchBtn = Button("切换到此课表群", () =>
        {
            var key = (_groupBox.Text ?? "").Trim();
            if (key.Length == 0)
            {
                _statusText.Text = "请先填写课表群名称或 GUID。";
                return;
            }
            var isGuid = Guid.TryParse(key, out _);
            _ = Task.Run(() =>
            {
                StelarithReflection.EnsureResolved();
                // GUID 形态优先当 GUID 传，否则按名称匹配
                var r = StelarithProfileWriter.SetActiveClassGroup(
                    isGuid ? key : null, isGuid ? null : key);
                Dispatcher.UIThread.Post(() => _statusText.Text = "切班：" + r);
            });
        });

        var btnRow = new WrapPanel { Orientation = Orientation.Horizontal };
        foreach (var b in new[] { refreshBtn, pushBtn, panelBtn })
        {
            b.Margin = new Avalonia.Thickness(0, 0, 8, 8);
            btnRow.Children.Add(b);
        }

        _listPanel = new StackPanel { Spacing = 6 };
        _listPanel.Children.Add(Text("（点击「刷新最近消息」载入）", 13, FontWeight.Normal, StelarithTheme.FaintOpacity));

        _listCard = new Border
        {
            Background = StelarithTheme.CardBackground,
            BorderBrush = StelarithTheme.CardBorder,
            BorderThickness = new Avalonia.Thickness(1),
            CornerRadius = new Avalonia.CornerRadius(6),
            Padding = new Avalonia.Thickness(10),
            Child = new ScrollViewer
            {
                MaxHeight = 380,
                Content = _listPanel,
                HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled,
            },
        };

        var switchRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 10,
            Children = { _groupBox, switchBtn },
        };

        Content = new StackPanel
        {
            Spacing = 14,
            Margin = new Avalonia.Thickness(8),
            Children =
            {
                title,
                desc,
                btnRow,
                _statusText,
                _profileText,
                Text("切换班级课表", 16, FontWeight.SemiBold, 1.0),
                Text("本机档案里存在多个班级的课表群时，用这里指定当前生效的班"
                     + "（远程集控也会下发同一指令）。",
                    12, FontWeight.Normal, StelarithTheme.FaintOpacity, wrap: true),
                switchRow,
                Text("最近消息", 16, FontWeight.SemiBold, 1.0),
                _listCard,
            },
        };

        // 打开页面即自动拉一次（不阻塞 UI 线程）
        _ = Task.Run(() => Refresh(alsoPushNotification: false));
    }

    /// <summary>主题切换后重刷随主题变化的画刷。</summary>
    private void ApplyTheme()
    {
        try
        {
            _listCard.Background = StelarithTheme.CardBackground;
            _listCard.BorderBrush = StelarithTheme.CardBorder;
        }
        catch { /* 主题刷新失败不影响功能 */ }
    }

    /// <summary>文本工厂：不设 Foreground，靠继承拿主题色；层级用 Opacity 表达。</summary>
    private static TextBlock Text(string text, double size, FontWeight weight,
        double opacity, bool wrap = false) => new()
    {
        Text = text,
        FontSize = size,
        FontWeight = weight,
        Opacity = opacity,
        TextWrapping = wrap ? TextWrapping.Wrap : TextWrapping.NoWrap,
    };

    private static Button Button(string text, Action onClick)
    {
        var b = new Button
        {
            Content = text,
            FontSize = 15,
            Padding = new Avalonia.Thickness(14, 7),
        };
        b.Click += (_, _) =>
        {
            try { onClick(); }
            catch { /* 动作异常不影响设置窗口 */ }
        };
        return b;
    }

    /// <summary>拉取消息并刷新界面（可在后台线程调用，内部切回 UI 线程更新控件）。</summary>
    private void Refresh(bool alsoPushNotification)
    {
        StelarithSyncOptions opt;
        try
        {
            opt = StelarithSyncOptions.Load();
        }
        catch (Exception ex)
        {
            UpdateUi(new StelarithMessageFeed.FeedResult
            {
                Ok = false,
                Error = "配置读取失败：" + ex.Message,
            }, alsoPushNotification);
            return;
        }

        var result = StelarithMessageFeed.Fetch(opt);
        UpdateUi(result, alsoPushNotification);
    }

    private void UpdateUi(StelarithMessageFeed.FeedResult result, bool alsoPushNotification)
    {
        Dispatcher.UIThread.Post(() =>
        {
            _statusText.Text = result.Ok
                ? $"已拉取 {result.Messages.Count} 条 · 本机班级：{(string.IsNullOrEmpty(result.ClassName) ? "未绑定" : result.ClassName)}"
                  + $" · {DateTime.Now:HH:mm:ss}"
                : $"拉取失败：{result.Error}（请确认集控服务与本机网络）";

            // 档案状态（由切换班级/课表写回后更新）
            StelarithReflection.EnsureResolved();
            _profileText.Text = "档案：" + StelarithProfileWriter.DescribeCurrentProfile()
                                + " ｜ 最近写回：" + StelarithProfileWriter.LastResult;

            _listPanel.Children.Clear();
            if (!result.Ok || result.Messages.Count == 0)
            {
                _listPanel.Children.Add(Text(
                    result.Ok ? "暂无消息。" : "（拉取失败，见上方状态）",
                    13, FontWeight.Normal, StelarithTheme.FaintOpacity));
                return;
            }

            foreach (var m in result.Messages)
            {
                var card = new Border
                {
                    Background = StelarithTheme.CardBackground,
                    BorderBrush = StelarithTheme.CardBorder,
                    BorderThickness = new Avalonia.Thickness(1),
                    CornerRadius = new Avalonia.CornerRadius(6),
                    Padding = new Avalonia.Thickness(10, 8),
                    Child = new StackPanel
                    {
                        Spacing = 3,
                        Children =
                        {
                            Text($"{m.TimeText}  ·  {m.Title}", 12, FontWeight.Normal,
                                 StelarithTheme.FaintOpacity, wrap: true),
                            Text(m.Content, 14, FontWeight.Normal, 1.0, wrap: true),
                        },
                    },
                };
                _listPanel.Children.Add(card);
            }

            if (alsoPushNotification && result.Messages.Count > 0)
            {
                var latest = result.Messages[0];
                StelarithNotificationProvider.Current?.Push(
                    string.IsNullOrWhiteSpace(latest.Title) ? StelarithBranding.SourceName : latest.Title,
                    latest.Content,
                    8);
            }
        });
    }
}
