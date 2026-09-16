using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using ClassIsland.Core.Abstractions.Controls;
using ClassIsland.Core.Attributes;
using ClassIsland.Core.Enums;
using ClassIsland.Core.Enums.SettingsWindow;

namespace StelarithControlPlugin;

/// <summary>
/// 星璃·集控「专页」（ClassIsland 设置窗口侧边栏，Category=External）。
///
/// 这一页就是**内嵌的集控面板**：教室一体机上不必打开浏览器，在设置窗口里就能看到
/// 本机的真实运行状态，并直接触发常用操作。
///
/// 页面结构：
///   ① 运行状态   —— 在线/离线（心跳往返）、班级归属、当前生效课表群、
///                    下发同步结果、档案写回结果、各通道启用情况
///   ② 快捷入口   —— 立即同步 / 立即上报 / 锁屏 / 截屏 / 请求远程控制 /
///                    弹出最近消息 / 打开网页面板
///   ③ 功能模块   —— 星璃插件自身的模块开关（**真正生效**，见 StelarithModules）
///   ④ ClassIsland 插件清单 —— 宿主真实插件枚举（只读），星集控插件标记为"核心·不可关闭"
///   ⑤ 切换班级课表 —— 手动指定本机显示哪一班的课表（远程切班失败时的兜底入口）
///
/// 配色规则（重要，见 <see cref="StelarithTheme"/> 的说明）：
///   · 正文**一律不设 Foreground**，靠 Avalonia 的 TextElement 继承拿主题正确的颜色 ——
///     旧实现写死 `Brushes.White` 在浅色主题下整页不可读；
///   · 层级靠 `Opacity`，不用半透明白；
///   · 只有卡片底色/边框/状态语义色才由 StelarithTheme 按当前主题提供，并订阅主题切换刷新。
/// </summary>
[SettingsPageInfo(
    "stelarith_panel",
    "星璃·集控",
    false,
    SettingsPageCategory.External)]
public class StelarithPanelSettingsPage : SettingsPageBase
{
    // ---- 主题相关控件的登记表：主题切换时统一重刷 ----
    private readonly List<Border> _cards = new();
    private readonly List<(Border Dot, Func<bool> State)> _dots = new();

    // ---- 需要动态更新的文本 ----
    private TextBlock _onlineText = null!;
    private TextBlock _identityText = null!;
    private TextBlock _classText = null!;
    private TextBlock _syncText = null!;
    private TextBlock _writebackText = null!;
    private TextBlock _channelText = null!;
    private TextBlock _toastText = null!;
    private StackPanel _modulePanel = null!;
    private StackPanel _pluginPanel = null!;
    private TextBox _groupBox = null!;

    private DispatcherTimer? _timer;

    public StelarithPanelSettingsPage()
    {
        StelarithTheme.EnsureHooked();
        StelarithTheme.Changed += ApplyTheme;

        Content = BuildContent();

        // 进入视图即开始自动刷新（离开即停，避免设置窗口关掉后还在跑）
        AttachedToVisualTree += (_, _) =>
        {
            StelarithTheme.EnsureHooked();
            ApplyTheme();
            RefreshStatus();
            _timer ??= new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
            _timer.Tick -= OnTick;
            _timer.Tick += OnTick;
            _timer.Start();
        };
        DetachedFromVisualTree += (_, _) => _timer?.Stop();
    }

    private void OnTick(object? sender, EventArgs e) => RefreshStatus();

    // ---------------------------------------------------------------- 布局

