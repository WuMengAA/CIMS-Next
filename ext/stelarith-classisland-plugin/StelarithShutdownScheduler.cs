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
/// 定时关机计划（schedule_shutdown 载荷）。字段 snake_case，与本地代理
/// <c>ScheduleEntry</c>（serde）逐一对齐：id/mode/time/days/datetime/minutes/enabled/note。
/// 四种模式：daily（每天 time）/ weekly（days 所列周几的 time）/ once（datetime 一次性）/
/// countdown（确认后 minutes 分钟）。
/// </summary>
public class StelarithScheduleSpec
{
    [System.Text.Json.Serialization.JsonPropertyName("id")]
    public string Id { get; set; } = "";
    /// <summary>daily | weekly | once | countdown</summary>
    [System.Text.Json.Serialization.JsonPropertyName("mode")]
    public string Mode { get; set; } = "";
    /// <summary>daily/weekly：HH:MM</summary>
    [System.Text.Json.Serialization.JsonPropertyName("time")]
    public string Time { get; set; } = "";
    /// <summary>weekly：1=周一 .. 7=周日</summary>
    [System.Text.Json.Serialization.JsonPropertyName("days")]
    public List<int> Days { get; set; } = new();
    /// <summary>once：本地时区 "YYYY-MM-DDTHH:MM"</summary>
    [System.Text.Json.Serialization.JsonPropertyName("datetime")]
    public string DateTimeValue { get; set; } = "";
    /// <summary>countdown：分钟后关机（1..720）</summary>
    [System.Text.Json.Serialization.JsonPropertyName("minutes")]
    public int Minutes { get; set; } = 30;
    /// <summary>false = 停用（同 id 下发 enabled=false 即取消该计划）</summary>
    [System.Text.Json.Serialization.JsonPropertyName("enabled")]
    public bool Enabled { get; set; } = true;
    /// <summary>人类可读备注（面板填写）</summary>
    [System.Text.Json.Serialization.JsonPropertyName("note")]
    public string Note { get; set; } = "";
}

/// <summary>
/// 星璃·集控「定时关机确认窗」——教室端对管理端下发的长期关机计划做**人机确认**。
///
/// 为什么必须确认（用户拍板"下发后需教室端确认，一分钟内确认即可"）：
/// 定时关机影响的是"这台机器之后会不会在某个时刻被关掉"，发错计划（比如把晚自习
/// 的机器设成 20:00 关机）代价是实打实的。所以管理端下发后**不立即生效**——
/// 教室端弹出确认窗（计划详情 + 60 秒倒计时），60 秒内点「确认启用」才透传给本地
/// 代理落盘 + 调度；点「拒绝」或超时则回执上报、计划不生效。
///
/// 流转：
///   · 面板 schedule_shutdown(stelarith_task.action) → 本窗（60s 倒计时）
///   · 确认 → AgentClient.SendAsync(原 task) 透传给代理（schedule 字段原样携带）
///   · 结果（已确认/已拒绝/超时）→ POST /api/v1/client/{uid}/notice-reply 回执，
///     notice_id = schedule.id，管理端「回执收件箱」可见每台设备对计划的处置。
///
/// 防抖：同一 schedule.id 只弹一次；已有确认窗时丢弃新计划（防霸屏）。
/// </summary>
public static class StelarithShutdownScheduler
{
    /// <summary>确认窗口期（秒）。超时按「拒绝」处理并回执。</summary>
    public const int ConfirmSeconds = 60;

