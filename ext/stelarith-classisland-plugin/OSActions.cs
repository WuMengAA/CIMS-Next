using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace StelarithControlPlugin;

/// <summary>
/// 本机 OS 级轻动作。需要网络/提权（启 VNC、控进程）的动作交给本地代理，本类只做最轻的本地调用。
///
/// 适配说明（ClassIsland 2.1.0.1 / net8.0）：
///   2.x 已迁到 Avalonia，不再可用 System.Windows.Forms，故屏幕尺寸改用 user32 GetSystemMetrics，
///   避免引入 WinForms 依赖。
/// </summary>
public static class OSActions
{
    [DllImport("user32.dll")]
    private static extern void LockWorkStationNative();

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int nIndex);

    private const int SM_CXSCREEN = 0;
    private const int SM_CYSCREEN = 1;

    /// <summary>锁屏（Windows 原生，无需提权）。</summary>
    public static void LockWorkStation() => LockWorkStationNative();

    /// <summary>截图保存到指定路径（供报修/审计留证）。</summary>
    public static void CaptureScreen(string path)
    {
        try
        {
            int w = GetSystemMetrics(SM_CXSCREEN);
            int h = GetSystemMetrics(SM_CYSCREEN);
            using var bmp = new Bitmap(w, h);
            using var g = Graphics.FromImage(bmp);
            g.CopyFromScreen(0, 0, 0, 0, new Size(w, h));
            bmp.Save(path, ImageFormat.Png);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[Stelarith] 截图失败: {ex.Message}");
        }
    }
}
