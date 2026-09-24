/// 星集控 · 本机被控（DeviceAgent）纯逻辑测试
///
/// 这里只测**不碰真机**的部分：
///   * `stelarith_task` 的解析（面板下发的形态最容易踩坑）
///   * 配置门槛（什么情况下该禁用开关、该说什么话）
///   * 演练模式必须拦住会改变本机的动作
///
/// ⚠️ 绝不在这里调用会真执行的 run()（关机/重启/截屏/改音量）——
/// 跑一次测试就把开发机音量改掉、甚至关掉，是不可接受的。
library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:xingjikong/core/device_agent.dart';
import 'package:xingjikong/core/log.dart';
import 'package:xingjikong/core/settings.dart';

DeviceAgent _agent(Settings s, {bool dryRun = true}) =>
    DeviceAgent(readSettings: () => s, dryRun: dryRun);

/// 数请求次数的桩客户端：用来断言「配置不全时一个请求都不发」。
class _CountingClient extends http.BaseClient {
  int calls = 0;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    calls++;
    return http.StreamedResponse(const Stream<List<int>>.empty(), 200);
  }
}

void main() {
  LogStore.muteConsole = true;

  group('stelarith_task 解析', () {
    test('面板下发形态：stelarith_task 被塞在 MessageContent 字符串里', () {
      // 这是网站/面板真实发出的形态：payload 是一层 JSON，
      // MessageContent 又是一层**字符串化的** JSON。
      final payload = jsonEncode({
        'MessageContent': jsonEncode({
          'stelarith_task': {'action': 'shutdown', 'scope': 'device'}
        })
      });
      final r = DeviceAgent.extract('SendNotification', payload);
      expect(r.hasTask, isTrue);
      expect(r.task!.action, 'shutdown');
      expect(r.task!.scope, 'device');
    });

    test('stelarith_task 直接在 payload 顶层', () {
      final r = DeviceAgent.extract(
          'stelarith_task', jsonEncode({'stelarith_task': {'action': 'reboot'}}));
      expect(r.task?.action, 'reboot');
    });

    test('带参数的指令：set_volume 的 value / muted 要原样带到', () {
      final payload = jsonEncode({
        'MessageContent': jsonEncode({
          'stelarith_task': {
            'action': 'set_volume',
            'params': {'value': 42, 'muted': true}
          }
        })
      });
      final t = DeviceAgent.extract('SendNotification', payload).task!;
      expect(t.action, 'set_volume');
      expect(t.params['value'], 42);
      expect(t.params['muted'], isTrue);
    });

    test('缺 action 不算任务（不能凭空造一个动作出来）', () {
      final r = DeviceAgent.extract(
          'SendNotification', jsonEncode({'stelarith_task': {'scope': 'x'}}));
      expect(r.hasTask, isFalse);
    });

    test('纯通知：解析不出任务时要把正文留下（面板「发通知」走这条）', () {
      final r = DeviceAgent.extract(
          'SendNotification', jsonEncode({'MessageContent': '下午三点开会'}));
      expect(r.hasTask, isFalse);
      expect(r.notice, '下午三点开会');
    });

    // 回归：曾经只找 content 系字段，而官方信封里标题在 MessageMask、
    // MessageContent 经常是空串 → 取不到就退回 payload 原文，桌面弹窗里
    // 显示的是一坨 JSON（老师看到的就是 `{"MessageMask":"打扫卫生",...}`）。
    test('官方 SendNotification 信封：MessageMask 是标题，不许把 JSON 弹给老师', () {
      final r = DeviceAgent.extract(
        'SendNotification',
        jsonEncode({'MessageMask': '打扫卫生', 'MessageContent': ''}),
      );
      expect(r.hasTask, isFalse);
      expect(r.notice, '打扫卫生');
      expect(r.notice.contains('{'), isFalse);
    });

    test('标题 + 正文都在 → 拼成两行（标题在前，供弹窗分开渲染）', () {
      final r = DeviceAgent.extract(
        'SendNotification',
        jsonEncode({'MessageMask': '临时通知', 'MessageContent': '下午大扫除'}),
      );
      expect(r.notice, '临时通知\n下午大扫除');
    });

    test('MessageMask 在嵌套的信封里也能挖出来', () {
      final inner = jsonEncode({'MessageMask': '集合通知', 'MessageContent': '操场集合'});
      final r = DeviceAgent.extract(
          'SendNotification', jsonEncode({'SomeEnvelope': inner, 'type': 'notice'}));
      expect(r.notice, '集合通知\n操场集合');
    });

    test('脏数据不抛异常，原串当正文兜底', () {
      expect(DeviceAgent.extract('Ping', 'not json at all').hasTask, isFalse);
      expect(DeviceAgent.extract('Ping', 'not json at all').notice,
          'not json at all');
      expect(DeviceAgent.extract('Ping', '').notice, '');
      expect(DeviceAgent.extract('Ping', '[1,2,3]').hasTask, isFalse);
    });

    test('深层嵌套也能挖出来（payload 是数组）', () {
      final payload =
          jsonEncode([jsonEncode({'stelarith_task': {'action': 'lock'}})]);
      expect(DeviceAgent.extract('DataUpdated', payload).task?.action, 'lock');
    });

    test('params 不是对象时不崩，退回空表', () {
      final payload = jsonEncode({
        'stelarith_task': {'action': 'screenshot', 'params': 'oops'}
      });
      final t = DeviceAgent.extract('SendNotification', payload).task!;
      expect(t.action, 'screenshot');
      expect(t.params, isEmpty);
    });
  });

  group('演练模式', () {
    test('会改变本机的动作一律拦下（绝不真的执行）', () async {
      final a = _agent(const Settings());
      for (final action in DeviceAgent.dangerousActions) {
        final r = await a.run(StelarithTask(action: action));
        expect(r.ok, isFalse, reason: '$action 在演练模式下不该被执行');
        expect(r.detail, contains('演练'));
      }
    });

    test('ping 是纯观测，演练模式下也照常成功', () async {
      final a = _agent(const Settings());
      expect((await a.run(const StelarithTask(action: 'ping'))).ok, isTrue);
    });

    test('不认识的动作用「失败 + 看得懂的原因」回应，不许假成功', () async {
      final a = _agent(const Settings());
      final r = await a.run(const StelarithTask(action: 'teleport'));
      expect(r.ok, isFalse);
      expect(r.detail, contains('teleport'));
    });
  });

  group('配置门槛（agentBlocker）', () {
    const base = Settings(
      authMode: 'website',
      siteHost: 'https://www.example.com',
      token: 'tok',
      deviceUid: 'pc-01',
    );

    test('演示模式：不与真实教室发生关系', () {
      expect(base.copyWith(demo: true).agentBlocker, contains('演示模式'));
    });

    test('直连 CIMS 模式：没有网站地址，链路走不通，必须说清', () {
      expect(base.copyWith(authMode: 'cims').agentBlocker, contains('网站账号登录'));
    });

    test('网址为空 / 未登录 / 设备名为空，各自有对应的提示', () {
      expect(base.copyWith(siteHost: '').agentBlocker, contains('网站地址'));
      expect(base.copyWith(token: '').agentBlocker, contains('未登录'));
      expect(base.copyWith(deviceUid: '').agentBlocker, contains('设备名'));
    });

    test('配齐了就不拦（null）', () {
      expect(base.agentBlocker, isNull);
    });
  });

  group('运行期门槛', () {
    test('未开启被控时，blockedReason 不报错（只是不工作）', () {
      final a = _agent(const Settings());
      expect(a.blockedReason, isNull);
      expect(a.snapshot.enabled, isFalse);
    });

    test('开启但配置不全：给人话，且一个请求都不发', () async {
      final client = _CountingClient();
      final a = DeviceAgent(
        readSettings: () => const Settings(agentEnabled: true),
        client: client,
        dryRun: true,
      );
      a.sync();
      expect(a.blockedReason, contains('网站账号登录'));

      // 放一拍，让"立即轮询"那次 Timer 真的跑起来
      await Future<void>.delayed(const Duration(milliseconds: 200));
      expect(client.calls, 0,
          reason: '配置不全时不该往一个不可用的地址发请求 —— '
              '高频 4xx 会触发 CIMS 的 CCProtect 把本机 IP 封 60s');
      expect(a.snapshot.phase, contains('网站账号登录'));
      a.stop();
    });

    test('登录态齐了才会真的开始轮询', () async {
      final client = _CountingClient();
      final a = DeviceAgent(
        readSettings: () => const Settings(
          agentEnabled: true,
          authMode: 'website',
          siteHost: 'https://example.com',
          token: 'tok',
          deviceUid: 'pc-01',
        ),
        client: client,
        dryRun: true,
      );
      a.sync();
      await Future<void>.delayed(const Duration(milliseconds: 200));
      expect(client.calls, greaterThan(0), reason: '配置齐了就该去取指令');
      a.stop();
    });
  });

  group('默认设备名', () {
    test('永远拿得到一个非空名字（空设备名会拼出 /client//status 畸形路径）', () {
      expect(SettingsNotifier.defaultDeviceUid().trim(), isNotEmpty);
    });
  });
}
