/// 星集控 · 调试面板
///
/// 入口：左侧导航「调试」或快捷键 F12（未登录也能进，用于排查连接问题）。
/// 能力：
///   1. 环境快照：后端地址 / 账户上下文 / 运行状态
///   2. 一键自检：账户列表 → 设备列表 → 设备详情 → 扩展网关，逐步计时与失败原因
///   3. 原始请求：任意 method + path + JSON body 直打管理端口，看真实响应
///   4. 运行日志：内存环形缓冲（release 也记录），可按级别过滤 / 清空 / 导出 .log
///   5. 诊断快照：环境 + 自检 + 最近日志拼成一段文本，一键复制给排障的人
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/log.dart';
import '../../core/models.dart';
import '../../core/settings.dart';

class DebugPage extends ConsumerStatefulWidget {
  const DebugPage({super.key});

  @override
  ConsumerState<DebugPage> createState() => _DebugPageState();
}

class _DebugPageState extends ConsumerState<DebugPage> {
  List<CheckStep> _steps = const [];
  bool _checking = false;

  String _method = 'GET';
  final _path = TextEditingController(text: '/account/list');
  final _body = TextEditingController();
  String _resp = '';

  /// 常用请求预设：给排障的人一个「人话下拉」，不必记住任何路径。
  /// value 为 null 表示「自定义」（此时用下面的路径输入框）。
  String? _preset = '/account/list';

  static const _presets = <({String label, String path})>[
    (label: '查看学校账户列表', path: '/account/list'),
    (label: '查看账户下的教室', path: '/account/{账户}/client/list'),
    (label: '查看教室设备状态', path: '/class/device-status'),
    (label: '查看班级列表', path: '/class/list'),
  ];

  LogLevel? _filter;

  /// 实时进程常驻内存（RSS），用于直观确认内存是否稳定/泄漏
  String _rss = '读取中…';
  Timer? _rssTimer;

  @override
  void initState() {
    super.initState();
    _updateRss();
    _rssTimer = Timer.periodic(const Duration(seconds: 2), (_) => _updateRss());
  }

  void _updateRss() {
    if (!mounted) return;
    final mb = ProcessInfo.currentRss / (1024 * 1024);
    setState(() => _rss = '${mb.toStringAsFixed(1)} MB');
  }

