param([int]$Volume = -1, [int]$Muted = -1)

$src = @'
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr p);
  int UnregisterControlChangeNotify(IntPtr p);
  int GetChannelCount(out int pnChannelCount);
  int SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
  int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  int GetMasterVolumeLevel(out float pfLevelDB);
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int SetChannelVolumeLevel(uint nChannel, float fLevelDB, Guid pguidEventContext);
  int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, Guid pguidEventContext);
  int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
  int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
  int GetMute(out bool pbMute);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid id, int clsCtx, IntPtr act, [MarshalAs(UnmanagedType.IUnknown)] out object i);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int NotImpl1();
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject { }

public class Audio {
  static IAudioEndpointVolume Vol() {
    IMMDeviceEnumerator en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDevice dev;
    en.GetDefaultAudioEndpoint(0, 1, out dev);
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    object o;
    dev.Activate(ref iid, 23, IntPtr.Zero, out o);
    return (IAudioEndpointVolume)o;
  }
  public static float GetVolume() { float v; Vol().GetMasterVolumeLevelScalar(out v); return v; }
  public static bool GetMute() { bool m; Vol().GetMute(out m); return m; }
  public static void SetVolume(float level) { Vol().SetMasterVolumeLevelScalar(level, Guid.Empty); }
  public static void SetMute(bool mute) { Vol().SetMute(mute, Guid.Empty); }
}
'@

Add-Type -TypeDefinition $src -Language CSharp

$before = [Audio]::GetVolume()
$bMute = [Audio]::GetMute()
Write-Output ("BEFORE vol=" + [math]::Round($before * 100) + " mute=" + $bMute)

if ($Volume -ge 0) {
  [Audio]::SetVolume([float]($Volume / 100.0))
}
if ($Muted -ge 0) {
  [Audio]::SetMute([bool]($Muted -eq 1))
}

$after = [Audio]::GetVolume()
$aMute = [Audio]::GetMute()
Write-Output ("AFTER  vol=" + [math]::Round($after * 100) + " mute=" + $aMute)

if ($Volume -ge 0) { [Audio]::SetVolume($before) }
if ($Muted -ge 0 -and $Volume -lt 0) { [Audio]::SetMute($bMute) }
Write-Output ("RESTORED vol=" + [math]::Round(([Audio]::GetVolume()) * 100))
