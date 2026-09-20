using System;

namespace StelarithControlPlugin;

/// <summary>
/// 星璃·集控「设备首次绑定引导（OOBE）」状态机。
///
/// 背景（2026-09-18 现场根因）：
///   新教室机插上集控后"看起来自动归到 1 班"，其实**从未被管理端绑定** —— 设备建档时
///   <c>client_profiles.class_id</c> 留空，插件端也就没有真正的 OOBE 引导，于是本地
///   ClassIsland 用离线默认档案（演示/默认班）显示，造成"自动归 1 班"的假象。
///
/// 修复分工：
///   · 后端 <c>GET /v1/client/{uid}/status</c> 返回 <c>bound</c>（= 是否已绑定班级）；
///   · 本类由心跳回读线程驱动：<c>bound=false</c> 时置 <c>Unbound=true</c>，并（限频）推一条
///     引导通知，把"去面板绑定"这件事显式告诉电教委员；
///   · 设置页（StelarithPanelSettingsPage）读 <c>Unbound</c> 渲染一条常驻横幅，避免通知被忽略。
///
/// 限频：仅在「已绑定→未绑定」的跳变，或距上次提醒超过 1 小时时再推，避免在公网慢 /
/// 管理端尚未操作时每 5 分钟回读就霸屏（通知通道另有同内容 20s 去重兜底）。
/// </summary>
public static class StelarithOobE
{
    /// <summary>可选班级（由回读线程从 GET /status 的 suggest 填充；OOBE 下拉用）。</summary>
    public sealed class ClassSuggestion
    {
        public string ClassId { get; set; } = "";
        public string Name { get; set; } = "";
        public string Code { get; set; } = "";
        public bool Selectable { get; set; }
    }

    /// <summary>本机尚未绑定班级时，回读线程缓存的可选班级清单（仅 approved 班）。</summary>
    public static List<ClassSuggestion> Suggestions { get; private set; } = new();

    /// <summary>回读线程调用：写入服务端权威的可选班级清单。</summary>
    public static void SetSuggestions(List<ClassSuggestion> list)
        => Suggestions = list ?? new List<ClassSuggestion>();

    /// <summary>本机是否尚未绑定班级（由回读线程驱动）。</summary>
    public static bool Unbound { get; private set; }

    /// <summary>最近一次引导通知的刻度（UTC Ticks），用于限频。</summary>
    private static long _lastRemindTicks;

    /// <summary>已未绑定时，最多每隔这么久再提醒一次（避免刷屏）。</summary>
    private const double RemindIntervalSeconds = 3600.0;

    /// <summary>
    /// 回读线程调用：传入服务端权威的 bound 与 class_id。
    /// bound 缺失时（旧后端）用 class_id 是否为空兜底推导。
    /// </summary>
    public static void Update(bool bound, string classId)
    {
        var nowUnbound = !bound;
        var wasUnbound = Unbound;
        Unbound = nowUnbound;
        if (!nowUnbound) return; // 已绑定：无需引导

        try
        {
            var now = DateTime.UtcNow.Ticks;
            var shouldRemind = !wasUnbound
                || (now - _lastRemindTicks) >= TimeSpan.FromSeconds(RemindIntervalSeconds).Ticks;
            if (!shouldRemind) return;
            _lastRemindTicks = now;

            StelarithNotificationProvider.Current?.Push(
                StelarithBranding.SourceName,
                "本机尚未绑定班级：请打开集控面板 → 设备控制 → 本设备 → 选择班级完成绑定。"
                + "绑定后才会收到本班课表与定向广播，否则会一直停留在默认档案。",
                10);
        }
        catch
        {
            // 通知失败绝不影响心跳主流程
        }
    }
}