  @override
  void dispose() {
    _rssTimer?.cancel();
    _path.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _runCheck() async {
    setState(() {
      _checking = true;
      _steps = const [];
    });
    final api = ref.read(apiProvider);
    final steps = await api.selfCheck();
    if (!mounted) return;
    setState(() {
      _steps = steps;
      _checking = false;
    });
    Log.i('自检完成：${steps.where((s) => s.ok).length}/${steps.length} 通过', 'debug');
  }

  Future<void> _sendRaw() async {
    final api = ref.read(apiProvider);
    final path = _path.text.trim();
    Object? body;
    if (_body.text.trim().isNotEmpty) {
      try {
        body = jsonDecode(_body.text);
      } catch (e) {
        setState(() => _resp = '请求体不是合法 JSON：$e');
        return;
      }
    }
    setState(() => _resp = '请求中…');
    final sw = Stopwatch()..start();
    try {
      final r = await api.reqToManagement(path, method: _method, body: body);
      sw.stop();
      setState(() => _resp =
          '${sw.elapsedMilliseconds}ms\n${const JsonEncoder.withIndent('  ').convert(r)}');
    } catch (e) {
      sw.stop();
      setState(() => _resp = '失败（${sw.elapsedMilliseconds}ms）：$e');
    }
  }

  Future<void> _exportLog() async {
    final name = 'xingjikong-${DateTime.now().millisecondsSinceEpoch}.log';
    final path = await FilePicker.platform.saveFile(
      dialogTitle: '导出运行日志',
      fileName: name,
      allowedExtensions: ['log'],
    );
    if (path == null) return;
    await LogStore.instance.exportTo(path);
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text('已导出到 $path')));
  }

  String _snapshot() {
    final s = ref.read(settingsProvider);
    final buf = StringBuffer()
      ..writeln('=== 星集控诊断快照 ${DateTime.now()} ===')
      ..writeln('平台：${Platform.operatingSystem} ${Platform.operatingSystemVersion}')
      ..writeln('Dart：${Platform.version}')
      ..writeln('管理端口(8097)：${s.mgmtHost.isEmpty ? "（未配置）" : s.mgmtHost}')
      ..writeln('客户端端口(8096)：${s.clientHost.isEmpty ? "（未配置）" : s.clientHost}')
      ..writeln('扩展网关：${s.extHost.isEmpty ? "（未配置）" : s.extHost}')
      ..writeln('网站：${s.siteHost.isEmpty ? "（未配置）" : s.siteHost}')
      ..writeln('演示模式：${s.demo}')
      ..writeln('可用后端(canUseBackend)：${s.canUseBackend}')
      ..writeln('账户ID：${s.accountId.isEmpty ? "（空）" : s.accountId}')
      ..writeln('token：${s.token.isEmpty ? "（空）" : "${s.token.substring(0, s.token.length < 6 ? s.token.length : 6)}…（${s.token.length} 字符）"}')
      ..writeln('任务密钥：${s.taskSecret.isEmpty ? "（未配置，验签会失败）" : "已配置（${s.taskSecret.length} 字符）"}')
      ..writeln('');
    if (_steps.isNotEmpty) {
      buf.writeln('--- 自检 ---');
      for (final st in _steps) {
        buf.writeln(st.toString());
      }
      buf.writeln('');
    }
    buf.writeln('--- 最近日志（最多 100 条）---');
    final all = LogStore.instance.value;
    final take = all.length > 100 ? all.sublist(all.length - 100) : all;
    for (final e in take) {
      buf.writeln(e.format());
    }
    return buf.toString();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final s = ref.watch(settingsProvider);
    // 调试面板可能从侧栏（顶层）或设置页（push）进入：有返回的顶层才安全。
    // 自带顶栏返回按钮 —— 从设置页「打开诊断面板」进入时能回得去，
    // 顶层进入时 BackButton 无路由可退、自动隐藏（AppBar 仍显示标题）。
    return Scaffold(
      appBar: AppBar(
        title: const Text('调试', style: TextStyle(fontSize: 16)),
        leading: const BackButton(),
      ),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: ListView(
        children: [
          Text('调试', style: theme.textTheme.titleMedium),
          const SizedBox(height: 4),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              children: [
                Icon(Icons.build_outlined,
                    size: 18, color: theme.colorScheme.onSurfaceVariant),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '本页供排查故障使用，日常教学不需要打开。遇到问题可点「复制诊断快照」发给技术人员。',
                    style: theme.textTheme.bodySmall,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          _envCard(theme, s),
          const SizedBox(height: 12),
          _checkCard(theme),
          const SizedBox(height: 12),
          _rawCard(theme),
          const SizedBox(height: 12),
          _logCard(theme),
        ],
      ),
      ),
    );
  }

  Widget _envCard(ThemeData theme, Settings s) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('环境', style: theme.textTheme.titleSmall),
            const SizedBox(height: 8),
            _kv('平台', '${Platform.operatingSystem} · Dart ${Platform.version.split(' ').first}'),
            _kv('管理服务', s.mgmtHost.isEmpty ? '（未配置）' : s.mgmtHost),
            _kv('教室连接服务', s.clientHost.isEmpty ? '（未配置）' : s.clientHost),
            _kv('扩展服务', s.extHost.isEmpty ? '（未配置）' : s.extHost),
            _kv('网站', s.siteHost.isEmpty ? '（未配置）' : s.siteHost),
            _kv('账户编码', s.accountId.isEmpty ? '（空 → 设备列表会查不到）' : s.accountId),
            _kv('登录态', s.token.isEmpty ? '（未登录）' : '已登录（${s.token.length} 字符）'),
            _kv('设备通信密钥', s.taskSecret.isEmpty ? '（未配置 → 设备侧验签失败）' : '已配置'),
            _kv('演示模式', s.demo ? '开（不连后端）' : '关'),
            _kv('可以连后端', s.canUseBackend ? '是' : '否'),
            _kv('进程内存', _rss),
          ],
        ),
      ),
    );
  }

  Widget _kv(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(width: 130, child: Text(k, style: const TextStyle(fontSize: 12))),
            Expanded(
                child: Text(v,
                    style: const TextStyle(fontSize: 12, fontFamily: 'Consolas'))),
          ],
        ),
      );

  Widget _checkCard(ThemeData theme) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('连接自检', style: theme.textTheme.titleSmall),
            const SizedBox(height: 8),
            Row(
              children: [
                FilledButton.icon(
                  onPressed: _checking ? null : _runCheck,
                  icon: _checking
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.play_arrow, size: 18),
                  label: const Text('运行自检'),
                ),
                const SizedBox(width: 8),
                OutlinedButton.icon(
                  onPressed: () async {
                    await Clipboard.setData(ClipboardData(text: _snapshot()));
                    if (!mounted) return;
                    ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('诊断快照已复制到剪贴板')));
                  },
                  icon: const Icon(Icons.copy_all, size: 18),
                  label: const Text('复制诊断快照'),
                ),
              ],
            ),
            if (_steps.isNotEmpty) ...[
              const SizedBox(height: 10),
              ..._steps.map((st) => Padding(
                    padding: const EdgeInsets.symmetric(vertical: 3),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(st.ok ? Icons.check_circle : Icons.error,
                            size: 16,
                            color: st.ok
                                ? const Color(0xFF3DDC84)
                                : theme.colorScheme.error),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text('${st.name} · ${st.ms}ms\n${st.detail}',
                              style: const TextStyle(
                                  fontSize: 12, fontFamily: 'Consolas')),
                        ),
                      ],
                    ),
                  )),
            ],
          ],
        ),
      ),
    );
  }

  Widget _rawCard(ThemeData theme) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('手动请求（高级）', style: theme.textTheme.titleSmall),
            const SizedBox(height: 4),
            Text('选一个常用操作即可，不必记路径；仅排障时需要。',
                style: theme.textTheme.bodySmall),
            const SizedBox(height: 10),
            DropdownButtonFormField<String?>(
              initialValue: _preset,
              decoration: const InputDecoration(labelText: '做什么'),
              items: [
                ..._presets.map((p) => DropdownMenuItem<String?>(
                    value: p.path, child: Text(p.label))),
                const DropdownMenuItem<String?>(
                    value: null, child: Text('自定义路径…')),
              ],
              onChanged: (v) => setState(() {
                _preset = v;
                if (v != null) _path.text = v;
              }),
            ),
            const SizedBox(height: 10),
            if (_preset == null) ...[
              TextField(
                controller: _path,
                decoration: const InputDecoration(
                    labelText: '路径', hintText: '/account/list'),
              ),
              const SizedBox(height: 8),
            ],
            Row(
              children: [
                DropdownButton<String>(
                  value: _method,
                  items: const ['GET', 'POST']
                      .map((m) => DropdownMenuItem(value: m, child: Text(m)))
                      .toList(),
                  onChanged: (v) => setState(() => _method = v ?? 'GET'),
                ),
                const Spacer(),
                Text(_preset ?? _path.text,
                    style: TextStyle(
                        fontSize: 11,
                        fontFamily: 'Consolas',
                        color: theme.colorScheme.onSurfaceVariant)),
              ],
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _body,
              maxLines: 3,
              decoration: const InputDecoration(
                  labelText: '请求体（JSON，可留空）', hintText: '{"MessageContent":"测试"}'),
            ),
            const SizedBox(height: 8),
            FilledButton(onPressed: _sendRaw, child: const Text('发送')),
            if (_resp.isNotEmpty) ...[
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.4),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: SelectableText(_resp,
                    style: const TextStyle(fontSize: 12, fontFamily: 'Consolas')),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _logCard(ThemeData theme) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text('运行日志', style: theme.textTheme.titleSmall),
                const Spacer(),
                DropdownButton<LogLevel?>(
                  value: _filter,
                  hint: const Text('全部级别'),
                  items: [
                    const DropdownMenuItem<LogLevel?>(value: null, child: Text('全部级别')),
                    ...LogLevel.values.map((l) => DropdownMenuItem<LogLevel?>(
                        value: l, child: Text(l.name.toUpperCase()))),
                  ],
                  onChanged: (v) => setState(() => _filter = v),
                ),
                const SizedBox(width: 8),
                IconButton(
                  tooltip: '写一条测试日志',
                  icon: const Icon(Icons.note_add_outlined, size: 18),
                  onPressed: () => Log.i('手动测试日志 ${DateTime.now()}', 'debug'),
                ),
                IconButton(
                  tooltip: '清空',
                  icon: const Icon(Icons.delete_outline, size: 18),
                  onPressed: () => LogStore.instance.clear(),
                ),
                IconButton(
                  tooltip: '导出 .log',
                  icon: const Icon(Icons.save_alt, size: 18),
                  onPressed: _exportLog,
                ),
                IconButton(
                  tooltip: '复制全部',
                  icon: const Icon(Icons.copy, size: 18),
                  onPressed: () => Clipboard.setData(
                      ClipboardData(text: LogStore.instance.dump())),
                ),
              ],
            ),
            const SizedBox(height: 8),
            SizedBox(
              height: 260,
              child: ValueListenableBuilder<List<LogEntry>>(
                valueListenable: LogStore.instance,
                builder: (context, entries, _) {
                  final shown = _filter == null
                      ? entries
                      : entries.where((e) => e.level == _filter).toList();
                  if (shown.isEmpty) {
                    return const Center(
                        child: Text('暂无日志', style: TextStyle(fontSize: 12)));
                  }
                  return ListView.builder(
                    itemCount: shown.length,
                    itemBuilder: (context, i) {
                      // 最新在最上面
                      final e = shown[shown.length - 1 - i];
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 1),
                        child: Text(e.format(),
                            style: TextStyle(
                                fontSize: 11.5,
                                fontFamily: 'Consolas',
                                color: _levelColor(theme, e.level))),
                      );
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Color _levelColor(ThemeData theme, LogLevel level) {
    switch (level) {
      case LogLevel.error:
        return theme.colorScheme.error;
      case LogLevel.warn:
        return Colors.orangeAccent;
      case LogLevel.api:
        return theme.colorScheme.primary;
      case LogLevel.info:
        return theme.colorScheme.onSurface.withValues(alpha: 0.75);
    }
  }
}
