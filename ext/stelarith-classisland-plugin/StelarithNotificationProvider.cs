using System;
using System.IO;
using Avalonia.Threading;
using ClassIsland.Core.Abstractions.Services.NotificationProviders;
using ClassIsland.Core.Attributes;
using ClassIsland.Core.Models.Notification;

namespace StelarithControlPlugin;

/// <summary>
/// 星璃·集控「提醒提供方」——把 CIMS 下发的播报/通知落到 ClassIsland 官方提醒系统，
/// 由宿主在大屏上播放「遮罩 + 正文」，与官方集控 <c>SendNotification</c> 命令语义对齐。
///
/// 为什么必须继承 <see cref="NotificationProviderBase"/>：
///   · 宿主只公开 <c>NotificationProviderBase.ShowNotification(NotificationRequest)</c> 这一个
///     推送入口；<c>INotificationHostService.ShowNotification(...)</c> 是 internal，插件调不到。
///   · 基类构造函数会按 <c>GetType()</c> 到 <c>NotificationProviderRegistryService.RegisteredProviders</c>
///     查注册信息，查不到直接抛 InvalidOperationException。因此注册必须走官方扩展方法
///     <c>services.AddNotificationProvider&lt;T&gt;()</c>（见 StelarithControlPlugin.Initialize），
///     它会在 DI 构建本类型之前把 <c>[NotificationProviderInfo]</c> 信息写入注册表。
///   · 基类构造函数在拿到注册信息后会自行调用
///     <c>INotificationHostService.RegisterNotificationProvider(this)</c>（autoRegister 默认 true），
///     所以「注册」发生在**构造函数**里，而不是 StartAsync——即使宿主启动序列被其它插件异常
///     中断（见 README「二号坑」），本提供方依然会注册成功。
///
/// 与旧实现的区别：旧代码让插件入口类自身实现 <c>INotificationProvider</c>，只能"被列为提供方"，
/// 没有任何推送能力，且注册调用写在 BackgroundService.ExecuteAsync 里从未执行——表现为
/// 「网页端广播下发成功，教室端毫无动静」。
/// </summary>
[NotificationProviderInfo(
    "9f1c2b3a-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
    "集控广播",
    "星璃多媒体统一集控播报通道：接收集控端下发的广播与提醒。")]
public sealed class StelarithNotificationProvider : NotificationProviderBase
{
    /// <summary>最近一次构建的实例（供命令处理器跨线程推送用；由 DI 构造，生命周期为单例）。</summary>
    private static StelarithNotificationProvider? _current;

    /// <summary>当前可用的提醒提供方；为 null 表示尚未被 DI 构造（此时调用方应降级到托盘气泡）。</summary>
    public static StelarithNotificationProvider? Current => _current;

    public StelarithNotificationProvider()
    {
        _current = this;
        Diag($"ctor: 提醒提供方已创建并自动注册（Guid={ProviderGuid}）");
    }

    /// <summary>最近一次推送时间（抑制同一秒刷屏）。</summary>
    private static long _lastPushTicks;
    private static readonly object _gate = new();

    /// <summary>同内容去重窗口（秒）：窗口内推送过完全相同的标题+正文则丢弃，防「远程连接报错」这类轮询错误疯狂霸屏。</summary>
    private const double DedupWindowSeconds = 20.0;
    private static string? _recentKey;
    private static long _recentPushTicks;

    /// <summary>两次不同内容的推送最小间隔（秒），避免连续报错把通知刷爆。</summary>
    private const double MinGapSeconds = 1.5;

    /// <summary>推一条播报：遮罩显示标题，正文显示内容。带同内容去重 + 短时限频 + 字数自适应时长。
    /// 任何异常都被吞掉，绝不影响命令执行。</summary>
    public void Push(string title, string? content, double seconds = 8)
    {
        try
        {
            var now = DateTime.UtcNow.Ticks;
            var safeTitle = string.IsNullOrWhiteSpace(title) ? StelarithBranding.SourceName : title;
            var key = safeTitle + "\u0001" + (content ?? "");

            lock (_gate)
            {
                // 1) 同内容去重：窗口内已弹过完全一样的内容 → 丢弃（远程连接报错这类轮询错误不重复霸屏）
                if (_recentKey == key && (now - _recentPushTicks) < TimeSpan.FromSeconds(DedupWindowSeconds).Ticks)
                {
                    Diag($"Push dedup-skip: {safeTitle} (same content within {DedupWindowSeconds}s)");
                    return;
                }
                // 2) 短时限频：两次不同内容太密，也丢弃，避免刷爆
                if (_recentKey != null && (now - _lastPushTicks) < TimeSpan.FromSeconds(MinGapSeconds).Ticks)
                {
                    Diag($"Push rate-skip: {safeTitle} (gap<{MinGapSeconds}s)");
                    return;
                }
                _lastPushTicks = now;
                _recentKey = key;
                _recentPushTicks = now;
            }

            // 3) 时长随字数自适应：默认时长(8)按「读速≈每字0.4s +基线」推导，长广播不被掐断、
            //    短提示不长时间占屏；外部显式传2/5/6等特殊时长依然保留。
            var effective = seconds;
            if (seconds == 8.0) // 默认 → 自适应
                effective = Math.Clamp(2.5 + (content?.Length ?? 0) * 0.12, 3.0, 20.0);

            // 构造 NotificationContent / LucideIconSource 等 Avalonia 控件必须在 UI 线程进行，
            // 而本方法由后台轮询线程（守护线程/ThreadPool）调用，直接构造会抛 "Call from invalid thread"。
            // 因此整体 marshal 到 Dispatcher.UIThread 执行。
            var effTitle = safeTitle;
            var effContent = content;
            var effDuration = effective;
            Dispatcher.UIThread.InvokeAsync(() =>
            {
                try
                {
                    var duration = TimeSpan.FromSeconds(effDuration > 0 ? effDuration : 8);

                    var mask = NotificationContent.CreateTwoIconsMask(effTitle);
                    mask.Duration = duration;

                    NotificationContent? overlay = null;
                    if (!string.IsNullOrWhiteSpace(effContent))
                    {
                        overlay = NotificationContent.CreateSimpleTextContent(effContent!);
                        overlay.Duration = duration;
                    }

                    ShowNotification(new NotificationRequest
                    {
                        MaskContent = mask,
                        OverlayContent = overlay,
                    });

                    Diag($"Push ok: title={effTitle} contentLen={effContent?.Length ?? 0} duration={effDuration:N1}s");
                }
                catch (Exception ex)
                {
                    Diag("Push(invoke) failed: " + ex);
                }
            });
        }
        catch (Exception ex)
        {
            Diag("Push dispatch failed: " + ex);
        }
    }

    /// <summary>文件诊断：写 AppContext.BaseDirectory/ste-notify-diag.log，不依赖宿主 logger。</summary>
    internal static void Diag(string msg)
    {
        try
        {
            File.AppendAllText(
                Path.Combine(AppContext.BaseDirectory, "ste-notify-diag.log"),
                $"{DateTime.Now:HH:mm:ss.fff} {msg}{Environment.NewLine}");
        }
        catch { /* 诊断写入失败忽略 */ }
    }
}