    private Control BuildContent()
    {
        // 先建面板再逐项 Add：因为其中有几个子项需要**同时赋值给字段**（供后续刷新），
        // 而 C# 的集合初始化器里不允许出现赋值语句。
        _toastText = Body("", StelarithTheme.FaintOpacity, 12, wrap: true);
        _modulePanel = new StackPanel { Spacing = 6 };
        _pluginPanel = new StackPanel { Spacing = 6 };

        var root = new StackPanel
        {
            Spacing = 16,
            Margin = new Avalonia.Thickness(8),
        };

        root.Children.Add(Body("星璃·集控", 1.0, 26, FontWeight.Bold));
        root.Children.Add(Body(
            "教室一体机的集控客户端：接收下发配置与指令，并把本机真实状态上报给管理端。\n"
            + "此页即内嵌面板，可查看状态并直接执行常用操作。",
            StelarithTheme.SubtleOpacity, 14, wrap: true));

        root.Children.Add(SectionHeader("设备运行状态"));
        root.Children.Add(BuildStatusCard());

        root.Children.Add(SectionHeader("快捷操作"));
        root.Children.Add(BuildActionRows());
        root.Children.Add(_toastText);

        root.Children.Add(SectionHeader("功能模块开关"));
        root.Children.Add(Body(
            "这里是星璃插件自身功能模块的开关，改动**立即生效**（无需重启 ClassIsland）。"
            + "带「核心」标记的模块不允许关闭 —— 关掉之后这台设备将无法被集控发现或控制。",
            StelarithTheme.SubtleOpacity, 12, wrap: true));
        root.Children.Add(_modulePanel);

        root.Children.Add(SectionHeader("ClassIsland 插件"));
        root.Children.Add(Body(
            "宿主实际加载的插件清单（只读）。ClassIsland 没有运行时启停第三方插件的公开接口，"
            + "插件的启用/禁用只能在宿主自己的插件页改动并重启生效。",
            StelarithTheme.SubtleOpacity, 12, wrap: true));
        root.Children.Add(_pluginPanel);

        root.Children.Add(SectionHeader("切换班级课表"));
        root.Children.Add(Body(
            "本机档案里存在多个班级的课表群时，用这里指定当前生效的班。"
            + "远程集控也会下发同一指令（切班后上方「班级归属」会立即反映结果）。",
            StelarithTheme.SubtleOpacity, 12, wrap: true));
        root.Children.Add(BuildSwitchRow());

        return new ScrollViewer
        {
            Content = root,
            HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled,
        };
    }

    /// <summary>状态卡片：6 行「圆点 + 标签 + 值」，值随刷新更新。</summary>
    private Control BuildStatusCard()
    {
        var inner = new StackPanel { Spacing = 7 };

        _onlineText = Body("读取中…", 1.0, 14);
        inner.Children.Add(StatusRow(() => StelarithStatusReporter.Last.Ok, _onlineText));

        _identityText = Body("读取中…", StelarithTheme.SubtleOpacity, 13, wrap: true);
        inner.Children.Add(LabelRow("设备", _identityText));

        _classText = Body("读取中…", StelarithTheme.SubtleOpacity, 13, wrap: true);
        inner.Children.Add(LabelRow("班级归属", _classText));

        _syncText = Body("读取中…", StelarithTheme.SubtleOpacity, 13, wrap: true);
        inner.Children.Add(LabelRow("下发同步", _syncText));

        _writebackText = Body("读取中…", StelarithTheme.SubtleOpacity, 13, wrap: true);
        inner.Children.Add(LabelRow("档案写回", _writebackText));

        _channelText = Body("读取中…", StelarithTheme.SubtleOpacity, 13, wrap: true);
        inner.Children.Add(LabelRow("通道", _channelText));

        return Card(inner);
    }

    private Control BuildActionRows()
    {
        var rows = new StackPanel { Spacing = 8 };

        rows.Children.Add(ButtonRow(
            Btn("立即同步下发配置", () =>
            {
                StelarithSyncState.RequestRefresh();
                Toast("已请求立即同步；结果会在下方「下发同步」行更新。");
            }),
            Btn("立即上报状态", () =>
            {
                // 触发一次上报的最快方式：让心跳线程立刻跑一轮
                StelarithStatusBridge.RequestImmediateReport();
                Toast("已请求立即上报；结果会在上方「在线」行更新。");
            }),
            Btn("打开网页面板", () => StelarithPanelService.OpenPanel())));

        rows.Children.Add(ButtonRow(
            Btn("锁屏", () => Run("lock")),
            Btn("截屏", () => Run("screenshot")),
            Btn("请求远程控制", () => Run("remote_control_start"))));

        rows.Children.Add(ButtonRow(
            // 这一项是网络调用（拉消息端点），必须离开 UI 线程，否则设置窗口会卡住
            Btn("在岛内弹出最近一条", () => _ = Task.Run(
                () => StelarithPanelService.ShowLatestMessageForUi(
                    msg => Dispatcher.UIThread.Post(() => Toast(msg))))),
            Btn("刷新本页", RefreshStatus)));

        return rows;
    }

