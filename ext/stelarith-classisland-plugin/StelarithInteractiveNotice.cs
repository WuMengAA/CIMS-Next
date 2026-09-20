using System;
using System.Collections.Generic;
using System.Linq;
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
/// 星璃·集控「互动广播弹窗」—— 教室端对管理端下发的互动通知做**人机交互**：
/// 大屏上弹出带「确认 / 回复」两个按钮的弹窗，回复既可按快捷文字一键发送，
/// 也可手动输入；结果经 CIMS 设备端回执接口（notice-reply）上报，管理端收件箱可见。
///
/// 为什么不用官方 Notification 通道：官方 <c>NotificationContent</c> 是「纯展示」
/// 内容（遮罩 + 滚动文本），没有按钮、没有输入、没有交互。互动广播需要真实 UI，
/// 因此用宿主 Avalonia 渲染环境自建一个置顶小窗（<see cref="Window"/>）。
///
/// 触发方式：面板下发的 SendNotification 内嵌 stelarith_task（action=interactive_notice），
/// <see cref="StelarithDispatch.ExtractTask"/> 解析后交 <see cref="StelarithDispatch.RunAsync"/>
/// 分发到本类（见 dispatch 的 interactive_notice 分支）。
///
/// 回执语义（与 CIMS 契约对齐）：
///   · 确认  → POST /api/v1/client/{uid}/notice-reply  {"text":"已确认","notice_id":"..."}
///   · 快捷回复 → 同上，text=预设文案
///   · 手动输入 → 同上，text=用户输入（≤2000 字符，后端同限）
///   租户识别走 Host 头（<slug>.<BaseDomain>），与心跳同一信任链，无需会话凭证。
///
/// 防抖：同一 notice_id 只弹一次；弹窗展示期间再来新互动通知，丢弃并记诊断（防霸屏）。
/// </summary>
public static class StelarithInteractiveNotice
{
    /// <summary>回执上报 HttpClient（与状态上报同款短连接策略，避免占用连接池）。</summary>
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
    /// 展示互动弹窗（dispatch 线程调用；内部 marshal 到 UI 线程）。
    /// 弹窗本身是「模态」语义 —— 同一时刻只有一个，后到的直接丢弃。
    /// </summary>
    public static void Show(StelarithTask task, string? fallbackTitle, string? fallbackBody)
    {
        var noticeId = (task.NoticeId ?? "").Trim();
        var title = string.IsNullOrWhiteSpace(task.Title) ? fallbackTitle : task.Title;
        var body = string.IsNullOrWhiteSpace(task.Body) ? fallbackBody : task.Body;

        // 防抖：同 id 只弹一次（进程内）；无 id 则按"当前是否已有一个弹窗"防重
        lock (Gate)
        {
            if (_active is not null)
            {
                Diag($"interactive drop: 已有弹窗（{(string.IsNullOrEmpty(_activeNoticeId) ? "无 id" : _activeNoticeId)}），丢弃新通知 {noticeId}");
                return;
            }
            if (noticeId.Length > 0 && !Shown.Add(noticeId))
            {
                Diag($"interactive drop: 通知 {noticeId} 已弹过");
                return;
            }
        }

        var capturedId = noticeId;
        var capturedTitle = string.IsNullOrWhiteSpace(title) ? StelarithBranding.SourceName : title!;
        var capturedBody = body ?? "";
        var presets = task.Presets ?? new List<string>();
        var requireAck = task.RequireAck;

        try
        {
            Dispatcher.UIThread.InvokeAsync(() =>
                BuildAndShow(capturedId, capturedTitle, capturedBody, presets, requireAck));
        }
        catch (Exception ex)
        {
            Diag("interactive dispatch failed: " + ex.Message);
        }
    }

