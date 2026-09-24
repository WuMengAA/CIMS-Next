/// 星集控 · 远程控制会话回执双 key 闭环验证（#T07.7 步骤 5）
///
/// 只跑这一个文件（不进常规基线的意义在于它会**真上报、真查询**）：
///   flutter test test/remote_control_dual_key_test.dart
///
/// 链路（模拟「教室端代理 → 网关 → 控制侧轮询」的真实场景）：
///   ① 用设备密钥（CONSOLE_DEVICE_REPORT_SECRET）向网站 ext 网关 POST 一条
///      VNC 会话，uid 用小写主机名（模拟 agent 的 device_uid，如 n7-20091211）；
///   ② 用 [CimsApi.deviceRemoteStatus] 双 key 轮询：控制侧手头只有 CIMS 的
///      client_id（lab-pc-001）+ host（大写 N7-20091211），两个都不是上报键；
///     断言能命中（服务端 key 已小写归一化，host 双 key 兜底）；
///   ③ 清理会话 + drop 会话。
///
/// 环境变量：CIMS_SITE_HOST（默认 http://127.0.0.1:8090）
///          CIMS_DEVICE_SECRET（必填，= CONSOLE_DEVICE_REPORT_SECRET）
///          CIMS_DEVICE_UID（默认 n7-20091211）
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:xingjikong/core/api_client.dart';
import 'package:xingjikong/core/log.dart';
import 'package:xingjikong/core/settings.dart';

void main() {
  LogStore.muteConsole = true;

  final site =
      Platform.environment['CIMS_SITE_HOST'] ?? 'http://127.0.0.1:8090';
  final secret = Platform.environment['CIMS_DEVICE_SECRET'] ?? '';
  final uid = Platform.environment['CIMS_DEVICE_UID'] ?? 'n7-20091211';
  const siteDir = r'D:\Stelarith\Stelarith-website\stelarith';

  final skipReason = secret.isEmpty
      ? '未设置 CIMS_DEVICE_SECRET（e2e 验证需要真实网站后端，全量基线自动跳过）'
      : null;

  test('agent 上报 device_uid → 控制侧 client_id+host 双 key 命中', () async {
    expect(secret, isNotEmpty,
        reason: '需要 CIMS_DEVICE_SECRET（=网站 CONSOLE_DEVICE_REPORT_SECRET）');
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final settings = SettingsNotifier();
    await settings.load();
    settings
      ..setSiteHost(site)
      ..setDeviceSecret(secret)
      ..setDeviceUid(uid)
      ..setAuthMode('website')
      ..setToken('cli-check')
      ..setAccountId('cli-check');
    final api = CimsApi(settings);

    // ① 设备侧路径：用设备密钥 POST 一条 VNC 会话（uid=小写 device_uid）
    final reportedPort = 5942;
    final body = jsonEncode({
      'uid': uid,
      'ip': '192.168.1.55',
      'port': reportedPort,
      'token': 'st-5942-relay12',
      'proto': 'vnc',
      'state': 'up',
    });
    final post = await http
        .post(Uri.parse('$site/api/console/ext/vnc-session'),
            headers: {
              'Content-Type': 'application/json',
              'x-stelarith-device-secret': secret,
            },
            body: body)
        .timeout(const Duration(seconds: 10));
    expect(post.statusCode, 200, reason: '设备上报应 200：${post.body}');

    // ② 铸真实 admin 会话（控制侧 Bearer 路径需要有效会话；查询端无 cookie）
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
    settings.setToken(token);

    try {
      // ③ 控制侧路径：client_id 是 lab-pc-001（≠ 上报键），host 是**大写**的
      //    主机名 —— 两个都刻意与上报键不同，验证双 key + 归一化真正兜底。
      final sess = await api.deviceRemoteStatus('lab-pc-001',
          host: uid.toUpperCase());
      expect(sess, isNotNull, reason: '双 key 查询应命中（修复前恒为 null）');
      expect(sess!['ip'], '192.168.1.55');
      expect(sess['port'], reportedPort);
      expect(sess['token'], 'st-5942-relay12');

      // 只查 client_id（不带 host）→ 应 miss：证明双 key 是修复的核心，单 key 仍是旧症状。
      final miss = await api.deviceRemoteStatus('lab-pc-001');
      expect(miss, isNull, reason: '单 key（client_id）查不到 agent 上报键属预期');
    } finally {
      // ④ 清理：Bearer DELETE 会话 + drop 会话
      try {
        final del = await http.delete(
            Uri.parse('$site/api/console/ext/vnc-session?uid=$uid'),
            headers: {'Authorization': 'Bearer $token'});
        expect(del.statusCode, 200, reason: '清理会话应 200：${del.body}');
      } finally {
        final drop = await Process.run(
            r'C:\Program Files\nodejs\node.exe',
            [r'D:\Stelarith\_probe\mint-session.mjs', 'drop', token],
            workingDirectory: siteDir);
        expect(drop.exitCode, 0);
      }
    }
  }, skip: skipReason);
}
