using System;
using System.IO;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using ClassIsland.Core.Abstractions.Services.NotificationProviders;
using ClassIsland.Core.Attributes;
using ClassIsland.Core.Models.Notification;

namespace StelarithControlPlugin;

/// <summary>
/// 星璃·集控「提醒提供方」——把 CIMS 下发的播报/通知落到 ClassIsland 官方提醒系统，
/// 由宿主在大屏上播放「单行大字播报」（标题+正文一行，字号加大；见 <see cref="Push"/>），
/// 与官方集控 <c>SendNotification</c> 命令语义对齐。
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

    // ─── 紧急通知（IsEmergency）───────────────────────────────────────────────
    // ClassIsland 2.1.0.1 的宿主 API 里**没有**任何「紧急」开关：
    // NotificationContent / NotificationRequest 上都没有对应成员（已核对
    // ClassIsland.Core.xml 与全部 ClassIsland.*.dll，连 IsEmargency 这种拼写变体都不存在），
    // IsEmergency 只存在于 SendNotification 的 protobuf 载荷里。
    // 也就是说官方「紧急」语义在这套 API 上**只能自己模拟**，没别的路子。
    // 模拟策略（全部落在本次 Push 内，不改宿主行为）：
    //   ① 跳过同内容去重与短时限频 —— 紧急通知被吞掉是最不能接受的失败形态；
    //   ② 强制置顶 + 强制声音 + 强制特效（集控端已经说了「紧急」，不接受教室端静音）；
    //   ③ 时长下限抬到 EmergencyMinSeconds，且至少重复两次，保证在课堂上被看见；
    //   ④ 涟漪特效颜色改红（NotificationContent.Color 的官方含义就是涟漪特效色）。
    /// <summary>紧急通知的显示时长下限（秒）。</summary>
    private const double EmergencyMinSeconds = 10.0;
    /// <summary>紧急通知的最小重复次数。</summary>
    private const int EmergencyMinRepeat = 2;

    /// <summary>
    /// 集控通知的附加开关（对应 CIMS <c>NotificationPayload</c> 的布尔字段）。
    /// 为 <c>null</c> = 「插件内部推送」（如"配置已同步"）→ 不动
    /// <c>RequestNotificationSettings</c>，让宿主按自己的提醒设置处理。
    /// </summary>
    public sealed class NotificationFlags
    {
        public bool IsSpeechEnabled { get; init; }
        public bool IsEffectEnabled { get; init; }
        public bool IsSoundEnabled { get; init; }
        public bool IsTopmost { get; init; }
        public bool IsEmergency { get; init; }
    }

    /// <summary>
    /// 推一条播报：**标题和正文合并为一行大字**，由自绘 <c>TextBlock</c> 直接呈现（不再走
    /// 官方「遮罩=标题 + 滚动浮层=正文」的两段式）。显示时长挂在遮罩内容自身的
    /// <c>Duration</c> 上（官方语义中遮罩不设时长、由正文浮层携带；当无正文浮层时，
    /// 由 <c>NotificationWorkerService</c> 在遮罩时长耗尽后完结整个提醒请求——
    /// 见其 <c>ProcessNotificationSessionCore</c>：<c>OverlayContent == null</c> 时遮罩结束即
    /// 请求完成）。
    ///
    /// <para><b>为什么自绘 TextBlock：</b>官方双图标遮罩模板的字号取宿主动态资源
    /// <c>MainWindowEmphasizedFontSize</c>（偏小，且被宿主设置控制），无法满足「广播字体调大」；
    /// 而 <c>NotificationContent.Content</c> 是 <c>object</c>，Avalonia 的 <c>ContentPresenter</c>
    /// 遇到「内容本身就是控件」时直接呈现该控件、不套任何 DataTemplate（官方
    /// <c>RollingTextTemplate</c> 即以此方式工作）— 因此这里直接构造一个
    /// <c>TextBlock</c>，字号、单行、省略号全部自控。</para>
    ///
    /// <para><b>字号自适应：</b>「标题：正文」合并后的长度决定字号（越长越小），保证
    /// 短广播以特大字号单行呈现、长广播也能在单行内尽量完整显示；<c>NoWrap</c> +
    /// 字符省略号兜底，绝不换行撑破大屏。</para>
    ///
    /// <para>带同内容去重 + 短时限频。</para>
    ///
    /// <para><paramref name="seconds"/> ≤ 0：取官方默认 5 秒，并在正文较长时按字数**抬高下限**
    /// （只增不减，避免长广播被 5 秒掐断）。&gt; 0：严格照用集控端给的 <c>DurationSeconds</c>。</para>
    /// </summary>
    /// <param name="repeatCounts">重复次数（官方为 duration × repeatCounts 的总时长）。</param>
    /// <param name="flags">集控载荷里的提醒开关；null 表示不改动请求级提醒设置。</param>
    public void Push(string title, string? content, double seconds = 0, int repeatCounts = 1,
        NotificationFlags? flags = null)
    {
        try
        {
            var now = DateTime.UtcNow.Ticks;
            var safeTitle = string.IsNullOrWhiteSpace(title) ? StelarithBranding.SourceName : title;
            var key = safeTitle + "\u0001" + (content ?? "");
            var emergency = flags is not null && flags.IsEmergency;

            if (emergency)
            {
                // 紧急通知**不许被降频**：去重/限频是为「轮询报错刷屏」准备的，
                // 用在紧急通知上会直接把「主任喊人」吞成 silence（fail-silent，红线）。
                Diag($"Push emergency: bypass dedup/rate-limit, title={safeTitle}");
            }
            else
            {
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
            }

            // 3) 时长策略（官方语义为准）：
            //    · 集控端显式给了 DurationSeconds（>0）→ 严格照用（上限 1 小时，与 CIMS 字段约束一致）；
            //    · 未指定（≤0）→ 官方默认 5 秒，并**只在内容较长时抬高下限**（只增不减），
            //      这样长播报不会被 5 秒掐断，短提示也不会长时间占屏。
            //    · 紧急通知：只增不减地抬到下限（EmergencyMinSeconds），并保证重复至少两次。
            var repeat = Math.Max(1, emergency ? Math.Max(repeatCounts, EmergencyMinRepeat) : repeatCounts);
            double effective;
            if (seconds > 0) effective = Math.Min(seconds, 3600.0);
            else effective = Math.Max(5.0, 2.5 + (content?.Length ?? 0) * 0.12);
            if (emergency) effective = Math.Max(effective, EmergencyMinSeconds);

            // 构造 Avalonia 控件必须在 UI 线程进行，而本方法由后台轮询线程（守护线程/ThreadPool）
            // 调用，直接构造会抛 "Call from invalid thread"。整体 marshal 到 Dispatcher.UIThread。
            var effTitle = safeTitle;
            var effContent = content;
            var effDuration = effective;
            var effRepeat = repeat;
            var effFlags = flags;
            var effEmergency = emergency;
            Dispatcher.UIThread.InvokeAsync(() =>
            {
                try
                {
                    // 「标题：正文」合并为一行（无正文时仅标题）。
                    var combined = string.IsNullOrWhiteSpace(effContent)
                        ? effTitle
                        : effTitle + "：" + effContent;

                    // 遮罩内容：自绘单行大字 TextBlock（Content=控件 → ContentPresenter 直接呈现，
                    // 不套官方模板，字号完全自控）。时长挂在遮罩自身（无正文浮层时遮罩结束即请求完成）。
                    var total = TimeSpan.FromSeconds(effDuration) * effRepeat;
                    var mask = new NotificationContent(BuildSingleLineTextBlock(combined))
                    {
                        SpeechContent = combined,
                        Duration = total,
                        // 紧急：涟漪特效改红，让「这不是普通播报」在远看也能一眼分辨。
                        // 这是 NotificationContent.Color 的官方含义（涟漪特效色），不会改文字颜色，
                        // 所以字号/可读性完全不受影响。
                        Color = effEmergency ? new Avalonia.Media.SolidColorBrush(Avalonia.Media.Colors.Red) : null,
                    };

                    var req = new NotificationRequest
                    {
                        MaskContent = mask,
                        OverlayContent = null,   // 无滚动浮层：全部内容就在那一行大字里
                    };

                    // 只有这些开关来自集控载荷时才写请求级提醒设置（与官方一致）；
                    // 插件内部推送保持"不动它"，让宿主的提醒设置照常生效。
                    if (effFlags is not null && req.RequestNotificationSettings is not null)
                    {
                        var s = req.RequestNotificationSettings;
                        s.IsSettingsEnabled = true;
                        s.IsSpeechEnabled = effFlags.IsSpeechEnabled;
                        s.IsNotificationEffectEnabled = effFlags.IsEffectEnabled;
                        s.IsNotificationSoundEnabled = effFlags.IsSoundEnabled;
                        s.IsNotificationTopmostEnabled = effFlags.IsTopmost;
                        if (effEmergency)
                        {
                            // 紧急 = 不接受教室端静音/不置顶：集控端既然标了紧急，
                            // 就该盖过大屏上的其它一切（含宿主的「关闭提示音」设置）。
                            s.IsNotificationEffectEnabled = true;
                            s.IsNotificationSoundEnabled = true;
                            s.IsNotificationTopmostEnabled = true;
                        }
                    }

                    ShowNotification(req);

                    // 同步打进通知事件总线：底部滚动条组件据此插入新条目并高亮；
                    // 语音策略（2026-09-26 修复双读）：官方播放 `SpeechContent` 已由
                    // 宿主按 IsSpeechEnabled 朗读；我们的 TTS 只在官方**没有**朗读时补偿
                    // （载荷未要求官方语音 / 插件内部推送），避免同一句被念两遍。
                    StelarithNoticeBus.Publish(
                        effTitle,
                        effContent ?? "",
                        kind: effEmergency ? "fullscreen" : "island",
                        speak: effFlags is null || !effFlags.IsSpeechEnabled);

                    Diag($"Push ok: oneLine={combined.Length}ch font={BuildSingleLineFontSize(combined.Length)} " +
                         $"maskDuration={total.TotalSeconds:N1}s flags={(effFlags is null ? "宿主默认" : "集控载荷")}" +
                         $" emergency={(effEmergency ? "yes(red/topmost/sound, ≥" + EmergencyMinSeconds + "s×" + EmergencyMinRepeat + ")" : "no")}");
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

    /// <summary>
    /// 构造「一行大字」遮罩文本块：特大字号（随长度自适应）、加粗、单行不换行、超长省略，
    /// 横纵居中。标题与正文已由调用方合并成 <paramref name="text"/>。
    /// </summary>
    private static TextBlock BuildSingleLineTextBlock(string text)
    {
        return new TextBlock
        {
            Text = text,
            FontSize = BuildSingleLineFontSize(text.Length),
            FontWeight = FontWeight.Bold,
            TextWrapping = TextWrapping.NoWrap,
            TextTrimming = TextTrimming.CharacterEllipsis,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            MaxWidth = 1600,
        };
    }

    /// <summary>
    /// 单行大字的字号策略：越短越大（短广播 96 号字震撼呈现），随长度逐档降级，
    /// 最低 40 号，保证长广播的单行仍可读。相比官方模板的宿主动态资源字号（约
    /// 32~48）整体抬高一个量级，满足「广播字体调大」。
    /// </summary>
    private static double BuildSingleLineFontSize(int textLength)
    {
        if (textLength <= 10) return 96;
        if (textLength <= 20) return 84;
        if (textLength <= 32) return 72;
        if (textLength <= 48) return 60;
        if (textLength <= 72) return 52;
        if (textLength <= 110) return 46;
        return 40;
    }

    /// <summary>文件诊断：写官方 PluginConfigFolder/logs/ste-notify-diag.log，不依赖宿主 logger。</summary>
    internal static void Diag(string msg)
    {
        try
        {
                StelarithLog.Write("ste-notify-diag.log", msg);
        }
        catch { /* 诊断写入失败忽略 */ }
    }
}
