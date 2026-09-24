/// 星集控 · 轻量连通性探活
///
/// 不进日志、不打授权头，仅用于：
///   * 首次启动自动探测本机 CIMS 后端（填入默认地址）；
///   * 设置页「重新探测」与调试页端口检查。
/// 返回 HTTP 状态码；连接失败 / 超时返回 -1。
library;

import 'dart:async';

import 'package:http/http.dart' as http;

/// [host] 形如 `http://127.0.0.1:8097`，自动补尾斜杠。
/// [timeout] 默认 2s，避免本机无后端时拖慢首屏。
Future<int> probeHost(String host,
    {Duration timeout = const Duration(seconds: 2)}) async {
  if (host.isEmpty) return -1;
  final url = Uri.parse(host.endsWith('/') ? host : '$host/');
  final client = http.Client();
  try {
    final res = await client.get(url).timeout(timeout);
    return res.statusCode;
  } on TimeoutException {
    return -1;
  } catch (_) {
    return -1;
  } finally {
    client.close();
  }
}