    private static void BuildAndShow(string noticeId, string title, string body,
        List<string> presets, bool requireAck)
    {
        try
        {
            var win = new Window
            {
                Title = "星璃 · 互动通知",
                Width = 560,
                MaxHeight = 460,
                WindowStartupLocation = WindowStartupLocation.CenterScreen,
                Topmost = true,
                ShowInTaskbar = false,
                CanResize = false,
                Background = StelarithTheme.IsLight
                    ? new SolidColorBrush(Color.FromRgb(0xF7, 0xF7, 0xF9))
                    : new SolidColorBrush(Color.FromRgb(0x20, 0x20, 0x28)),
            };

            var root = new StackPanel { Margin = new Thickness(24, 20), Spacing = 12 };

            // 标题
            var titleBlock = new TextBlock
            {
                Text = title,
                FontSize = 22,
                FontWeight = FontWeight.Bold,
                TextWrapping = TextWrapping.Wrap,
                Foreground = StelarithTheme.IsLight
                    ? Brushes.Black
                    : new SolidColorBrush(Color.FromRgb(0xEF, 0xEF, 0xF4)),
            };
            root.Children.Add(titleBlock);

            // 正文
            if (!string.IsNullOrWhiteSpace(body))
            {
                var bodyBlock = new TextBlock
                {
                    Text = body,
                    FontSize = 15,
                    TextWrapping = TextWrapping.Wrap,
                    MaxHeight = 220,
                    Foreground = StelarithTheme.IsLight
                        ? new SolidColorBrush(Color.FromRgb(0x33, 0x33, 0x3B))
                        : new SolidColorBrush(Color.FromRgb(0xCF, 0xCF, 0xD8)),
                };
                root.Children.Add(bodyBlock);
            }

            // 状态行（发送结果反馈）
            var status = new TextBlock
            {
                FontSize = 12,
                TextWrapping = TextWrapping.Wrap,
                Foreground = StelarithTheme.IsLight
                    ? new SolidColorBrush(Color.FromRgb(0x6B, 0x6B, 0x74))
                    : new SolidColorBrush(Color.FromRgb(0x9A, 0x9A, 0xA6)),
            };
            root.Children.Add(status);

            // 快捷回复区（预设一键发送）
            var presetPanel = new WrapPanel
            {
                Orientation = Orientation.Horizontal,
                IsVisible = false,
            };
            if (presets.Count > 0)
            {
                presetPanel.IsVisible = true;
                foreach (var preset in presets.Where(p => !string.IsNullOrWhiteSpace(p)).Take(8))
                {
                    var p = preset.Trim();
                    var btn = new Button
                    {
                        Content = p,
                        FontSize = 13,
                        Padding = new Thickness(14, 6),
                        Margin = new Thickness(0, 0, 8, 8),
                    };
                    btn.Click += (_, _) => SendReply(win, status, noticeId, p);
                    presetPanel.Children.Add(btn);
                }
            }
            root.Children.Add(presetPanel);

            // 手动输入行
            var inputRow = new StackPanel
            {
                Orientation = Orientation.Vertical,
                Spacing = 8,
                IsVisible = false,
            };
            var input = new TextBox
            {
                Watermark = "输入回复内容…",
                FontSize = 14,
                MaxLength = 2000,
            };
            var sendBtn = new Button
            {
                Content = "发送回复",
                FontSize = 13,
                Padding = new Thickness(14, 6),
                HorizontalAlignment = HorizontalAlignment.Right,
            };
            // 手动输入 + Enter 共用同一发送逻辑（避免 RaiseEvent 与 Click 订阅错配）
            void DoSend()
            {
                var text = (input.Text ?? "").Trim();
                if (text.Length == 0)
                {
                    status.Text = "回复内容不能为空。";
                    return;
                }
                SendReply(win, status, noticeId, text);
            }
            sendBtn.Click += (_, _) => DoSend();
            input.KeyDown += (_, e) =>
            {
                // Enter 发送（带 Shift 则换行），避免中文输入法组词时误发
                if (e.Key == Avalonia.Input.Key.Enter && (e.KeyModifiers & Avalonia.Input.KeyModifiers.Shift) == 0)
                {
                    e.Handled = true;
                    DoSend();
                }
            };
            inputRow.Children.Add(input);
            inputRow.Children.Add(sendBtn);
            root.Children.Add(inputRow);

            // 底部按钮：确认 / 回复
            var btnRow = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 8,
                HorizontalAlignment = HorizontalAlignment.Right,
                Margin = new Thickness(0, 4, 0, 0),
            };

            var confirmBtn = new Button
            {
                Content = "确 认",
                FontSize = 14,
                FontWeight = FontWeight.SemiBold,
                Padding = new Thickness(20, 8),
            };
            confirmBtn.Click += (_, _) =>
            {
                // 需确认型：确认即回执「已确认」；普通型：确认=关闭
                if (requireAck)
                    SendReply(win, status, noticeId, "已确认", closeAfter: true);
                else
                    CloseWindow(win);
            };
            btnRow.Children.Add(confirmBtn);

            var replyBtn = new Button
            {
                Content = "回 复",
                FontSize = 14,
                FontWeight = FontWeight.SemiBold,
                Padding = new Thickness(20, 8),
            };
            replyBtn.Click += (_, _) =>
            {
                // 展开快捷回复 + 手动输入（第一次点击展开，之后聚焦输入框）
                var want = !inputRow.IsVisible;
                inputRow.IsVisible = want;
                presetPanel.IsVisible = want && presets.Count > 0;
                if (want) input.Focus();
            };
            btnRow.Children.Add(replyBtn);
            root.Children.Add(btnRow);

            win.Content = root;
            win.Closed += (_, _) => Release(noticeId);
            win.Show();

            lock (Gate)
            {
                _active = win;
                _activeNoticeId = noticeId;
            }
            Diag($"interactive shown: notice={noticeId} title={title} presets={presets.Count} ack={requireAck}");
        }
        catch (Exception ex)
        {
            Diag("interactive build failed: " + ex.Message);
            Release(noticeId);
        }
    }

    /// <summary>上报一条回执；成功后延迟关闭弹窗（让用户看到"已发送"反馈）。</summary>
    private static async void SendReply(Window win, TextBlock status, string noticeId, string text,
        bool closeAfter = false)
    {
        try
        {
            status.Text = "正在发送…";
            var (ok, err) = await PostReplyAsync(noticeId, text);
            if (ok)
            {
                status.Text = closeAfter ? "已确认 ✔" : "已发送 ✔";
                Diag($"interactive reply ok: notice={noticeId} text={text}");
                if (closeAfter)
                {
                    await Task.Delay(400);
                    CloseWindow(win);
                }
            }
            else
            {
                status.Text = "发送失败：" + err;
                Diag($"interactive reply FAIL: notice={noticeId} err={err}");
            }
        }
        catch (Exception ex)
        {
            status.Text = "发送异常：" + ex.Message;
        }
    }

    /// <summary>
    /// 把回执 POST 到 CIMS 设备端（与心跳同一信任链：Host 头识别租户）。
    /// 后端 notice-reply 端点对空文本返回 400；这里在发之前已经挡住空文本。
    /// </summary>
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
            // 超时收紧：回执失败不该挂住 UI（见仓库铁律「HttpClient 超时收紧到 5s」）
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
        Diag($"interactive closed: notice={noticeId}");
    }

    internal static void Diag(string msg)
    {
        try
        {
            StelarithLog.Write("ste-interactive-diag.log", msg);
        }
        catch { /* 忽略 */ }
    }
}
