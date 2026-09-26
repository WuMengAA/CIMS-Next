using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;

namespace StelarithControlPlugin;

/// <summary>
/// 星璃·集控「全屏紧急通知」—— 教室大屏上的最高优先级呈现。
///
/// 与官方大字播报的区别（为什么必须自建窗口）：
///   官方 <c>NotificationContent</c> 是「遮罩 + 滚动文本」，纯展示、**没有按钮**，
///   且受宿主提醒设置与去重/限频约束。紧急通知的语义是「必须被看见、必须有人确认」，
///   因此这里复用 <see cref="StelarithInteractiveNotice"/> 的 Avalonia 置顶窗口模式，
///   自建一块**全屏遮罩**：覆盖整块屏幕 + 置顶 + 红边警示 + 大字正文，
///   老师必须手动点「我知道了」才会关闭 —— 二次确认（再弹一次确认框）防误触。
///
/// 回执语义（与 CIMS 契约对齐，同互动通知）：
///   确认后 POST /api/v1/client/{uid}/notice-reply  {"text":"已确认(全屏紧急)","notice_id":"..."}
///   管理端 / 操控端回复收件箱可见「这台教室已确认收到紧急通知」。
///
/// 降级链（用户 2026-09-25 选定「两端都升级，带降级」）：
///   · 本窗口依赖宿主 Avalonia 环境 —— 若 Dispatcher 不可用（宿主异常/退出中），
///     降级到 <see cref="StelarithNotificationProvider"/> 的大字播报（至少可见）；
///   · 若连播报提供方都未就绪（插件被宿主跳过），则尝试本地代理通知桌面端星集控
///     （桌面端有自己的全屏呈现，见其 notice_popup.dart）—— 由本地代理决定是否可达，
///     插件只做一次尽力转发，失败静默。
///
/// 防抖：同一 notice_id 只弹一次；展示期间再来新紧急通知，丢弃并记诊断（防霸屏）。
/// </summary>
public static class StelarithFullscreenNotice
{
    /// <summary>回执上报 HttpClient（与互动通知同款短连接策略）。</summary>
    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        PooledConnectionLifetime = TimeSpan.FromSeconds(2),
        PooledConnectionIdleTimeout = TimeSpan.FromSeconds(1),
        AutomaticDecompression = System.Net.DecompressionMethods.All,
    });

    private static readonly object Gate = new();
    private static Window? _active;
    private static string? _activeNoticeId;
    private static readonly HashSet<string> Shown = new();

    /// <summary>
    /// 展示全屏紧急通知（dispatch 线程调用；内部 marshal 到 UI 线程）。
    /// 同一时刻只有一个全屏遮罩；后到的直接丢弃。
    /// </summary>
    public static void Show(StelarithTask task, string? fallbackTitle, string? fallbackBody)
    {
        var noticeId = (task.NoticeId ?? "").Trim();
        var title = string.IsNullOrWhiteSpace(task.Title) ? fallbackTitle : task.Title;
        var body = string.IsNullOrWhiteSpace(task.Body) ? fallbackBody : task.Body;

        lock (Gate)
        {
            if (_active is not null)
            {
                Diag($"fullscreen drop: 已有全屏遮罩（{_activeNoticeId}），丢弃 {noticeId}");
                return;
            }
            if (noticeId.Length > 0 && !Shown.Add(noticeId))
            {
                Diag($"fullscreen drop: 通知 {noticeId} 已弹过");
                return;
            }
        }

        var capturedId = noticeId;
        var capturedTitle = string.IsNullOrWhiteSpace(title) ? "紧急通知" : title!;
        var capturedBody = body ?? "";
        var autoDismiss = task.AutoDismissSeconds;

        try
        {
            Dispatcher.UIThread.InvokeAsync(() =>
                BuildAndShow(capturedId, capturedTitle, capturedBody, autoDismiss));
        }
        catch (Exception ex)
        {
            Diag("fullscreen dispatch failed: " + ex.Message);
            Degrade(capturedTitle, capturedBody);
        }
    }

    /// <summary>降级链：先大字播报，播报提供方不可用时尝试本地代理通知桌面端。</summary>
    private static void Degrade(string title, string body)
    {
        try
        {
            var combined = string.IsNullOrWhiteSpace(body) ? title : title + "：" + body;
            if (StelarithNotificationProvider.Current is { } provider)
            {
                Diag("fullscreen degrade -> notification provider");
                provider.Push(StelarithBranding.SourceName, combined, 10,
                    flags: new StelarithNotificationProvider.NotificationFlags
                    {
                        IsEmergency = true,
                        IsTopmost = true,
                        IsSoundEnabled = true,
                        IsEffectEnabled = true,
                    });
                return;
            }
        }
        catch (Exception ex)
        {
            Diag("fullscreen degrade provider failed: " + ex.Message);
        }

        // 播报提供方未就绪：尽力通知桌面端（本地代理通道），失败静默 —— 至少有一次机会
        try
        {
            _ = StelarithDispatch.NotifyDesktopAsync(
                "紧急通知：" + title,
                body,
                kind: "fullscreen");
        }
        catch { /* 降级尽力而为 */ }
    }

    private static void BuildAndShow(string noticeId, string title, string body, int autoDismissSeconds)
    {
        try
        {
            // 全屏遮罩：无边框、置顶、覆盖全屏（含任务栏区域用 Maximized + WindowState）。
            var win = new Window
            {
                Title = "紧急通知",
                // 真全屏（覆盖含任务栏的全部屏幕），而不是固定尺寸居中的小窗。
                // 之前固定 1280x720 + Maximized 会在大屏上「挤在中间一小块」，
                // 与「全屏紧急」的语义相悖。Avalonia WindowState.FullScreen
                // 在 Windows 上覆盖整块显示器（含任务栏区域）。
                WindowStartupLocation = WindowStartupLocation.Manual,
                Topmost = true,
                ShowInTaskbar = false,
                CanResize = false,
                SystemDecorations = SystemDecorations.None,
                Background = new SolidColorBrush(Color.FromRgb(0xC6, 0x1A, 0x1A)), // 深红警示底
            };
            win.Closed += (_, _) => Release(noticeId);

            var root = new StackPanel
            {
                Margin = new Thickness(48, 40),
                Spacing = 16,
                VerticalAlignment = VerticalAlignment.Center,
            };

            // 顶部警示行
            var warn = new TextBlock
            {
                Text = "⚠️ 紧 急 通 知",
                FontSize = 40,
                FontWeight = FontWeight.Bold,
                Foreground = Brushes.White,
                HorizontalAlignment = HorizontalAlignment.Center,
            };
            root.Children.Add(warn);

            // 标题
            var titleBlock = new TextBlock
            {
                Text = title,
                FontSize = 30,
                FontWeight = FontWeight.SemiBold,
                TextWrapping = TextWrapping.Wrap,
                Foreground = Brushes.White,
                HorizontalAlignment = HorizontalAlignment.Center,
            };
            root.Children.Add(titleBlock);

            // 正文
            if (!string.IsNullOrWhiteSpace(body))
            {
                var bodyBlock = new TextBlock
                {
                    Text = body,
                    FontSize = 22,
                    TextWrapping = TextWrapping.Wrap,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xFF, 0xF3, 0xF0)),
                    HorizontalAlignment = HorizontalAlignment.Center,
                };
                root.Children.Add(bodyBlock);
            }

            // 自动关闭提示（仅显式给了秒数时）
            if (autoDismissSeconds > 0)
            {
                var hint = new TextBlock
                {
                    Text = $"（$autoDismissSeconds 秒后自动关闭）",
                    FontSize = 14,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xFF, 0xD9, 0xD0)),
                    HorizontalAlignment = HorizontalAlignment.Center,
                };
                root.Children.Add(hint);
            }

            // 确认按钮：二次确认（第一次点击弹确认框，确认后回执并关闭）
            var ackBtn = new Button
            {
                Content = "我知道了",
                FontSize = 20,
                FontWeight = FontWeight.SemiBold,
                Padding = new Thickness(40, 14),
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 12, 0, 0),
            };
            ackBtn.Click += (_, _) => OnAckClicked(win, noticeId, title);
            root.Children.Add(ackBtn);

            win.Content = root;

            // 覆盖全屏：FullScreen 状态（Windows 上盖掉任务栏；Maximized 在有系统装饰时
            // 会留任务栏一条，且固定尺寸窗口在 Maximized 下仍保持自己的 Width/Height，
            // 表现为「一块居中的大窗」而非满屏 —— FullScreen 才能真铺满）。
            win.WindowState = WindowState.FullScreen;

            lock (Gate)
            {
                _active = win;
                _activeNoticeId = noticeId;
            }
            Diag($"fullscreen shown: notice={noticeId} title={title} body={body.Length}B");
            win.Show();

            // 朗读正文（可选：全屏紧急通知默认朗读，确保远距离可见性）。
            // 走通知总线的 SpeakDirect —— 内部尊重「语音朗读」模块开关，关掉即不读。
            StelarithNoticeBus.SpeakDirect(string.IsNullOrWhiteSpace(body) ? title : title + "：" + body);

            // 显式给了秒数：到时自动关闭并回执 read（不经过二次确认）
            if (autoDismissSeconds > 0)
            {
                var secs = Math.Clamp(autoDismissSeconds, 1, 300);
                Task.Delay(TimeSpan.FromSeconds(secs)).ContinueWith(_ =>
                {
                    try
                    {
                        Dispatcher.UIThread.Post(() =>
                        {
                            CloseWindow(win);
                            _ = PostReplyAsync(noticeId, "已自动关闭（超时）");
                        });
                    }
                    catch { /* 宿主退出 */ }
                });
            }
        }
        catch (Exception ex)
        {
            Diag("fullscreen build failed: " + ex.Message);
            Release(noticeId);
            Degrade(title, body);
        }
    }

    /// <summary>「我知道了」点击：先弹二次确认框，确认后回执 + 关闭。</summary>
    private static void OnAckClicked(Window win, string noticeId, string title)
    {
        try
        {
            var again = new Window
            {
                Title = "确认收到紧急通知",
                Width = 420,
                MaxHeight = 260,
                WindowStartupLocation = WindowStartupLocation.CenterScreen,
                Topmost = true,
                ShowInTaskbar = false,
                CanResize = false,
                Background = StelarithTheme.IsLight
                    ? new SolidColorBrush(Color.FromRgb(0xF7, 0xF7, 0xF9))
                    : new SolidColorBrush(Color.FromRgb(0x20, 0x20, 0x28)),
            };
            var panel = new StackPanel { Margin = new Thickness(24, 20), Spacing = 12 };

            panel.Children.Add(new TextBlock
            {
                Text = "⚠️ 这是紧急通知",
                FontSize = 20,
                FontWeight = FontWeight.Bold,
                TextWrapping = TextWrapping.Wrap,
                Foreground = new SolidColorBrush(Color.FromRgb(0xC6, 0x1A, 0x1A)),
            });
            panel.Children.Add(new TextBlock
            {
                Text = title,
                FontSize = 15,
                TextWrapping = TextWrapping.Wrap,
                Foreground = StelarithTheme.IsLight
                    ? new SolidColorBrush(Color.FromRgb(0x33, 0x33, 0x3B))
                    : new SolidColorBrush(Color.FromRgb(0xCF, 0xCF, 0xD8)),
            });
            panel.Children.Add(new TextBlock
            {
                Text = "确认后会将「已收到」回执上报给集控端。",
                FontSize = 12,
                TextWrapping = TextWrapping.Wrap,
                Foreground = StelarithTheme.IsLight
                    ? new SolidColorBrush(Color.FromRgb(0x6B, 0x6B, 0x74))
                    : new SolidColorBrush(Color.FromRgb(0x9A, 0x9A, 0xA6)),
            });

            var btnRow = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 8,
                HorizontalAlignment = HorizontalAlignment.Right,
                Margin = new Thickness(0, 8, 0, 0),
            };
            var cancelBtn = new Button { Content = "再想想", FontSize = 14, Padding = new Thickness(20, 8) };
            cancelBtn.Click += (_, _) => CloseWindow(again);
            btnRow.Children.Add(cancelBtn);

            var confirmBtn = new Button
            {
                Content = "确认收到",
                FontSize = 14,
                FontWeight = FontWeight.SemiBold,
                Padding = new Thickness(20, 8),
            };
            confirmBtn.Click += (_, _) =>
            {
                CloseWindow(again);
                CloseWindow(win);
                _ = PostReplyAsync(noticeId, "已确认（全屏紧急通知）");
                Diag($"fullscreen acked: notice={noticeId}");
            };
            btnRow.Children.Add(confirmBtn);

            panel.Children.Add(btnRow);
            again.Content = panel;
            again.Show();
        }
        catch (Exception ex)
        {
            Diag("fullscreen ack dialog failed: " + ex.Message);
            // 二次确认框失败不能卡死主遮罩：直接关闭并回执
            CloseWindow(win);
            _ = PostReplyAsync(noticeId, "已确认（全屏紧急通知，无二次确认）");
        }
    }

    /// <summary>把回执 POST 到 CIMS 设备端（与互动通知同一信任链：Host 头识别租户）。</summary>
    private static async Task<(bool Ok, string? Error)> PostReplyAsync(string noticeId, string text)
    {
        try
        {
            var opt = StelarithSyncOptions.Load();
            if (opt is null || string.IsNullOrWhiteSpace(opt.ClientUid))
                return (false, "配置未加载或 ClientUid 为空");

            var url = $"{opt.ClientAppBase}/api/v1/client/{Uri.EscapeDataString(opt.ClientUid)}/notice-reply";
            var payload = JsonSerializer.Serialize(new Dictionary<string, string?>
            {
                ["notice_id"] = noticeId,
                ["text"] = text,
            });
            using var req = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Headers = { Host = $"{opt.Slug}.{opt.BaseDomain}" },
                Content = new StringContent(payload, Encoding.UTF8, "application/json"),
            };
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            using var resp = await Http.SendAsync(req, cts.Token);
            if (resp.IsSuccessStatusCode) return (true, null);
            var body = await resp.Content.ReadAsStringAsync();
            return (false, $"HTTP {(int)resp.StatusCode} {body}");
        }
        catch (OperationCanceledException)
        {
            return (false, "发送超时（5s）");
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    private static void CloseWindow(Window? win)
    {
        try
        {
            if (win is not null && win.IsVisible) win.Close();
        }
        catch { /* 关闭异常忽略 */ }
    }

    private static void Release(string noticeId)
    {
        lock (Gate)
        {
            _active = null;
            _activeNoticeId = null;
        }
        Diag($"fullscreen closed: notice={noticeId}");
    }

    internal static void Diag(string msg)
    {
        try { StelarithLog.Write("ste-fullscreen-diag.log", msg); }
        catch { /* 忽略 */ }
    }
}
