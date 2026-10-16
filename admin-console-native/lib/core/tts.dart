/// 本机语音朗读（TTS）
///
/// 为什么需要它：classisland 岛上的通知在**投影距离**外是看不见的，
/// 一条"下周三前交表"贴在屏幕角落，老师根本不会抬头。语音是把通知
/// 从"看"变成"听"——走廊上、正在讲台上也能收到。
///
/// 为什么不用任何 TTS 依赖包：整个工程只剩一个原生依赖量级（tray/window
/// manager/ffi），再加一个几 MB 的 TTS 包不值。Windows 自带 SAPI，
/// 用 PowerShell 调就行。
///
/// ⚠️ 两个 Windows 的坑：
///   ① 中文**必须走 SSML + xml:lang="zh-CN"**，否则 SAPI 会用英文语音
///      念"下周三"，中文整段读成乱码音节；
///   ② 中文文本**绝不拼进 .ps1 脚本体**（PS5.1 按 ANSI 解释会变问号），
///      一律写进 UTF-8 文件、脚本用 `[IO.File]::ReadAllText(..., UTF8)` 读。
library;

import 'dart:io';

import 'log.dart';

/// 朗读脚本正文。**保持纯 ASCII**：所有可变内容都从文件读，不进脚本体。
const String kSpeakScript = r'''
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
$ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>" + $text + "</speak>"
$voice.Speak($ssml, 0) | Out-Null
Write-Output 'OK'
''';

/// 本机朗读。返回空串 = 已开口；非空 = 人话失败原因。
///
/// 失败**不抛异常**：朗读是锦上添花，念不出来绝不能把弹窗也一起带崩 ——
/// 老师会看到通知消失、界面白屏，那比不朗读糟得多。
Future<String> speak(String text, {String logTag = 'tts'}) async {
  final body = text.trim();
  if (body.isEmpty) return '';
  if (!Platform.isWindows) return '非 Windows 无 TTS';
  final limit = 400;
  final safe = body.length <= limit ? body : body.substring(0, limit);

  File? cfg;
  File? ps;
  try {
    final dir = Directory.systemTemp;
    final stamp = DateTime.now().microsecondsSinceEpoch;
    cfg = File('${dir.path}${Platform.pathSeparator}xjk-tts-$stamp.txt');
    // 不带 BOM：SAPI 侧按明确 UTF8 解码，加 BOM 反而会在首字插一个不可见符。
    await cfg.writeAsString(safe, flush: true, encoding: const SystemEncoding());
    ps = File('${dir.path}${Platform.pathSeparator}xjk-tts-$stamp.ps1');
    await ps.writeAsString(kSpeakScript, flush: true, encoding: const SystemEncoding());
    ProcessResult r;
    try {
      // Process.run 没有 timeout 参数（Dart 移除过），超时要在 Future 上做
      r = await Process.run(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-WindowStyle',
          'Hidden',
          '-File',
          ps.path,
          cfg.path,
        ],
      ).timeout(const Duration(seconds: 60));
    } catch (e) {
      Log.w('语音朗读进程未起来：$e', logTag);
      return '$e';
    }
    final out = '${r.stdout}'.trim();
    final err = '${r.stderr}'.trim();
    if (r.exitCode != 0 || !out.contains('OK')) {
      final why = out.isEmpty ? err : out;
      Log.w('语音朗读失败：$why', logTag);
      return why.isEmpty ? '朗读未成功（退出码 ${r.exitCode}）' : why;
    }
    Log.i('已朗读：$safe', logTag);
    return '';
  } catch (e) {
    Log.w('语音朗读失败：$e', logTag);
    return '$e';
  } finally {
    try {
      if (cfg != null && await cfg.exists()) await cfg.delete();
    } catch (_) {}
    try {
      if (ps != null && await ps.exists()) await ps.delete();
    } catch (_) {}
  }
}
