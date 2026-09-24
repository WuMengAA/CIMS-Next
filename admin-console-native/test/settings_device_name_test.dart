// 星集控 · 设备改名回归测试（票 #246）
//
// 要守住的 bug：历史上「改设备名」直接改了绑定键 `deviceUid`，
// 而 CIMS 的设备身份 = client_id(uid)、首报即建档 —— 于是改名 = 用新 uid 上报
// = 后端新建一台设备，旧记录变孤儿。
//
// 方案 B 的契约：**改名只改展示名 `deviceName`，绑定键 `deviceUid` 永不变**。
// 这里锁死这条契约，防止以后有人又把改名接回 `setDeviceUid`。

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:xingjikong/core/settings.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  SettingsNotifier seeded(Map<String, Object> prefs) {
    SharedPreferences.setMockInitialValues(prefs);
    return SettingsNotifier();
  }

  test('首次启动：身份键自动固化，展示名默认等于身份键', () async {
    final n = seeded({});
    await n.load();

    final uid = n.current.deviceUid;
    expect(uid, isNotEmpty, reason: '首次启动必须自动生成一个稳定的身份键');
    expect(n.current.deviceName, uid,
        reason: '没改过名时，展示名应回落为身份键，不能为空');
  });

  test('改名只改展示名，绑定键 deviceUid 一动不动（#246 核心回归）', () async {
    final n = seeded({'cims_agent_uid': 'PC-ORIGINAL-UID'});
    await n.load();
    expect(n.current.deviceUid, 'PC-ORIGINAL-UID');

    n.setDeviceName('三年二班-讲台机');

    expect(n.current.deviceName, '三年二班-讲台机', reason: '展示名应更新');
    expect(n.current.deviceUid, 'PC-ORIGINAL-UID',
        reason: '绑定键绝不能被改名改动 —— 改了后端就按新 uid 建档，设备凭空消失');
  });

  test('改名持久化到 cims_device_name，不污染 cims_agent_uid', () async {
    final n = seeded({'cims_agent_uid': 'PC-ORIGINAL-UID'});
    await n.load();
    n.setDeviceName('三年二班-讲台机');

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('cims_device_name'), '三年二班-讲台机');
    expect(prefs.getString('cims_agent_uid'), 'PC-ORIGINAL-UID',
        reason: '身份键的持久化项不能被改名覆盖');
  });

  test('改名后重启应用：身份键仍是原来那台，展示名保留', () async {
    final first = seeded({'cims_agent_uid': 'PC-ORIGINAL-UID'});
    await first.load();
    first.setDeviceName('三年二班-讲台机');

    final prefs = await SharedPreferences.getInstance();
    final second = seeded({
      'cims_agent_uid': prefs.getString('cims_agent_uid') ?? '',
      'cims_device_name': prefs.getString('cims_device_name') ?? '',
    });
    await second.load();

    expect(second.current.deviceUid, 'PC-ORIGINAL-UID',
        reason: '重启后身份必须不变，否则等于换了一台设备');
    expect(second.current.deviceName, '三年二班-讲台机');
  });

  test('展示名清空时回落身份键，不会上报空名字', () async {
    final n = seeded({'cims_agent_uid': 'PC-ORIGINAL-UID'});
    await n.load();
    n.setDeviceName('临时名字');
    n.setDeviceName('   ');

    expect(n.current.deviceName, isEmpty);
    expect(n.current.deviceUid, 'PC-ORIGINAL-UID',
        reason: '展示名清空只是清空展示名，身份键依然稳固');
  });
}
