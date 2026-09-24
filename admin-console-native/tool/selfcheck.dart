// 星集控 · 后端契约自检（命令行，不依赖 GUI / 不依赖 Flutter）
//
// 用途：改完后端契约或插件后，一条命令验证「登录 → 账户 → 设备列表 → 设备详情 → 任务下发」
// 全链路是否还通；也用于现场排障（把输出贴给别人即可定位是哪一环断了）。
//
// 用法：
//   dart run tool/selfcheck.dart
//   dart run tool/selfcheck.dart --host http://127.0.0.1:8097 --email a@b.c --password pwd
//   dart run tool/selfcheck.dart --send-task lock --to <uid>
//   dart run tool/selfcheck.dart --json
//
// 环境变量（命令行未给参数时的兜底）：
//   CIMS_MGMT_URL / CIMS_ADMIN_EMAIL / CIMS_ADMIN_PASSWORD / CIMS_TASK_SECRET
//
// 退出码：0 = 全部通过；1 = 有步骤失败

import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;

Map<String, String> _parseArgs(List<String> argv) {
  final out = <String, String>{};
  for (var i = 0; i < argv.length; i++) {
    final a = argv[i];
    if (!a.startsWith('--')) continue;
    final key = a.substring(2);
    final eq = key.indexOf('=');
    if (eq > 0) {
      out[key.substring(0, eq)] = key.substring(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      out[key] = argv[i + 1];
      i++;
    } else {
      out[key] = 'true';
    }
  }
  return out;
}

String _clip(String s, [int n = 300]) =>
    s.length <= n ? s : '${s.substring(0, n)}…（共 ${s.length} 字符）';

class _Client {
  final http.Client _http = http.Client();
  final String host;
  String token;

  _Client(this.host, this.token);

  Future<dynamic> req(String path,
      {String method = 'GET', Object? body}) async {
    final uri = Uri.parse(host + path);
    final req = http.Request(method, uri);
    req.headers['Content-Type'] = 'application/json';
    if (token.isNotEmpty) req.headers['Authorization'] = 'Bearer $token';
    if (body != null) req.body = jsonEncode(body);
    final streamed =
        await _http.send(req).timeout(const Duration(seconds: 8));
    final res = await http.Response.fromStream(streamed)
        .timeout(const Duration(seconds: 8));
    if (res.statusCode >= 400) {
      throw HttpException('HTTP ${res.statusCode} ${_clip(res.body, 200)}',
          uri: uri);
    }
    if (res.bodyBytes.isEmpty) return <String, dynamic>{};
    return jsonDecode(utf8.decode(res.bodyBytes));
  }

  /// 探活：返回状态码（任何 HTTP 响应都说明服务在跑）
  Future<int> probe(Uri uri) async {
    final req = http.Request('GET', uri);
    final streamed =
        await _http.send(req).timeout(const Duration(seconds: 5));
    final res = await http.Response.fromStream(streamed)
        .timeout(const Duration(seconds: 5));
    return res.statusCode;
  }

  void close() => _http.close();
}

Future<Map<String, dynamic>> _step(
    String name, Future<dynamic> Function() fn) async {
  final sw = Stopwatch()..start();
  try {
    final r = await fn();
    sw.stop();
    final brief = r is List
        ? '数组 ${r.length} 项'
        : r is Map
            ? _clip(jsonEncode(r), 200)
            : _clip(r.toString(), 200);
    return {'name': name, 'ok': true, 'ms': sw.elapsedMilliseconds, 'detail': brief};
  } catch (e) {
    sw.stop();
    return {
      'name': name,
      'ok': false,
      'ms': sw.elapsedMilliseconds,
      'detail': e.toString(),
    };
  }
}

Future<void> main(List<String> argv) async {
  final args = _parseArgs(argv);
  final host = args['host'] ??
      Platform.environment['CIMS_MGMT_URL'] ??
      'http://127.0.0.1:8097';
  final email =
      args['email'] ?? Platform.environment['CIMS_ADMIN_EMAIL'] ?? '';
  final password =
      args['password'] ?? Platform.environment['CIMS_ADMIN_PASSWORD'] ?? '';
  final secret =
      args['secret'] ?? Platform.environment['CIMS_TASK_SECRET'] ?? '';
  final asJson = args.containsKey('json');
  final sendTask = args['send-task'];
  final target = args['to'];

  final steps = <Map<String, dynamic>>[];
  final api = _Client(host, '');

  // 0) 客户端端口(8096)探活：放在最前面，不依赖登录，
  //    用于区分「服务没起」与「403 是设计如此」
  final clientHost =
      args['client-host'] ?? Platform.environment['CIMS_CLIENT_URL'] ?? 'http://127.0.0.1:8096';
  steps.add(await _step('客户端端口探活 $clientHost', () async {
    final code = await api.probe(Uri.parse('$clientHost/'));
    final note = code == 403
        ? 'HTTP 403 —— 裸 IP 无租户 Host 头，属预期行为（租户识别靠 Host）'
        : code == 401
            ? 'HTTP 401 —— 服务在跑，但未授权'
            : 'HTTP $code';
    return {'status': code, 'note': note};
  }));

  // 1) 登录
  if (email.isNotEmpty && password.isNotEmpty) {
    final login = await _step('POST /user/auth', () async {
      final r = await api.req('/user/auth',
          method: 'POST', body: {'email': email, 'password': password});
      if (r is Map && r['requires_2fa'] == true) {
        throw const FormatException('后端要求 2FA，本脚本不支持');
      }
      api.token = (r is Map ? r['token']?.toString() : '') ?? '';
      if (api.token.isEmpty) throw const FormatException('响应中没有 token');
      return {'token': '${api.token.length} 字符'};
    });
    steps.add(login);
    if (login['ok'] != true) {
      _report(steps, asJson);
      return;
    }
  } else {
    steps.add({
      'name': 'POST /user/auth',
      'ok': false,
      'ms': 0,
      'detail': '未提供 --email/--password（或环境变量），跳过登录，后续以匿名身份探测',
    });
  }

  // 2) 账户列表
  String accountId = args['account'] ?? '';
  final acctStep = await _step('GET /account/list', () => api.req('/account/list'));
  steps.add(acctStep);
  if (acctStep['ok'] == true && accountId.isEmpty) {
    final r = await api.req('/account/list');
    if (r is List && r.isNotEmpty && r.first is Map) {
      accountId = (r.first as Map)['id']?.toString() ?? '';
    }
  }
  if (accountId.isEmpty) {
    steps.add({
      'name': '账户上下文',
      'ok': false,
      'ms': 0,
      'detail': '拿不到 accountId —— /account/{id}/... 全部不可用（常见于该账号无归属账户）',
    });
    _report(steps, asJson);
    return;
  }
  steps.add({
    'name': '账户上下文',
    'ok': true,
    'ms': 0,
    'detail': 'accountId = $accountId',
  });

  // 3) 设备列表
  final listStep = await _step(
      'GET /account/{id}/client/list',
      () => api.req('/account/$accountId/client/list'));
  steps.add(listStep);

  List<String> uids = const [];
  if (listStep['ok'] == true) {
    final r = await api.req('/account/$accountId/client/list');
    uids = (r as List).map((e) => e.toString()).toList();
  }

  // 4) 设备详情
  if (uids.isEmpty) {
    steps.add({
      'name': '设备详情',
      'ok': false,
      'ms': 0,
      'detail': '账户下没有注册设备（0 台）—— 设备需先上报心跳建档',
    });
  } else {
    steps.add(await _step('GET client/${uids.first} 详情',
        () => api.req('/account/$accountId/client/${uids.first}')));
  }

  // 5) 任务下发（可选）
  if (sendTask != null && sendTask.isNotEmpty) {
    final uid = target ?? (uids.isNotEmpty ? uids.first : '');
    if (uid.isEmpty) {
      steps.add({
        'name': '任务下发 $sendTask',
        'ok': false,
        'ms': 0,
        'detail': '未指定 --to 且账户下无设备',
      });
    } else {
      steps.add(await _step('下发 stelarith_task($sendTask) → $uid', () async {
        final ts = DateTime.now().millisecondsSinceEpoch ~/ 1000;
        final token = secret.isEmpty
            ? '${DateTime.now().millisecondsSinceEpoch}'
            : sha256
                .convert(Hmac(sha256, utf8.encode(secret))
                    .convert(utf8.encode('$sendTask|$ts'))
                    .bytes)
                .toString();
        final task = {
          'action': sendTask,
          'token': token,
          'scope': 'device',
          'ts': ts,
        };
        return api.req('/account/$accountId/client/$uid/command/send-notification',
            method: 'POST',
            body: {'MessageContent': jsonEncode({'stelarith_task': task})});
      }));
      if (secret.isEmpty) {
        steps.add({
          'name': '任务密钥',
          'ok': false,
          'ms': 0,
          'detail': '未配置 --secret/CIMS_TASK_SECRET：令牌为占位值，设备侧验签必然失败',
        });
      }
    }
  }

  api.close();
  _report(steps, asJson);
}

void _report(List<Map<String, dynamic>> steps, bool asJson) {
  if (asJson) {
    stdout.writeln(const JsonEncoder.withIndent('  ').convert({
      'at': DateTime.now().toIso8601String(),
      'steps': steps,
      'passed': steps.where((s) => s['ok'] == true).length,
      'total': steps.length,
    }));
  } else {
    stdout.writeln('星集控 · 后端契约自检  ${DateTime.now()}');
    stdout.writeln('管理端口：${Platform.environment['CIMS_MGMT_URL'] ?? '(见参数)'}');
    stdout.writeln('');
    for (final s in steps) {
      final mark = s['ok'] == true ? 'OK  ' : 'FAIL';
      stdout.writeln('$mark ${s['name']} (${s['ms']}ms)');
      stdout.writeln('     ${s['detail']}');
    }
    final passed = steps.where((s) => s['ok'] == true).length;
    stdout.writeln('');
    stdout.writeln('通过 $passed / ${steps.length}');
  }
  final failed = steps.any((s) => s['ok'] != true);
  exit(failed ? 1 : 0);
}
