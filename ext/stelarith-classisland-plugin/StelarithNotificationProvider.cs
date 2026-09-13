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
    "星璃·集控",
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

    /// <summary>推送一条播报：遮罩显示标题，正文显示内容。任何异常都被吞掉，绝不影响命令执行。</summary>
    public void Push(string title, string? content, double seconds = 8)
    {
        try
        {
            // 构造 NotificationContent / LucideIconSource 等 Avalonia 控件必须在 UI 线程进行，
            // 而本方法由后台轮询线程（守护线程/ThreadPool）调用，直接构造会抛 "Call from invalid thread"。
            // 因此整体 marshal 到 Dispatcher.UIThread 执行。
            Dispatcher.UIThread.InvokeAsync(() =>
            {
                try
                {
                    var safeTitle = string.IsNullOrWhiteSpace(title) ? "星璃·集控" : title;
                    var duration = TimeSpan.FromSeconds(seconds > 0 ? seconds : 8);

                    var mask = NotificationContent.CreateTwoIconsMask(safeTitle);
                    mask.Duration = duration;

                    NotificationContent? overlay = null;
                    if (!string.IsNullOrWhiteSpace(content))
                    {
                        overlay = NotificationContent.CreateSimpleTextContent(content!);
                        overlay.Duration = duration;
                    }

                    ShowNotification(new NotificationRequest
                    {
                        MaskContent = mask,
                        OverlayContent = overlay,
                    });

                    Diag($"Push ok: title={safeTitle} contentLen={content?.Length ?? 0} duration={seconds}s");
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
