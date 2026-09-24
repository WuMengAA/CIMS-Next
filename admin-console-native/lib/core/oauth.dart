/// 星集控 · OAuth2 授权码流程（桌面端作为原生客户端）
///
/// 复用 Stelarith 网站会话，不再手输 CIMS 密码：
///   1) 在 127.0.0.1 随机端口起本地回拨 HTTP 服务器；
///   2) 拉起系统浏览器打开 {siteHost}/oauth/authorize（用户在此登录/授权）；
///   3) 网站把浏览器 302 回拨到本地端口 ?code&state；
///   4) 校验 state 防 CSRF 后，POST {siteHost}/oauth/token 换取网站会话令牌。
///
/// 该令牌后续作为 Bearer 调网站 `/api/console/cims/*` 代理（复用 RBAC）。
///
/// 测试缝（导出以便单测，无需真实浏览器/网络）：
///   * [parseOAuthCallback] —— 纯函数，校验 state + 提取 code；
///   * [exchangeCodeForToken] —— 令牌换取，可接受注入的 http.Client；
///   * [_startCallbackServer] —— 真实 loopback 服务器，返回回拨地址与回调 future；
///   * [performOAuth] 的 launcher/client 均可注入。

library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

import 'log.dart';

const String _oauthClientId = 'xingjikong_native';
const String _oauthClientSecret = 'dev-xingjikong-secret-change-me';
const String _oauthRedirectPath = '/oauth-callback';
const String _oauthScope = 'cims';
const Duration _oauthTimeout = Duration(minutes: 5);

class OAuthResult {
  final String token;
  const OAuthResult(this.token);
}

String _randomString(int len) {
  final rnd = Random.secure();
  const chars =
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return List.generate(len, (_) => chars[rnd.nextInt(chars.length)]).join();
}

/// 纯函数：从回拨 query 参数校验 state（防 CSRF）并提取授权码。
/// 校验失败或缺少 code 时抛 [StateError]；否则返回 code。
/// 抽成纯函数以便单测，无需真实 HTTP/浏览器。
String parseOAuthCallback(Map<String, String> qp, String expectedState) {
  if (qp['state'] != expectedState) {
    throw StateError('state 校验失败（可能 CSRF）');
  }
  final code = qp['code'];
  if (code == null || code.isEmpty) {
    throw StateError(qp['error'] ?? '授权被拒绝或未返回 code');
  }
  return code;
}

/// 本地回拨服务器句柄：真实绑定 127.0.0.1 随机端口，浏览器被 302 回拨时
/// [onCallback] 完成并返回 query 参数。
class _CallbackServer {
  final HttpServer server;
  final StreamSubscription<HttpRequest> _sub;
  final String redirectUri;
  final Future<Map<String, String>> onCallback;

  _CallbackServer(this.server, this._sub, this.redirectUri, this.onCallback);

  Future<void> close() async {
    await _sub.cancel();
    await server.close(force: true);
  }
}

/// 起一个 loopback 回拨服务器，返回回拨地址与等待回调的 future。
Future<_CallbackServer> _startCallbackServer() async {
  final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  final redirectUri = 'http://127.0.0.1:${server.port}$_oauthRedirectPath';
  final completer = Completer<Map<String, String>>();
  final sub = server.listen((req) async {
    try {
      if (req.uri.path == _oauthRedirectPath) {
        final qp = req.uri.queryParameters;
        req.response
          ..statusCode = 200
          ..headers.contentType = ContentType.html
          ..write('''
<!doctype html><html><head><meta charset="utf-8">
<title>星集控 · 授权成功</title>
<style>body{font-family:system-ui,sans-serif;text-align:center;margin-top:18%}
h3{font-weight:600} p{color:#999;font-size:13px}</style></head>
<body><h3>星集控 · 授权成功</h3><p>可以回到星集控桌面端了，此页面可关闭。</p>
<script>window.close();</script></body></html>''');
        await req.response.close();
        if (!completer.isCompleted) completer.complete(qp);
      } else {
        req.response
          ..statusCode = 404
          ..write('not found');
        await req.response.close();
      }
    } catch (e) {
      if (!completer.isCompleted) completer.completeError(e);
    }
  });
  return _CallbackServer(server, sub, redirectUri, completer.future);
}

/// 用授权码换取网站会话令牌。接受注入的 [client] 以便单测打桩。
/// 非 200 或令牌为空时抛 [StateError]。
Future<String> exchangeCodeForToken(
  http.Client client,
  String base,
  String code,
  String redirectUri,
) async {
  final res = await client.post(
    Uri.parse('$base/oauth/token'),
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: {
      'grant_type': 'authorization_code',
      'code': code,
      'client_id': _oauthClientId,
      'client_secret': _oauthClientSecret,
      'redirect_uri': redirectUri,
    },
  );
  if (res.statusCode != 200) {
    throw StateError('令牌换取失败：${res.statusCode} ${res.body}');
  }
  final data = jsonDecode(res.body) as Map<String, dynamic>;
  final token = data['token'] as String?;
  if (token == null || token.isEmpty) {
    throw StateError('令牌换取返回为空：${res.body}');
  }
  return token;
}

/// 执行完整的 OAuth 授权码流程，返回网站会话令牌。
///
/// 可选注入：
///   * [client] —— 令牌换取用的 HTTP 客户端（默认新建）；
///   * [launcher] —— 拉起浏览器的动作（默认 launchUrl 外部应用）。
/// 二者均可在测试中替换，从而无需真实浏览器/网络即可跑通整条链路。
Future<OAuthResult> performOAuth(
  String siteHost, {
  http.Client? client,
  Future<bool> Function(Uri)? launcher,
}) async {
  final httpClient = client ?? http.Client();
  final launch = launcher ??
      (uri) => launchUrl(uri, mode: LaunchMode.externalApplication);

  final base =
      siteHost.endsWith('/') ? siteHost.substring(0, siteHost.length - 1) : siteHost;
  if (base.isEmpty) {
    Log.w('未填网站地址 → OAuth 不可用', 'oauth');
    throw StateError('未配置网站地址');
  }

  final cb = await _startCallbackServer();
  final state = _randomString(32);

  final authorizeUrl = Uri.parse('$base/oauth/authorize').replace(
    queryParameters: {
      'response_type': 'code',
      'client_id': _oauthClientId,
      'redirect_uri': cb.redirectUri,
      'state': state,
      'scope': _oauthScope,
    },
  );

  try {
    final launched = await launch(authorizeUrl);
    if (!launched) {
      throw StateError('无法打开浏览器，请确认系统默认浏览器可用');
    }
    Log.i('已拉起浏览器到授权页：$authorizeUrl', 'oauth');

    final qp = await cb.onCallback.timeout(_oauthTimeout);
    final code = parseOAuthCallback(qp, state);
    final token = await exchangeCodeForToken(httpClient, base, code, cb.redirectUri);
    return OAuthResult(token);
  } finally {
    await cb.close();
    if (client == null) httpClient.close();
  }
}