    private Control BuildSwitchRow()
    {
        _groupBox = new TextBox
        {
            Watermark = "课表群名称或 GUID（如：3班课表群）",
            FontSize = 14,
            MinWidth = 280,
        };
        var btn = Btn("切换到此课表群", () =>
        {
            var key = (_groupBox.Text ?? "").Trim();
            if (key.Length == 0)
            {
                Toast("请先填写课表群名称或 GUID。");
                return;
            }
            var isGuid = Guid.TryParse(key, out _);
            var groupName = key;
            _ = Task.Run(() =>
            {
                StelarithReflection.EnsureResolved();
                var result = StelarithProfileWriter.SetActiveClassGroup(
                    isGuid ? groupName : null, isGuid ? null : groupName);
                Dispatcher.UIThread.Post(() =>
                {
                    Toast("切班：" + result);
                    RefreshStatus();
                });
            });
        });
        return ButtonRow(_groupBox, btn);
    }

    // ---------------------------------------------------------------- 刷新

    /// <summary>刷新状态与两个清单（读静态快照，成本很低，可在 UI 线程直接跑）。</summary>
    private void RefreshStatus()
    {
        try
        {
            var st = StelarithStatusReporter.Last;
            var opt = StelarithSyncOptions.Load();

            // ① 在线状态
            var ago = DateTimeOffset.Now - st.At;
            _onlineText.Text = st.Ok
                ? $"在线 · 最近上报 {st.At:HH:mm:ss}（{Humanize(ago)}前）"
                : $"未上报 · {st.At:HH:mm:ss} 失败：{st.Error ?? "—"}"
                  + (st.FailStreak > 1 ? $"（已连续失败 {st.FailStreak} 次，正在退避重试）" : "");

            // ② 设备身份
            _identityText.Text = $"{Environment.MachineName} · uid={opt.ClientUid} · 租户={opt.Slug}"
                                 + $" · 插件 v{StelarithStatusReporter.PluginVersion()}";
            _identityText.Text += $"\n服务端：{opt.ClientAppBase}（Host: {opt.Slug}.{opt.BaseDomain}）";

            // ③ 班级归属与当前生效课表群（本地档案实际值 —— 切班是否成功看这里）
            var group = StelarithProfileWriter.CurrentActiveClassGroupName();
            var classId = string.IsNullOrEmpty(st.ClassId) ? "未绑定" : st.ClassId;
            _classText.Text = $"管理端指派：{classId} · 本机生效课表群：{(string.IsNullOrEmpty(group) ? "未设置" : group)}";

            // ④ 下发同步
            var snap = StelarithSyncState.Current;
            var resCount = snap.Resources.Count(kv => kv.Value is not null);
            _syncText.Text = snap.At == default
                ? "尚未同步过"
                : $"{(snap.Ok ? "成功" : "失败")} · {snap.At.ToLocalTime():MM-dd HH:mm:ss}"
                  + $" · 资源 {resCount} 项"
                  + (string.IsNullOrEmpty(snap.Error) ? "" : $" · {snap.Error}");
            _syncText.Text += $"\n本机档案：{StelarithProfileWriter.DescribeCurrentProfile()}";

            // ⑤ 档案写回
            _writebackText.Text = StelarithProfileWriter.LastResult;

            // ⑥ 通道
            _channelText.Text =
                $"指令通道：{OnOff(StelarithModules.CommandPoll)}"
                + $" · 状态上报：{OnOff(StelarithModules.Heartbeat)}"
                + $" · 播报：{OnOff(StelarithModules.Notification)}"
                + $" · 本机动作：{OnOff(StelarithModules.OsActions)}"
                + $" · 远程控制：{OnOff(StelarithModules.RemoteControl)}";

            RefreshModules();
            RefreshPlugins();
            ApplyTheme();
        }
        catch (Exception ex)
        {
            Toast("刷新状态失败：" + ex.Message);
        }
    }

