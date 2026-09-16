using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace StelarithControlPlugin;

/// <summary>
/// 本机 OS 级轻动作。需要网络/提权（启 VNC、控进程）的动作交给本地代理，本类只做最轻的本地调用。
/// </summary>
public static class OSActions
{
    [DllImport("user32.dll")]
    private static extern void LockWorkStationNative();

    /// <summary>锁屏（Windows 原生，无需提权）。</summary>
    public static void LockWorkStation() => LockWorkStationNative();

    /// <summary>截图保存到指定路径（供报修/审计留证）。</summary>
    public static void CaptureScreen(string path)
    {
        try
        {
            var bounds = Screen.PrimaryScreen?.Bounds ?? new Rectangle(0, 0, 1920, 1080);
            using var bmp = new Bitmap(bounds.Width, bounds.Height);
            using var g = Graphics.FromImage(bmp);
            g.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
            bmp.Save(path, ImageFormat.Png);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[Stelarith] 截图失败: {ex.Message}");
        }
    }
}
