/// 星集控 · API 层单元测试（HTTP 全打桩，不依赖真实后端）
///
/// 覆盖重点是最容易静默出错的地方：
///   * 登录后 token / accountId 是否真的持久化（丢了就是满屏畸形 /account// 路径）
///   * 无账户上下文时是否 fail-silent 地降级（而不是发出畸形请求）
///   * stelarith_task 载荷与 HMAC 签名是否按 action+ts 绑定
///   * 401 是否清除登录态
///   * 自检步骤是否给出可定位的失败原因
library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'package:xingjikong/core/api_client.dart';
import 'package:xingjikong/core/log.dart';
import 'package:xingjikong/core/settings.dart';

class _Route {
  final int status;
  final String body;
  const _Route(this.status, this.body);
}

/// 按「METHOD /path」路由的打桩 client，并记录所有见过的请求
class _MockClient extends http.BaseClient {
  final Map<String, _Route> routes;
  final List<http.Request> seen = [];
  final List<String> keys = [];
  final List<int> statuses = [];

  _MockClient(this.routes);

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final req = request as http.Request;
    seen.add(req);
    final key = '${req.method} ${req.url.path}';
    keys.add(key);
    final route = routes[key];
    if (route == null) {
      statuses.add(404);
      return http.StreamedResponse(
          Stream<List<int>>.value(utf8.encode('{"error":"no route: $key"}')), 404);
    }
    statuses.add(route.status);
    return http.StreamedResponse(
      Stream<List<int>>.value(utf8.encode(route.body)),
      route.status,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );
  }

  http.Request? lastWhere(String method, Pattern path) {
    for (final r in seen.reversed) {
      if (r.method == method && r.url.path.contains(path)) return r;
    }
    return null;
  }
}