    private static string OnOff(string moduleId) => StelarithModules.IsEnabled(moduleId) ? "已启用" : "已停用";

    private static string Humanize(TimeSpan span)
    {
        if (span.TotalSeconds < 0) return "0秒";
        if (span.TotalSeconds < 60) return $"{span.TotalSeconds:0}秒";
        if (span.TotalMinutes < 60) return $"{span.TotalMinutes:0}分钟";
        return $"{span.TotalHours:0.0}小时";
    }

    /// <summary>重建模块开关列表。核心模块的勾选框禁用并给出原因。</summary>
    private void RefreshModules()
    {
        _modulePanel.Children.Clear();
        var snap = StelarithModules.Snapshot();

        foreach (var def in StelarithModules.All)
        {
            var enabled = snap.TryGetValue(def.Id, out var on) ? on : def.DefaultEnabled;

            var box = new CheckBox
            {
                IsChecked = enabled,
                IsEnabled = !def.IsCore,
                VerticalAlignment = VerticalAlignment.Top,
                Content = new StackPanel
                {
                    Spacing = 2,
                    Children =
                    {
                        Body(def.Label + (def.IsCore ? "（核心 · 不可关闭）" : ""), 1.0, 14,
                             def.IsCore ? FontWeight.SemiBold : FontWeight.Normal),
                        Body(def.Description, StelarithTheme.FaintOpacity, 12, wrap: true),
                    },
                },
            };

            var id = def.Id;
            box.IsCheckedChanged += (_, _) =>
            {
                if (box.IsChecked is not { } want) return;
                var (ok, msg) = StelarithModules.Set(id, want);
                Toast(msg);
                if (!ok) box.IsChecked = !want; // 被拒（核心模块）则回滚勾选状态
                RefreshStatus();
            };

            _modulePanel.Children.Add(Card(box, tight: true));
        }
    }

    /// <summary>重建 ClassIsland 插件清单。数据来自心跳上报时采集的快照。</summary>
    private void RefreshPlugins()
    {
        _pluginPanel.Children.Clear();

        List<PluginRow> rows;
        try
        {
            rows = PluginInventory.Snapshot();
        }
        catch (Exception ex)
        {
            _pluginPanel.Children.Add(Body("插件清单读取失败：" + ex.Message, StelarithTheme.SubtleOpacity, 12, wrap: true));
            return;
        }

        if (rows.Count == 0)
        {
            _pluginPanel.Children.Add(Body("暂未取到插件清单（宿主插件服务尚未就绪，或正在首次上报）。",
                StelarithTheme.SubtleOpacity, 12, wrap: true));
            return;
        }

        foreach (var p in rows.OrderByDescending(r => r.IsStelarith).ThenBy(r => r.Name))
        {
            var line = new StackPanel { Spacing = 2 };
            line.Children.Add(Body(
                $"{p.Name}  v{p.Version}" + (p.IsStelarith ? "  ·  核心 · 不可关闭" : ""),
                1.0, 13, p.IsStelarith ? FontWeight.SemiBold : FontWeight.Normal, wrap: true));
            line.Children.Add(Body(
                $"{(p.Enabled ? "已启用" : "已禁用")} · 状态 {p.Status} · {p.Id}",
                StelarithTheme.FaintOpacity, 11, wrap: true));

            var row = new Border
            {
                BorderThickness = new Avalonia.Thickness(3, 0, 0, 0),
                Padding = new Avalonia.Thickness(9, 6),
                // 左侧色条即"启用状态"的直观指示（语义色随主题自适应）
                BorderBrush = StelarithTheme.ForState(p.Enabled),
                Child = line,
            };
            _pluginPanel.Children.Add(row);
        }
    }

    // ---------------------------------------------------------------- 动作

