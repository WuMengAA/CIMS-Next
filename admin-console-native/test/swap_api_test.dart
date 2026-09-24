/// 星集控 · 自助切班接口验证（T07.8 棒 3 桌面端）
///
/// 走**网站代理**（桌面端 OAuth 登录后的生产路径）：`{site}/api/console/cims/*`
/// 复用网站 RBAC（admin 全档）。验证只读链路 + 参数校验，不创建任何申请：
///   ① listClassEntities() → 返回 ≥1 个班级（下拉数据源）
///   ② swapList() → 返回列表可解析（空列表也算通过）
///   ③ swapRequiresApproval() → 读审批开关（默认 false）
///   ④ swapCreate(from==to) → 期望 422「不能与自身互换」（服务端拒绝，零污染）
///
/// 环境变量：CIMS_SITE_HOST（默认 http://127.0.0.1:8090）
///          CIMS_SITE_TOKEN（必填 = mint-session 铸的 admin 会话；缺省自动跳过）
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:xingjikong/core/api_client.dart';
import 'package:xingjikong/core/log.dart';
import 'package:xingjikong/core/settings.dart';

void main() {
  LogStore.muteConsole = true;

  final site = Platform.environment['CIMS_SITE_HOST'] ?? 'http://127.0.0.1:8090';
  final token = Platform.environment['CIMS_SITE_TOKEN'] ?? '';

  final skipReason = token.isEmpty
      ? '未设置 CIMS_SITE_TOKEN（需要 mint-session 铸的 admin 会话，全量基线自动跳过）'
      : null;

  setUp(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
  });

  test('网站代理：班级目录 / 申请列表 / 审批开关 可读', () async {
    expect(token, isNotEmpty,
        reason: '需要 CIMS_SITE_TOKEN（= mint-session.mjs mint admin）');
    final s = SettingsNotifier();
    await s.load();
    s
      ..setSiteHost(site)
      ..setToken(token)
      ..setAccountId('tenant-demo-class')
      ..setAuthMode('website');
    final api = CimsApi(s);

    final classes = await api.listClassEntities();
    expect(classes, isNotEmpty, reason: '班级目录应至少 1 个（下拉数据源）');

    final items = await api.swapList();
    expect(items, isA<List<Map<String, dynamic>>>());

    final reqApproval = await api.swapRequiresApproval();
    expect(reqApproval, isA<bool>());
  }, skip: skipReason);

  test('swapCreate 非法参数（from==to）被服务端 422 拒绝，零污染', () async {
    expect(token, isNotEmpty,
        reason: '需要 CIMS_SITE_TOKEN（= mint-session.mjs mint admin）');
    final s = SettingsNotifier();
    await s.load();
    s
      ..setSiteHost(site)
      ..setToken(token)
      ..setAccountId('tenant-demo-class')
      ..setAuthMode('website');
    final api = CimsApi(s);

    final classes = await api.listClassEntities();
    expect(classes, isNotEmpty);
    final id = (classes.first['id'] ?? classes.first['class_id'] ?? '').toString();
    expect(id, isNotEmpty);

    await expectLater(
      api.swapCreate(fromClassId: id, toClassId: id, reason: 'T07.8棒3测试-不应落库'),
      throwsA(isA<ApiException>()),
      reason: 'from==to 应被服务端 422 拒绝，且不产生任何申请记录',
    );
  }, skip: skipReason);
}
