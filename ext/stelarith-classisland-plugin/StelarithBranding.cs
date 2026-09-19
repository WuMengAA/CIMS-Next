using System;
using System.IO;

namespace StelarithControlPlugin;

/// <summary>
/// 「来源名称」等可自定义的品牌信息。
///
/// 教室大屏上遮罩播报显示的是「谁在说话」。默认叫「集控广播」——因为集控下发里既有
/// 全校广播、也有班级通知、还有设备指令回执，统一成一个中性名字最不容易误认。
/// 学校想叫「校园广播站」「德育处通知」之类，改 stelarith-sync.json 的
/// <c>NotificationSourceName</c> 即可，无需重新编译。
///
/// 注意：<see cref="StelarithNotificationProvider"/> 上的 <c>[NotificationProviderInfo]</c>
/// 名称是编译期常量（要写进宿主注册表），改不了；这里控制的是**推送出来的标题**，
/// 也就是学生在屏幕上真正看到的那行字。
/// </summary>
public static class StelarithBranding
{
    /// <summary>缺省来源名。任何地方都不要再硬编码字符串，统一走 <see cref="SourceName"/>。</summary>
    public const string DefaultSourceName = "集控广播";

    private static volatile string _sourceName = DefaultSourceName;

    /// <summary>当前生效的来源名称（永不为空）。</summary>
    public static string SourceName =>
        string.IsNullOrWhiteSpace(_sourceName) ? DefaultSourceName : _sourceName;

    /// <summary>从配置刷新（插件启动与设置页保存后调用）。</summary>
    public static void Apply(StelarithSyncOptions opt)
    {
        var name = opt.NotificationSourceName;
        _sourceName = string.IsNullOrWhiteSpace(name) ? DefaultSourceName : name.Trim();
    }

    internal static void Diag(string msg)
    {
        try
        {
            StelarithLog.Write("ste-branding-diag.log", msg);
        }
        catch { /* 忽略 */ }
    }
}

/// <summary>
/// 本机「班级身份」——从宿主 ClassIsland 档案里当前激活的课表群推导，如「3班课表群」→「3班」。
/// 点歌组件要靠它显示「本班级」字样；取不到时回落到设备 uid，绝不显示空白。
/// </summary>
public static class StelarithClassIdentity
{
    private static string _cached = "";
    private static DateTimeOffset _cachedAt = DateTimeOffset.MinValue;

    /// <summary>班级显示名（带 20 秒缓存，避免每次刷新都去翻档案文件）。</summary>
    public static string CurrentLabel
    {
        get
        {
            if (!string.IsNullOrWhiteSpace(_cached) && DateTimeOffset.Now - _cachedAt < TimeSpan.FromSeconds(20))
                return _cached;

            var label = "";
            try
            {
                var groupName = StelarithProfileWriter.CurrentActiveClassGroupName();
                label = ShortenClassGroup(groupName);
            }
            catch { /* 档案不可读时回落到设备标识 */ }

            if (string.IsNullOrWhiteSpace(label))
            {
                try
                {
                    var opt = StelarithSyncOptions.Load();
                    label = string.IsNullOrWhiteSpace(opt.ClientUid) ? "本机" : opt.ClientUid;
                }
                catch { label = "本机"; }
            }

            _cached = label;
            _cachedAt = DateTimeOffset.Now;
            return label;
        }
    }

    /// <summary>把课表群名压成班级短名：「3班课表群」「高三(3)班课表」→ 去掉后缀。</summary>
    internal static string ShortenClassGroup(string? groupName)
    {
        if (string.IsNullOrWhiteSpace(groupName)) return "";
        var s = groupName.Trim();
        foreach (var suffix in new[] { "课表群", "课表", "的课表群", "的课表" })
        {
            if (s.EndsWith(suffix, StringComparison.Ordinal) && s.Length > suffix.Length)
            {
                s = s.Substring(0, s.Length - suffix.Length).Trim();
                break;
            }
        }
        return s;
    }
}
