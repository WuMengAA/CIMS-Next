using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;

namespace StelarithControlPlugin;

/// <summary>
/// 星璃·集控「语音朗读」（教室大屏 TTS）。
///
/// 为什么需要它：教室大屏的遮罩播报在**投影距离**外看不见——一条「下午第三节课
/// 改到多功能厅」贴在屏幕角落，后排学生根本不会抬头。语音把通知从「看」变成「听」。
///
/// 为什么用 PowerShell + SAPI 而不是引 NuGet 语音包：插件的依赖面要尽量小
/// （只编译期引用宿主已加载的 Avalonia 程序集），Windows 自带 SAPI，
/// 用 PowerShell 调即可，零新增程序集。
///
/// ⚠️ 三个 Windows 的坑（与桌面端 tts.dart 同款，见其注释）：
///   ① 中文**必须走 SSML + xml:lang="zh-CN"**，否则 SAPI 会用英文语音念中文；
///   ② 中文文本**绝不拼进 .ps1 脚本体**（PS5.1 按 ANSI 解释会变问号），
///      一律写进 UTF-8 文件、脚本用 [IO.File]::ReadAllText(..., UTF8) 读；
///   ③ 朗读进程必须设超时，失败绝不影响主流程（朗读是锦上添花）。
/// </summary>
public static class StelarithTts
{
    /// <summary>朗读脚本正文。**保持纯 ASCII**：所有可变内容都从文件读，不进脚本体。</summary>
    private const string SpeakScript = @"
$text = [System.IO.File]::ReadAllText($args[0], [System.Text.Encoding]::UTF8)
$voice = New-Object -ComObject SAPI.SpVoice
try {
  $tokens = $voice.GetVoices()
  for ($i = 0; $i -lt $tokens.Count; $i++) {
    $t = $tokens.Item($i)
    if ($t.GetDescription() -match 'zh|CN|Chinese|Microsoft Hui|Yaoyao|Kangkang') {
      $voice.Voice = $t
      break
    }
  }
} catch { }
$ssml = ""<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>"" + $text + ""</speak>""
$voice.Speak($ssml, 0) | Out-Null
Write-Output 'OK'
";

    /// <summary>文本里最多朗读的长度（防止一条超长通知把课堂念十分钟）。</summary>
    private const int MaxChars = 400;

    private static readonly object Gate = new();
    private static DateTimeOffset _lastAt = DateTimeOffset.MinValue;

    /// <summary>
    /// 朗读一段中文文本（后台执行，不阻塞调用方）。
    /// 相同文本 3 秒内不重复朗读（防刷屏）；空文本 / 非 Windows 直接忽略。
    /// </summary>
    public static void Speak(string? text, string logTag = "ste-tts")
    {
        var body = (text ?? "").Trim();
        if (body.Length == 0) return;
        if (body.Length > MaxChars) body = body.Substring(0, MaxChars);

        lock (Gate)
        {
            if (DateTimeOffset.Now - _lastAt < TimeSpan.FromSeconds(3))
            {
                Diag("tts skip: 3s 内已朗读过");
                return;
            }
            _lastAt = DateTimeOffset.Now;
        }

        // 后台线程执行：不占用命令处理线程，朗读卡住也不影响指令循环。
        Task.Run(() => SpeakSync(body, logTag));
    }

    private static void SpeakSync(string safeText, string logTag)
    {
        FileInfo? cfg = null;
        FileInfo? ps = null;
        try
        {
            var dir = Path.Combine(Path.GetTempPath(), "stelarith-tts");
            Directory.CreateDirectory(dir);
            var stamp = DateTime.Now.Ticks;
            cfg = new FileInfo(Path.Combine(dir, $"tts-{stamp}.txt"));
            // 不带 BOM：SAPI 侧按明确 UTF8 解码，加 BOM 反而会在首字插一个不可见符。
            File.WriteAllText(cfg.FullName, safeText, new UTF8Encoding(false));
            ps = new FileInfo(Path.Combine(dir, $"tts-{stamp}.ps1"));
            File.WriteAllText(ps.FullName, SpeakScript, new UTF8Encoding(false));

            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{ps.FullName}\" \"{cfg.FullName}\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            using var proc = Process.Start(psi);
            if (proc is null)
            {
                Diag("tts: powershell 未启动");
                return;
            }
            var outTask = proc.StandardOutput.ReadToEndAsync();
            var errTask = proc.StandardError.ReadToEndAsync();
            if (!proc.WaitForExit(60000))
            {
                try { proc.Kill(); } catch { }
                Diag("tts: 朗读超时已终止");
                return;
            }
            var stdout = outTask.GetAwaiter().GetResult() ?? "";
            var stderr = errTask.GetAwaiter().GetResult() ?? "";
            if (proc.ExitCode != 0 || !stdout.Contains("OK"))
            {
                var why = string.IsNullOrWhiteSpace(stdout) ? stderr : stdout;
                Diag($"tts fail: {(string.IsNullOrWhiteSpace(why) ? "退出码 " + proc.ExitCode : why)}");
                return;
            }
            Diag("tts ok: " + Truncate(safeText, 60));
        }
        catch (Exception ex)
        {
            Diag("tts exception: " + ex.Message);
        }
        finally
        {
            try { if (cfg is not null && cfg.Exists) cfg.Delete(); } catch { }
            try { if (ps is not null && ps.Exists) ps.Delete(); } catch { }
        }
    }

    private static string Truncate(string s, int n)
        => s.Length <= n ? s : s.Substring(0, n) + "…";

    internal static void Diag(string msg)
    {
        try { StelarithLog.Write("ste-tts-diag.log", msg); }
        catch { /* 忽略 */ }
    }
}