Future<SettingsNotifier> _settings([Settings? initial]) async {
  SharedPreferences.setMockInitialValues(<String, Object>{});
  final n = SettingsNotifier();
  await n.load();
  if (initial != null) {
    if (initial.mgmtHost.isNotEmpty) n.setMgmtHost(initial.mgmtHost);
    if (initial.token.isNotEmpty) n.setToken(initial.token);
    if (initial.accountId.isNotEmpty) n.setAccountId(initial.accountId);
    if (initial.taskSecret.isNotEmpty) n.setTaskSecret(initial.taskSecret);
    if (initial.demo) n.setDemo(true);
  }
  return n;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  LogStore.muteConsole = true; // 断言里会打印，避免刷屏

  group('登录与账户上下文', () {
    test('登录成功：token 与 accountId 都落盘', () async {
      final client = _MockClient({
        'POST /user/auth': const _Route(200, '{"token":"tok-abc"}'),
        'GET /account/list': const _Route(200, '[{"id":"acc-1"},{"id":"acc-2"}]'),
      });
      final s = await _settings();
      final api = CimsApi(s, client: client);

      await api.login('http://127.0.0.1:8097', 'a@b.c', 'pw');

      expect(s.current.token, 'tok-abc');
      expect(s.current.accountId, 'acc-1', reason: '必须自动选首个账户，否则后续调用全是 /account//');
      expect(s.current.canUseBackend, isTrue);
    });

    test('密码不进日志（请求体脱敏）', () async {
      final client = _MockClient({
        'POST /user/auth': const _Route(200, '{"token":"t"}'),
        'GET /account/list': const _Route(200, '[]'),
      });
      final s = await _settings();
      final api = CimsApi(s, client: client);
      await api.login('http://127.0.0.1:8097', 'a@b.c', 'super-secret');

      final req = client.seen.firstWhere((r) => r.url.path == '/user/auth');
      final logged = CimsApi.safeBody('/user/auth', jsonDecode(req.body));
      expect(logged.contains('super-secret'), isFalse);
      expect(logged.contains('***'), isTrue);
    });

    test('2FA 账户明确报错，不静默登录', () async {
      final client = _MockClient({
        'POST /user/auth': const _Route(200, '{"requires_2fa":true}'),
      });
      final s = await _settings();
      final api = CimsApi(s, client: client);
      await expectLater(
        api.login('http://127.0.0.1:8097', 'a@b.c', 'pw'),
        throwsA(isA<ApiException>()),
      );
      expect(s.current.token, isEmpty);
    });

    test('/account/list 为空时给出可定位的告警（不建立账户上下文）', () async {
      final client = _MockClient({
        'POST /user/auth': const _Route(200, '{"token":"t"}'),
        'GET /account/list': const _Route(200, '[]'),
      });
      final s = await _settings();
      final api = CimsApi(s, client: client);
      await api.login('http://127.0.0.1:8097', 'a@b.c', 'pw');

      expect(s.current.accountId, isEmpty);
      expect(s.current.canUseBackend, isFalse);
    });
  });

  group('失败降级', () {
    test('无账户上下文：不发出任何 /account/ 请求，返回空列表', () async {
      final client = _MockClient({});
      final s = await _settings(const Settings(mgmtHost: 'http://127.0.0.1:8097', token: 't'));
      final api = CimsApi(s, client: client);

      final devices = await api.listDevices();

      expect(devices, isEmpty);
      expect(client.seen, isEmpty, reason: '缺 accountId 时发出 /account//xxx 是畸形请求，必须提前挡掉');
    });

    test('演示模式：不下发真实请求，返回模拟结果', () async {
      final client = _MockClient({});
      final s = await _settings(const Settings(demo: true));
      final api = CimsApi(s, client: client);

      final r = await api.deviceAction('uid-1', 'lock');
      expect(client.seen, isEmpty);
      expect(r['status'], isNotNull);
    });

    test('401：清除登录态并抛异常', () async {
      final client = _MockClient({
        'GET /account/acc-1/client/list': const _Route(401, '{"error":"unauthorized"}'),
      });
      final s = await _settings(const Settings(
          mgmtHost: 'http://h', token: 'tok', accountId: 'acc-1'));
      final api = CimsApi(s, client: client);

      // 注意：不要用 expectLater(() => api.listDevices(), returnsNormally) ——
      // 它不等待异步闭包完成，断言会在 401 处理之前执行，得到假阴性。
      final devices = await api.listDevices();
      expect(devices, isEmpty, reason: '401 后端下不应返回设备');
      expect(s.current.token, isEmpty,
          reason: '401 必须清 token，否则界面一直显示假在线；'
              '实际 token=[${s.current.token}] accountId=[${s.current.accountId}]');
      expect(s.current.accountId, isEmpty);
    });
  });

  group('设备列表', () {
    test('列表 + 详情拼接，状态归一化', () async {
      final client = _MockClient({
        'GET /account/acc-1/client/list': const _Route(200, '["d1","d2"]'),
        'GET /account/acc-1/client/d1':
            const _Route(200, '{"name":"PC-01","status":"online","mac":"AA:BB"}'),
        'GET /account/acc-1/client/d2':
            const _Route(200, '{"name":"PC-02","status":"offline"}'),
      });
      final s = await _settings(const Settings(
          mgmtHost: 'http://h', token: 'tok', accountId: 'acc-1'));
      final api = CimsApi(s, client: client);

      final devices = await api.listDevices();

      expect(devices.length, 2);
      expect(devices.first.uid, 'd1');
      expect(devices.first.name, 'PC-01');
      expect(devices.first.online, isTrue);
      expect(devices.first.ip, 'AA:BB');
      expect(devices.last.online, isFalse);
    });

    test('单台设备详情失败：降级为离线条目，不影响其它设备', () async {
      final client = _MockClient({
        'GET /account/acc-1/client/list': const _Route(200, '["d1","d2"]'),
        // d1 无路由 → 404
        'GET /account/acc-1/client/d2': const _Route(200, '{"name":"PC-02"}'),
      });
      final s = await _settings(const Settings(
          mgmtHost: 'http://h', token: 'tok', accountId: 'acc-1'));
      final api = CimsApi(s, client: client);

      final devices = await api.listDevices();
      expect(devices.length, 2);
      expect(devices.first.online, isFalse);
      expect(devices.last.name, 'PC-02');
    });
  });

  group('stelarith_task 任务链路', () {
    test('载荷含 action/token/ts/scope，签名绑定 action+ts', () async {
      final client = _MockClient({
        'POST /account/acc-1/client/d1/command/send-notification':
            const _Route(200, '{"status":"success"}'),
      });
      final s = await _settings(const Settings(
          mgmtHost: 'http://h',
          token: 'tok',
          accountId: 'acc-1',
          taskSecret: 'my-secret'));
      final api = CimsApi(s, client: client);

      await api.sendTask('d1', 'lock');

      final req = client.seen.single;
      final body = jsonDecode(req.body) as Map<String, dynamic>;
      final task =
          jsonDecode(body['MessageContent'] as String)['stelarith_task']
              as Map<String, dynamic>;

      expect(task['action'], 'lock');
      expect(task['scope'], 'device');
      expect(task['ts'], isA<int>());
      expect((task['token'] as String).length, 64, reason: 'HMAC-SHA256 hex 应为 64 字符');

      // 同 ts 换 action → 签名必须不同（防重放/防篡改）
      final ts = task['ts'] as int;
      final t1 = await api.signTask('lock', ts);
      final t2 = await api.signTask('screenshot', ts);
      expect(t1, task['token']);
      expect(t1 == t2, isFalse);
    });

    test('未配置密钥：占位令牌且留告警（不静默假装成功）', () async {
      final s = await _settings(const Settings(
          mgmtHost: 'http://h', token: 'tok', accountId: 'acc-1'));
      final api = CimsApi(s, client: _MockClient({}));

      final token = await api.signTask('lock', 1700000000);
      expect(int.tryParse(token), isNotNull, reason: '无密钥时退化为时间戳占位');
      expect(token.length, isNot(64));
    });
  });

  group('自检 selfCheck', () {
    test('未配置管理端口：给出 actionable 的失败原因', () async {
      final s = await _settings();
      final api = CimsApi(s, client: _MockClient({}));
      final steps = await api.selfCheck();
      expect(steps.length, 1);
      expect(steps.first.ok, isFalse);
      expect(steps.first.detail, contains('8097'));
    });

    test('全链路通过', () async {
      final client = _MockClient({
        'GET /account/list': const _Route(200, '[{"id":"acc-1"}]'),
        'GET /account/acc-1/client/list': const _Route(200, '["d1"]'),
        'GET /account/acc-1/client/d1': const _Route(200, '{"name":"PC-01","status":"online"}'),
      });
      final s = await _settings(const Settings(
          mgmtHost: 'http://h', token: 'tok', accountId: 'acc-1'));
      final api = CimsApi(s, client: client);

      final steps = await api.selfCheck();
      expect(steps.every((e) => e.ok), isTrue);
      expect(steps.any((e) => e.name.contains('client/list')), isTrue);
    });

    test('缺账户上下文：明确报出而不是当作网络错误', () async {
      final client = _MockClient({
        'GET /account/list': const _Route(200, '[{"id":"acc-1"}]'),
      });
      final s = await _settings(const Settings(mgmtHost: 'http://h', token: 'tok'));
      final api = CimsApi(s, client: client);

      final steps = await api.selfCheck();
      expect(steps.last.ok, isFalse);
      expect(steps.last.detail, contains('accountId'));
    });
  });
}
