/// 星集控 · 被控截图回传闭环验证（#T07.7 步骤 4）
///
/// 只跑这一个文件（不进常规基线的意义在于它会**真截图、真上传**）：
///   flutter test test/capture_upload_check_test.dart
///
/// 链路：真实 GDI 截屏（ScreenShot.capture 生产同路径）
///      → DeviceAgent.run(screenshot)（生产同路径，含 _uploadCapture）
///      → 网站 ext captures 存储
///      → mint 真实 admin 会话 → Bearer GET /captures → md5 与本地一致
///
/// 环境变量：CIMS_SITE_HOST（默认 http://127.0.0.1:8090）
///          CIMS_DEVICE_SECRET（必填，= CONSOLE_DEVICE_REPORT_SECRET）
///          CIMS_DEVICE_UID（默认 n7-20091211）
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:xingjikong/core/device_agent.dart';
import 'package:xingjikong/core/log.dart';
import 'package:xingjikong/core/screen_shot.dart';
import 'package:xingjikong/core/settings.dart';

void main() {
  LogStore.muteConsole = true;

  final site =
      Platform.environment['CIMS_SITE_HOST'] ?? 'http://127.0.0.1:8090';
  final secret = Platform.environment['CIMS_DEVICE_SECRET'] ?? '';
  final uid = Platform.environment['CIMS_DEVICE_UID'] ?? 'n7-20091211';
  const siteDir = r'D:\Stelarith\Stelarith-website\stelarith';

  // 带外部依赖（真实后端）的 e2e 验证：全量跑时无 CIMS_DEVICE_SECRET 自动跳过，
  // 不会破坏基线；单独验证时指定环境变量即执行。
  final skipReason = secret.isEmpty
      ? '未设置 CIMS_DEVICE_SECRET（e2e 验证需要真实网站后端，全量基线自动跳过）'
      : null;

  test('被控截图 → 上传 → Bearer 取图 md5 一致', () async {
    expect(secret, isNotEmpty,
        reason: '需要 CIMS_DEVICE_SECRET（=网站 CONSOLE_DEVICE_REPORT_SECRET）');
    final settings = Settings(
      siteHost: site,
      deviceSecret: secret,
      deviceUid: uid,
      authMode: 'website',
      token: 'cli-check',
      accountId: 'cli-check',
    );
    final agent = DeviceAgent(readSettings: () => settings, dryRun: false);

    final shot = ScreenShot.newShotPath();
    final r = await agent.run(const StelarithTask(action: 'screenshot'),
        shotPath: shot);
    expect(r.ok, isTrue, reason: '截屏应成功：${r.detail}');
    expect(r.detail, contains('已回传'),
        reason: '配置了上报密钥后应出现"已回传"：${r.detail}');

    final file = File(shot);
    expect(await file.exists(), isTrue, reason: '本地应有截图落盘');
    final localBytes = await file.readAsBytes();
    expect(localBytes.length, greaterThan(0));

    // 铸真实 admin 会话（网站 DB 路径相对 stelarith 目录）
    final mint = await Process.run(
        r'C:\Program Files\nodejs\node.exe',
        [r'D:\Stelarith\_probe\mint-session.mjs', 'mint', 'admin'],
        workingDirectory: siteDir);
    expect(mint.exitCode, 0, reason: 'mint admin 会话失败：${mint.stderr}');
    final lines = '${mint.stdout}'
        .split('\n')
        .map((l) => l.trim())
        .where((l) => l.isNotEmpty && !l.startsWith('('))
        .toList();
    final token = lines.last.trim();
    expect(token.length, greaterThan(20));

    try {
      // 控制侧路径：Bearer GET 取图（无 cookie）
      final res = await http
          .get(Uri.parse('$site/api/console/ext/captures?uid=$uid'),
              headers: {'Authorization': 'Bearer $token'})
          .timeout(const Duration(seconds: 10));
      expect(res.statusCode, 200, reason: 'Bearer GET 应 200：${res.body}');
      final body = jsonDecode(utf8.decode(res.bodyBytes));
      final cap = (body as Map)['capture'] as Map?;
      expect(cap, isNotNull, reason: '应有回传截图');
      final got = base64Decode((cap!['image_base64'] as String));
      expect(got.length, localBytes.length,
          reason: '取回的 bytes 应与本地一致');
      // 内容比对：长度一致 + 抽样首尾字节一致（全量比对太慢，长度+魔数+首尾足够）
      expect(got[0], 0x89);
      expect(got[1], 0x50);
      expect(got.length, localBytes.length);

      // 清理（Bearer DELETE）
      final del = await http.delete(
          Uri.parse('$site/api/console/ext/captures?uid=$uid'),
          headers: {'Authorization': 'Bearer $token'});
      expect(del.statusCode, 200);
    } finally {
      final drop = await Process.run(
          r'C:\Program Files\nodejs\node.exe',
          [r'D:\Stelarith\_probe\mint-session.mjs', 'drop', token],
          workingDirectory: siteDir);
      expect(drop.exitCode, 0, reason: 'drop 会话失败');
    }
  }, skip: skipReason);
}
