/// 星集控 · OAuth 流程单元测试
///
/// 关键约束：flutter test 的 TestWidgetsFlutterBinding 会拦截 dart:io 的 HttpClient
/// （一律返回 400），因此本套件刻意不发起任何「真实」HTTP：
///   * 令牌换取用注入的 [_FakeClient]（不走网络）；
///   * 完整流程里「网站的 302 回拨」用 [Socket] 直连本地回拨端口（raw socket 不受
///     HttpClient 拦截影响），从而真实驱动 _startCallbackServer 的请求解析路径。

library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import 'package:xingjikong/core/oauth.dart';

/// 伪造的 http.Client：不联网，直接回吐构造时给定的响应。
class _FakeClient extends http.BaseClient {
  final http.Response response;
  _FakeClient(this.response);

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    return http.StreamedResponse(
      Stream.value(utf8.encode(response.body)),
      response.statusCode,
      request: request,
    );
  }
}

const _okToken = '{"token":"FAKE_TOKEN","token_type":"Bearer","scope":"cims"}';

void main() {
  group('parseOAuthCallback · state 校验', () {
    test('state 匹配且带 code → 返回 code', () {
      expect(parseOAuthCallback({'code': 'C1', 'state': 's'}, 's'), 'C1');
    });

    test('state 不一致 → 抛 CSRF（防止跨站）', () {
      expect(
        () => parseOAuthCallback({'code': 'C1', 'state': 'bad'}, 's'),
        throwsStateError,
      );
    });

    test('缺 code → 抛错，且带 OAuth error 文案', () {
      expect(() => parseOAuthCallback({'state': 's'}, 's'), throwsStateError);
      expect(
        () => parseOAuthCallback({'state': 's', 'error': 'access_denied'}, 's'),
        throwsA(predicate((e) => e.toString().contains('access_denied'))),
      );
    });
  });

  group('exchangeCodeForToken · 令牌换取', () {
    test('200 + 含 token → 返回 token', () async {
      final c = _FakeClient(http.Response(_okToken, 200));
      expect(await exchangeCodeForToken(c, 'http://x', 'code', 'http://cb'),
          'FAKE_TOKEN');
    });

    test('非 200 → 抛错（绝不把失败当成功）', () async {
      final c = _FakeClient(http.Response('bad credentials', 401));
      expect(() => exchangeCodeForToken(c, 'http://x', 'code', 'http://cb'),
          throwsStateError);
    });

    test('token 为空 → 抛错', () async {
      final c = _FakeClient(http.Response('{"token":""}', 200));
      expect(() => exchangeCodeForToken(c, 'http://x', 'code', 'http://cb'),
          throwsStateError);
    });
  });

  group('performOAuth · 编排', () {
    test('launcher 返回 false（浏览器拉起失败）→ 抛错且不静默', () async {
      expect(
        () => performOAuth('http://x',
            client: _FakeClient(http.Response(_okToken, 200)),
            launcher: (_) async => false),
        throwsStateError,
      );
    });

    test('完整流程：raw socket 模拟网站 302 回拨（绕过 HttpClient 拦截）',
        () async {
      final fake = _FakeClient(http.Response(_okToken, 200));
      final result = await performOAuth(
        'http://127.0.0.1:1', // siteHost 仅用于拼路径，不真连；令牌由 fake 回吐
        client: fake,
        launcher: (uri) async {
          final state = uri.queryParameters['state']!;
          final redirect = uri.queryParameters['redirect_uri']!;
          final u = Uri.parse('$redirect?code=CODE123&state=$state');
          final socket = await Socket.connect(u.host, u.port);
          socket.write(
              'GET ${u.path}?${u.query} HTTP/1.1\r\nHost: ${u.host}\r\nConnection: close\r\n\r\n');
          await socket.flush();
          // 等到服务器回写 200 并关闭连接
          await socket.listen((_) {}).asFuture<void>().timeout(const Duration(seconds: 5));
          await socket.close();
          return true;
        },
      );
      expect(result.token, 'FAKE_TOKEN',
          reason: '回拨服务器解析到 code，且 token 换取成功');
    });
  });
}
