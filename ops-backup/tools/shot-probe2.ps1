param([Parameter(Mandatory=$true)][string]$Out)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms

$src = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class Cap {
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hWnd);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr hDC);
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleBitmap(IntPtr hDC, int w, int h);
  [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr hDC, IntPtr hObj);
  [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr d, int dx, int dy, int w, int h, IntPtr s, int sx, int sy, int rop);
  [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr hDC);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr hObj);

  public static string Grab(int x, int y, int w, int h, string path) {
    IntPtr screen = GetDC(IntPtr.Zero);
    if (screen == IntPtr.Zero) return "ERR GetDC failed";
    IntPtr mem = CreateCompatibleDC(screen);
    if (mem == IntPtr.Zero) { ReleaseDC(IntPtr.Zero, screen); return "ERR CreateCompatibleDC failed"; }
    IntPtr bmp = CreateCompatibleBitmap(screen, w, h);
    if (bmp == IntPtr.Zero) { DeleteDC(mem); ReleaseDC(IntPtr.Zero, screen); return "ERR CreateCompatibleBitmap failed"; }
    IntPtr old = SelectObject(mem, bmp);
    bool ok = BitBlt(mem, 0, 0, w, h, screen, x, y, 0x00CC0020);
    SelectObject(mem, old);
    string res;
    if (!ok) { res = "ERR BitBlt failed err=" + Marshal.GetLastWin32Error(); }
    else {
      using (Image img = Image.FromHbitmap(bmp)) {
        img.Save(path, ImageFormat.Png);
        res = "OK " + path + " " + img.Width + "x" + img.Height;
      }
    }
    DeleteObject(bmp); DeleteDC(mem); ReleaseDC(IntPtr.Zero, screen);
    return res;
  }
}
'@

Add-Type -TypeDefinition $src -Language CSharp -ReferencedAssemblies System.Drawing

$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$dir = Split-Path -Parent $Out
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

$r = [Cap]::Grab([int]$b.Left, [int]$b.Top, [int]$b.Width, [int]$b.Height, $Out)
Write-Output $r
if ($r.StartsWith("OK")) {
  $fi = Get-Item $Out
  Write-Output ("BYTES " + $fi.Length)
}
