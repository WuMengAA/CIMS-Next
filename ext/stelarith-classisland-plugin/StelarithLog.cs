using System;
using System.IO;
using ClassIsland.Core.Abstractions;

namespace StelarithControlPlugin;

/// <summary>
/// 诊断日志与插件私有文件的统一落点：官方 <c>PluginConfigFolder</c>。
///
/// 为什么需要它：旧实现把 <c>ste-*.log</c> 与各类 <c>stelarith-*.json</c> 直接写进
/// <c>AppContext.BaseDirectory</c>（= ClassIsland 程序目录）。这有两个问题：
///   ① 污染宿主目录，不符合 ClassIsland 官方规范（「插件的各项设置应当存放在
///      PluginConfigFolder 中」，见 PluginBase.PluginConfigFolder 文档）；
///   ② 插件升级 / 重装时程序目录被覆盖，诊断与设置全丢。
///
/// 收敛后：配置文件（stelarith-*.json）放在 ConfigDir 根；滚动诊断日志放在
/// ConfigDir/logs。解析官方配置目录失败时回落程序集目录，保证任何情况下都不抛异常、
/// 不影响主流程。
/// </summary>
public static class StelarithLog
{
    /// <summary>
    /// 官方插件配置目录。由插件入口在 <c>Initialize</c> 中注入（与 StelarithSyncOptions.ConfigDir 同机制）：
    /// <c>PluginBase.PluginConfigFolder</c> 是实例属性，非派生类无法直接取，故由插件基类统一注入。
    /// 未注入时（静态守护线程可能早于 Initialize 运行）回落程序集目录，保持兼容、绝不抛异常。
    /// </summary>
    public static string? ConfigDir { get; set; }

    /// <summary>解析配置目录：优先注入值，其次程序集目录（兜底）。</summary>
    private static string ResolveConfigDir()
    {
        var d = ConfigDir;
        if (!string.IsNullOrWhiteSpace(d)) return d!;
        try
        {
            return Path.GetDirectoryName(typeof(StelarithLog).Assembly.Location)
                   ?? AppContext.BaseDirectory;
        }
        catch { return AppContext.BaseDirectory; }
    }

    /// <summary>诊断日志目录 = 配置目录/logs（惰性创建）。</summary>
    public static string LogDir
    {
        get
        {
            var dir = Path.Combine(ResolveConfigDir(), "logs");
            try { Directory.CreateDirectory(dir); } catch { /* 不可写则回落调用方吞掉 */ }
            return dir;
        }
    }

    /// <summary>追加一行诊断到 LogDir 下的 fileName（如 "ste-sync-diag.log"）。</summary>
    public static void Write(string fileName, string msg)
    {
        try
        {
            File.AppendAllText(
                Path.Combine(LogDir, fileName),
                $"{DateTime.Now:HH:mm:ss.fff} {msg}{Environment.NewLine}");
        }
        catch { /* 诊断写失败绝不影响主流程 */ }
    }
}