    private void Run(string action)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                await StelarithDispatch.RunAsync(new StelarithTask { Action = action });
                Dispatcher.UIThread.Post(() => Toast($"已执行：{action}"));
            }
            catch (Exception ex)
            {
                Dispatcher.UIThread.Post(() => Toast($"{action} 失败：{ex.Message}"));
            }
        });
    }

    private void Toast(string message)
    {
        try { _toastText.Text = $"[{DateTime.Now:HH:mm:ss}] {message}"; }
        catch { /* UI 未就绪 */ }
    }

    /// <summary>主题切换后重刷所有随主题变化的画刷。</summary>
    private void ApplyTheme()
    {
        try
        {
            foreach (var card in _cards)
            {
                card.Background = StelarithTheme.CardBackground;
                card.BorderBrush = StelarithTheme.CardBorder;
            }
            foreach (var (dot, state) in _dots)
            {
                dot.Background = StelarithTheme.ForState(SafeState(state));
            }
        }
        catch { /* 主题刷新失败不影响功能 */ }
    }

    private static bool SafeState(Func<bool> state)
    {
        try { return state(); }
        catch { return false; }
    }

    // ---------------------------------------------------------------- 控件工厂

    private static TextBlock Body(string text, double opacity, double size,
        FontWeight? weight = null, bool wrap = false)
    {
        // 刻意不设 Foreground：继承宿主设置窗口的主题前景色（见 StelarithTheme 注释）
        return new TextBlock
        {
            Text = text,
            FontSize = size,
            FontWeight = weight ?? FontWeight.Normal,
            Opacity = opacity,
            TextWrapping = wrap ? TextWrapping.Wrap : TextWrapping.NoWrap,
        };
    }

    private static TextBlock SectionHeader(string text)
        => Body(text, 1.0, 18, FontWeight.SemiBold);

    private static Button Btn(string text, Action onClick)
    {
        var b = new Button
        {
            Content = text,
            FontSize = 13,
            Padding = new Avalonia.Thickness(12, 6),
        };
        b.Click += (_, _) =>
        {
            try { onClick(); }
            catch { /* 动作失败不应导致设置窗口异常 */ }
        };
        return b;
    }

    private static Control ButtonRow(params Control[] children)
    {
        var panel = new WrapPanel { Orientation = Orientation.Horizontal };
        foreach (var ctrl in children)
        {
            ctrl.Margin = new Avalonia.Thickness(0, 0, 8, 8);
            panel.Children.Add(ctrl);
        }
        return panel;
    }

    private Border Card(Control child, bool tight = false)
    {
        var border = new Border
        {
            Background = StelarithTheme.CardBackground,
            BorderBrush = StelarithTheme.CardBorder,
            BorderThickness = new Avalonia.Thickness(1),
            CornerRadius = new Avalonia.CornerRadius(6),
            Padding = new Avalonia.Thickness(tight ? 8 : 12, tight ? 6 : 10),
            Child = child,
        };
        _cards.Add(border);
        return border;
    }

    /// <summary>「圆点 + 文本」行（圆点颜色随状态变化）。</summary>
    private Control StatusRow(Func<bool> state, TextBlock text)
    {
        var dot = new Border
        {
            Width = 9,
            Height = 9,
            CornerRadius = new Avalonia.CornerRadius(5),
            Background = StelarithTheme.ForState(SafeState(state)),
            VerticalAlignment = VerticalAlignment.Center,
        };
        _dots.Add((dot, state));

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        row.Children.Add(dot);
        row.Children.Add(text);
        return row;
    }

    private static Control LabelRow(string label, TextBlock value)
    {
        var panel = new StackPanel { Spacing = 2 };
        panel.Children.Add(Body(label, StelarithTheme.FaintOpacity, 11));
        panel.Children.Add(value);
        return panel;
    }
}

/// <summary>
/// 让 UI 能主动催一次状态上报（不带方法引用的耦合）。
/// 心跳守护线程每个周期都会读这个标志，为真则立即上报一次。
/// </summary>
public static class StelarithStatusBridge
{
    private static volatile bool _requested;

    public static bool ConsumeRequest()
    {
        if (!_requested) return false;
        _requested = false;
        return true;
    }

    public static void RequestImmediateReport() => _requested = true;
}
