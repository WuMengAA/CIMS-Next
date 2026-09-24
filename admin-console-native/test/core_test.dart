/// 星集控 · 核心层单元测试（日志缓冲 / 设置持久化 / 模型归一化）
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:xingjikong/core/log.dart';
import 'package:xingjikong/core/api_client.dart';
import 'package:xingjikong/core/models.dart';
import 'package:xingjikong/core/probe.dart';
import 'package:xingjikong/core/settings.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    LogStore.instance.clear();
    LogStore.muteConsole = true; // 容量测试会打 800+ 条，静音避免淹没失败信息
  });

  group('LogStore', () {
    test('环形缓冲不超过容量', () {
      for (var i = 0; i < LogStore.capacity + 50; i++) {
        Log.i('message-$i');
      }
      expect(LogStore.instance.length, LogStore.capacity);
      // 保留的是最新的：最后一条在，被挤掉的第一条不在
      expect(LogStore.instance.value.last.message, 'message-${LogStore.capacity + 49}');
      expect(LogStore.instance.value.first.message, 'message-50');
    });

    test('监听器能收到变更（UI 刷新依赖它）', () {
      var hits = 0;
      void listener() => hits++;
      LogStore.instance.addListener(listener);
      Log.i('x');
      expect(hits, 1);
      LogStore.instance.removeListener(listener);
      Log.i('y');
      expect(hits, 1);
    });

    test('dump 含表头与条目，可导出到文件', () async {
      Log.i('第一条');
      Log.e('第二条');
      final text = LogStore.instance.dump();
      expect(text, contains('星集控运行日志'));
      expect(text, contains('第一条'));
      expect(text, contains('ERROR'));

      final file = File(
          '${Directory.systemTemp.path}${Platform.pathSeparator}xingjikong-log-test.log');
      if (file.existsSync()) file.deleteSync();
      final ok = await LogStore.instance.exportTo(file.path);
      expect(ok, isTrue);
      expect(file.readAsStringSync(), contains('第二条'));
      file.deleteSync();
    });
  });

  group('设置持久化', () {
    test('写后重开能读回（账户上下文不能丢）', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final a = SettingsNotifier();
      await a.load();
      a.setMgmtHost('http://127.0.0.1:8097/');
      a.setAccountId('acc-42');
      a.setTaskSecret('sec');

      final b = SettingsNotifier();
      await b.load();
      expect(b.current.accountId, 'acc-42');
      // 末尾斜杠要被吃掉，否则拼出 /account// 双斜杠
      expect(b.current.mgmtHost, 'http://127.0.0.1:8097');
      expect(b.current.taskSecret, 'sec');
    });

    test('canUseBackend 判定矩阵', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final n = SettingsNotifier();
      await n.load();

      expect(n.current.canUseBackend, isFalse, reason: '全空不可用');
      n.setMgmtHost('http://h');
      expect(n.current.canUseBackend, isFalse, reason: '缺账户');
      n.setAccountId('acc');
      expect(n.current.canUseBackend, isFalse, reason: '还缺 token（无 token 不能打真实后端）');
      n.setToken('tok');
      expect(n.current.canUseBackend, isTrue, reason: 'mgmtHost + accountId + token 齐备');
      n.setDemo(true);
      expect(n.current.canUseBackend, isFalse, reason: '演示模式下不得打真实后端');
    });

    test('clearAuth 同时清 token 与 accountId', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final n = SettingsNotifier();
      await n.load();
      n.setToken('tok');
      n.setAccountId('acc');
      n.clearAuth();
      expect(n.current.token, isEmpty);
      expect(n.current.accountId, isEmpty);

      final fresh = SettingsNotifier();
      await fresh.load();
      expect(fresh.current.token, isEmpty, reason: '清除必须落盘，否则重启后又是旧 token');
    });
  });

  group('模型归一化', () {
    test('CimsDevice：status / online 两种在线表达都能识别', () {
      expect(CimsDevice.fromJson({'status': 'online'}).online, isTrue);
      expect(CimsDevice.fromJson({'online': true}).online, isTrue);
      expect(CimsDevice.fromJson({'status': 'offline'}).online, isFalse);
      expect(CimsDevice.fromJson({}).online, isFalse);
    });

    test('CimsDevice：字段缺失有兜底', () {
      final d = CimsDevice.fromJson({'uid': 'u1'});
      expect(d.uid, 'u1');
      expect(d.name, '未命名设备',
          reason: '无 name 时给中性默认名 —— 刻意**不**回退成 uid，'
              '设备编号不该出现在老师面前');
      expect(d.ip, isEmpty);
      expect(d.classLabel, '未分班');
    });

    test('decodeList 对脏数据不抛异常', () {
      expect(decodeList(null), isEmpty);
      expect(decodeList(''), isEmpty);
      expect(decodeList('not json'), isEmpty);
      expect(decodeList('{"a":1}'), isEmpty, reason: '对象不是列表');
      expect(decodeList('[{"a":1}]').length, 1);
    });

    test('encodeList/decodeList 往返一致', () {
      final raw = encodeList([
        {'a': 1, 'b': 'x'},
      ]);
      expect(decodeList(raw).first['b'], 'x');
    });

    test('CheckStep 文本含结论与耗时', () {
      const ok = CheckStep(name: 'GET /account/list', ok: true, ms: 12, detail: '数组 2 项');
      expect(ok.toString(), contains('OK'));
      expect(ok.toString(), contains('12ms'));
    });
  });

  group('后端探活 probeHost', () {
    // 注意：TestWidgetsFlutterBinding 会拦截所有 HttpClient 并返回 400，
    // 因此本套件只能验证「不依赖真实网络」的纯逻辑分支；真实连行性由
    // tool 下的独立 dart run 脚本（不走测试绑定）验证。
    test('空地址立即返回 -1（不发请求）', () async {
      expect(await probeHost(''), -1);
    });

    test('CimsApi.probeHost 空地址与独立函数行为一致', () async {
      expect(await CimsApi.probeHost(''), -1);
    });
  });
}
