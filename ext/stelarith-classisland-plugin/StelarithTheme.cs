using System;
using Avalonia;
using Avalonia.Media;
using Avalonia.Styling;

namespace StelarithControlPlugin;

/// <summary>
/// 插件页面配色的**唯一**来源（主题自适应）。
///
/// 为什么要有这个类（踩过的坑）：
///   早期两个设置页把前景色写死成 `Brushes.White` / `Color.FromArgb(200,255,255,255)`，
///   在深色主题下正常，一旦切到**浅色主题**（或宿主启用了自定义前景色），整页文字就变成
///   白字白底 —— 完全看不清。硬编码颜色在"支持双主题 + 自定义配色"的宿主里必然是 bug。
///
/// 本类的两条规则：
///   ① **正文一律不设 `Foreground`**：Avalonia 的 `TextBlock` 会从父级继承 `TextElement.Foreground`，
///      而设置窗口的父级已经是主题正确的画刷。继承 = 自动跟随主题与宿主自定义配色，
///      比我们自己猜任何一个资源键都可靠。
///   ② **需要"比正文淡一点"时用 `Opacity`，不要用半透明白**：`Opacity` 是对继承到的颜色做乘法，
///      深浅主题下都保持正确对比；而 `#C8FFFFFF` 这种半透明白在浅色主题下等于不可见。
///
/// 只有"必须有底色/边框"的容器（卡片、状态块）才需要本类提供画刷，因为 Avalonia 没有
/// 可继承的"卡片背景"这一说。这类画刷按当前主题分支取色，并监听主题切换实时刷新。
///
/// 注意：不要试图去猜 ClassIsland 的主题资源键（`{DynamicResource XXX}`）—— 实测宿主
/// 主程序集里没有可用的画刷键字符串，键名在编译后的 XAML 资源里，插件无从枚举；
/// 猜错的结果是画刷为 null，控件退化成透明，比自适应取色更糟。
/// </summary>
internal static class StelarithTheme
{
    private static bool _hooked;
    private static readonly object HookLock = new();

    /// <summary>主题切换通知（页面订阅它以重新套用画刷）。</summary>
    public static event Action? Changed;

    /// <summary>当前是否为浅色主题。</summary>
    public static bool IsLight
    {
        get
        {
            try
            {
                return Application.Current?.ActualThemeVariant == ThemeVariant.Light;
            }
            catch
            {
                return false;
            }
        }
    }

    /// <summary>挂上主题切换监听（幂等；Application 尚未就绪时下次调用再试）。</summary>
    public static void EnsureHooked()
    {
        lock (HookLock)
        {
            if (_hooked) return;
            try
            {
                if (Application.Current is not { } app) return;
                app.ActualThemeVariantChanged += (_, _) =>
                {
                    try { Changed?.Invoke(); }
                    catch { /* 订阅方异常不影响主题切换 */ }
                };
                _hooked = true;
            }
            catch
            {
                // Application 未就绪：保持未挂载，下次再试
            }
        }
    }

    /// <summary>正文的次要层级透明度（"说明文字"用）。</summary>
    public const double SubtleOpacity = 0.72;

    /// <summary>正文的最弱层级透明度（"脚注/占位"用）。</summary>
    public const double FaintOpacity = 0.55;

    /// <summary>卡片/分区底色：浅色主题用极淡的黑，深色主题用极淡的白。</summary>
    public static IBrush CardBackground => IsLight
        ? new SolidColorBrush(Color.FromArgb(10, 0, 0, 0))
        : new SolidColorBrush(Color.FromArgb(24, 255, 255, 255));

    /// <summary>卡片/分区边框：比底色略重，保证在两种主题下都看得出边界。</summary>
    public static IBrush CardBorder => IsLight
        ? new SolidColorBrush(Color.FromArgb(38, 0, 0, 0))
        : new SolidColorBrush(Color.FromArgb(44, 255, 255, 255));

    /// <summary>分隔线（比卡片边框更轻）。</summary>
    public static IBrush Divider => IsLight
        ? new SolidColorBrush(Color.FromArgb(24, 0, 0, 0))
        : new SolidColorBrush(Color.FromArgb(28, 255, 255, 255));

    /// <summary>成功/在线语义色：浅色主题用深绿（对比度够），深色主题用亮绿。</summary>
    public static IBrush Success => IsLight
        ? new SolidColorBrush(Color.FromRgb(0x1B, 0x7F, 0x3B))
        : new SolidColorBrush(Color.FromRgb(0x4A, 0xDE, 0x80));

    /// <summary>失败/离线语义色：浅色主题用深红，深色主题用亮红。</summary>
    public static IBrush Danger => IsLight
        ? new SolidColorBrush(Color.FromRgb(0xB3, 0x2D, 0x2F))
        : new SolidColorBrush(Color.FromRgb(0xFF, 0x7B, 0x72));

    /// <summary>警示语义色（退避中、降级等中间态）。</summary>
    public static IBrush Warning => IsLight
        ? new SolidColorBrush(Color.FromRgb(0x9A, 0x62, 0x00))
        : new SolidColorBrush(Color.FromRgb(0xFF, 0xC1, 0x66));

    /// <summary>按布尔值取语义色（状态点/状态文本用）。</summary>
    public static IBrush ForState(bool ok) => ok ? Success : Danger;
}
