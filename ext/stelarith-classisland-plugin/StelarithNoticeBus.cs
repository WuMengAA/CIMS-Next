using System;
using System.Collections.Generic;
using System.Linq;

namespace StelarithControlPlugin;

/// <summary>
/// 星璃·集控「通知事件总线」—— 上岛组件（底部滚动条）与语音朗读共用的数据源。
///
/// 为什么需要它：<see cref="StelarithNotificationProvider"/> 负责把通知推给官方提醒系统，
/// 但那是一次性播放，滚动条组件需要在通知到达的**同一时刻**也收到一条事件，
/// 才能「播报一次 + 滚动条同步插入」；TTS 也需要在播报的同时拿到文本。
/// 让组件直接订阅提供方不行（提供方生命周期与 DI 单例绑定，且组件可能更早实例化），
/// 于是这里做一根轻量的静态事件总线：推通知的路径统一多打一发，组件按需订阅。
///
/// 线程模型：事件在后台线程触发，订阅方自行 marshal 到 UI 线程（组件基类已处理）。
/// 本类只保存最近 [MaxItems] 条文本，供组件首帧渲染时直接显示，避免空白等待。
/// </summary>
public static class StelarithNoticeBus
{
    /// <summary>一条通知事件。</summary>
    public sealed class NoticeEvent
    {
        public string Title { get; init; } = "";
        public string Body { get; init; } = "";
        /// <summary>呈现类型（island / popup / fullscreen / plain），滚动条据此决定样式。</summary>
        public string Kind { get; init; } = "island";
        public DateTimeOffset At { get; init; } = DateTimeOffset.Now;

        /// <summary>滚动条展示的一行文本。</summary>
        public string Line => string.IsNullOrWhiteSpace(Body) ? Title : Title + "：" + Body;
    }

    /// <summary>保留的最近条数（滚动条默认展示数量上限）。</summary>
    public const int MaxItems = 20;

    private static readonly object Lock = new();
    private static readonly List<NoticeEvent> Recent = new();

    /// <summary>新通知到达（后台线程触发）。</summary>
    public static event Action<NoticeEvent>? Received;

    /// <summary>最新一条事件（滚动条闪烁高亮用）；null = 还没有。</summary>
    public static NoticeEvent? Last
    {
        get { lock (Lock) return Recent.Count == 0 ? null : Recent[0]; }
    }

    /// <summary>当前全部事件快照（新在前）。</summary>
    public static IReadOnlyList<NoticeEvent> Snapshot()
    {
        lock (Lock) return Recent.ToArray();
    }

    /// <summary>
    /// 发布一条通知事件（推送通知的路径统一调用；幂等由调用方保证）。
    /// 同时触发 TTS（模块开启时）—— TTS 归口到这里，一处控制、全局生效。
    /// </summary>
    public static void Publish(string title, string body, string kind = "island", bool speak = false)
    {
        var ev = new NoticeEvent
        {
            Title = title ?? "",
            Body = body ?? "",
            Kind = kind,
            At = DateTimeOffset.Now,
        };
        lock (Lock)
        {
            Recent.Insert(0, ev);
            if (Recent.Count > MaxItems) Recent.RemoveRange(MaxItems, Recent.Count - MaxItems);
        }
        try { Received?.Invoke(ev); } catch { /* 订阅方异常不影响主流程 */ }

        if (speak && StelarithModules.IsEnabled(StelarithModules.Tts))
        {
            StelarithTts.Speak(ev.Line);
        }
    }

    /// <summary>直接朗读一段文本（不经事件总线；供全屏通知等独立场景使用）。</summary>
    public static void SpeakDirect(string text)
    {
        if (StelarithModules.IsEnabled(StelarithModules.Tts)) StelarithTts.Speak(text);
    }
}