    private static readonly AgentClient Agent = new();
    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        PooledConnectionLifetime = TimeSpan.FromSeconds(2),
        PooledConnectionIdleTimeout = TimeSpan.FromSeconds(1),
        AutomaticDecompression = System.Net.DecompressionMethods.All,
    });

    private static readonly object Gate = new();
    private static Window? _active;
    private static string? _activeId;
    private static readonly HashSet<string> Shown = new();

    /// <summary>展示确认窗（dispatch 线程调用；内部 marshal 到 UI 线程）。</summary>
    public static void Show(StelarithTask task)
    {
        var sched = task.Schedule;
        if (sched is null)
        {
            Diag("schedule_shutdown: 缺 schedule 字段，忽略");
            return;
        }
        var id = (sched.Id ?? "").Trim();
        if (id.Length == 0)
        {
            Diag("schedule_shutdown: 缺 schedule.id，忽略");
            return;
        }

        lock (Gate)
        {
            if (_active is not null)
            {
                Diag($"schedule drop: 已有确认窗（{_activeId}），丢弃 {id}");
                return;
            }
            if (!Shown.Add(id))
            {
                Diag($"schedule drop: 计划 {id} 已确认/处理过");
                return;
            }
        }

        try
        {
            Dispatcher.UIThread.InvokeAsync(() => BuildAndShow(task, sched, id));
        }
        catch (Exception ex)
        {
            Diag("schedule dispatch failed: " + ex.Message);
        }
    }

    private static void BuildAndShow(StelarithTask task, StelarithScheduleSpec sched, string id)
    {
        try
        {
            var win = new Window
            {
                Title = "星璃 · 定时关机确认",
                Width = 520,
                MaxHeight = 420,
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
                Text = sched.Enabled ? "定时关机计划确认" : "取消定时关机计划确认",
                FontSize = 22,
                FontWeight = FontWeight.Bold,
                Foreground = StelarithTheme.IsLight
                    ? Brushes.Black
                    : new SolidColorBrush(Color.FromRgb(0xEF, 0xEF, 0xF4)),
            };
            root.Children.Add(titleBlock);

            // 计划详情
            var detailBlock = new TextBlock
            {
                Text = DescribeSchedule(sched),
                FontSize = 15,
                TextWrapping = TextWrapping.Wrap,
                Foreground = StelarithTheme.IsLight
                    ? new SolidColorBrush(Color.FromRgb(0x33, 0x33, 0x3B))
                    : new SolidColorBrush(Color.FromRgb(0xCF, 0xCF, 0xD8)),
            };
            root.Children.Add(detailBlock);

            // 60 秒倒计时提示
            var countdown = new TextBlock
            {
                Text = $"请在 {ConfirmSeconds} 秒内确认，超时自动作废",
                FontSize = 13,
                FontWeight = FontWeight.SemiBold,
                Foreground = new SolidColorBrush(Color.FromRgb(0xC7, 0x6A, 0x00)),
            };
            root.Children.Add(countdown);

            // 状态行（转发/回执结果反馈）
            var status = new TextBlock
            {
                FontSize = 12,
                TextWrapping = TextWrapping.Wrap,
                Foreground = StelarithTheme.IsLight
                    ? new SolidColorBrush(Color.FromRgb(0x6B, 0x6B, 0x74))
                    : new SolidColorBrush(Color.FromRgb(0x9A, 0x9A, 0xA6)),
            };
            root.Children.Add(status);

            // 底部按钮
            var btnRow = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 8,
                HorizontalAlignment = HorizontalAlignment.Right,
                Margin = new Thickness(0, 4, 0, 0),
            };
            var confirmBtn = new Button
            {
                Content = sched.Enabled ? "确认启用" : "确认取消",
                FontSize = 14,
                FontWeight = FontWeight.SemiBold,
                Padding = new Thickness(20, 8),
            };
            var rejectBtn = new Button
            {
                Content = "拒 绝",
                FontSize = 14,
                Padding = new Thickness(20, 8),
            };
            btnRow.Children.Add(confirmBtn);
            btnRow.Children.Add(rejectBtn);
            root.Children.Add(btnRow);

            win.Content = root;

            // 倒计时 DispatcherTimer：每秒递减，到 0 视为拒绝（超时作废 + 回执）
            var remain = ConfirmSeconds;
            var timer = new DispatcherTimer(DispatcherPriority.Normal)
            {
                Interval = TimeSpan.FromSeconds(1),
            };
            timer.Tick += (_, _) =>
            {
                remain--;
                if (remain <= 0)
                {
                    timer.Stop();
                    countdown.Text = "已超时，计划未生效（按拒绝处理）";
                    confirmBtn.IsEnabled = false;
                    rejectBtn.IsEnabled = false;
                    Diag($"schedule timeout: id={id}");
                    _ = SendReceiptAsync(win, status, id, "定时关机确认超时（60s），计划未生效：" + DescribeSchedule(sched));
                    return;
                }
                countdown.Text = $"请在 {remain} 秒内确认，超时自动作废";
            };
            timer.Start();

            // 确认：转发给本地代理（落盘+调度），成功后回执并关闭
            confirmBtn.Click += async (_, _) =>
            {
                timer.Stop();
                confirmBtn.IsEnabled = false;
                rejectBtn.IsEnabled = false;
                status.Text = "正在应用…";
                Diag($"schedule confirm: id={id}");
                var r = await Agent.SendAsync(task);
                if (r.Ok)
                {
                    Diag($"schedule applied to agent: id={id}");
                    await SendReceiptAsync(win, status, id, "定时关机已确认并生效：" + DescribeSchedule(sched));
                    status.Text = "已确认并生效 ✔（回执已上报）";
                    await Task.Delay(600);
                    CloseWindow(win);
                }
                else
                {
                    status.Text = "应用失败：" + r.Error + "（可重试或拒绝）";
                    confirmBtn.IsEnabled = true;
                    rejectBtn.IsEnabled = true;
                    timer.Start();
                }
            };

            // 拒绝：回执上报 + 关闭（计划不生效）
            rejectBtn.Click += async (_, _) =>
            {
                timer.Stop();
                confirmBtn.IsEnabled = false;
                rejectBtn.IsEnabled = false;
                status.Text = "已拒绝，计划未生效";
                Diag($"schedule rejected: id={id}");
                await SendReceiptAsync(win, status, id, "定时关机已拒绝，计划未生效：" + DescribeSchedule(sched));
                await Task.Delay(500);
                CloseWindow(win);
            };

            win.Closed += (_, _) =>
            {
                timer.Stop();
                lock (Gate)
                {
                    _active = null;
                    _activeId = null;
                }
                Diag($"schedule window closed: id={id}");
            };
            win.Show();

            lock (Gate)
            {
                _active = win;
                _activeId = id;
            }
            Diag($"schedule confirm shown: id={id} mode={sched.Mode} enabled={sched.Enabled}");
        }
        catch (Exception ex)
        {
            Diag("schedule build failed: " + ex.Message);
            lock (Gate)
            {
                _active = null;
                _activeId = null;
            }
        }
    }

    /// <summary>计划的人类可读描述（确认窗正文 + 回执文案共用）。</summary>
    internal static string DescribeSchedule(StelarithScheduleSpec s)
    {
        var note = string.IsNullOrWhiteSpace(s.Note) ? "" : $"｜{s.Note.Trim()}";
        var body = s.Mode switch
        {
            "daily" => $"每天 {s.Time} 自动关机",
            "weekly" => $"每周 {WeekNames(s.Days)} 的 {s.Time} 自动关机",
            "once" => $"一次性：{s.DateTimeValue.Replace("T", " ")} 自动关机",
            "countdown" => $"确认后 {s.Minutes} 分钟自动关机",
            _ => $"定时计划（mode={s.Mode}）",
        };
        return body + note;
    }

    private static string WeekNames(List<int> days)
    {
        var names = new[] { "周一", "周二", "周三", "周四", "周五", "周六", "周日" };
        var sel = days.Where(d => d >= 1 && d <= 7).OrderBy(d => d).Select(d => names[d - 1]).ToList();
        return sel.Count == 0 ? "（未指定）" : string.Join("、", sel);
    }

    /// <summary>把处置结果上报 CIMS 回执收件箱（notice_id = schedule.id）。失败不阻断关闭。</summary>
    private static async Task SendReceiptAsync(Window win, TextBlock status, string noticeId, string text)
    {
        try
        {
            var opt = StelarithSyncOptions.Load();
            if (opt is null || string.IsNullOrWhiteSpace(opt.ClientUid))
            {
                Diag("schedule receipt: 配置未加载或 ClientUid 为空");
                return;
            }
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
            if (resp.IsSuccessStatusCode)
            {
                Diag($"schedule receipt ok: id={noticeId} text={text}");
            }
            else
            {
                var body = await resp.Content.ReadAsStringAsync();
                Diag($"schedule receipt FAIL: id={noticeId} HTTP {(int)resp.StatusCode} {body}");
            }
        }
        catch (Exception ex)
        {
            Diag("schedule receipt exception: " + ex.Message);
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

    internal static void Diag(string msg)
    {
        try
        {
            StelarithLog.Write("ste-shutdown-diag.log", msg);
        }
        catch { /* 忽略 */ }
    }
}
