/// 星集控 · 课堂工具：文件传输
///
/// V1 链路：本地选择文件 → 计算 SHA-256 → 经 CIMS 命令通道下发 file_push
/// 任务（stelarith_task 验签），设备侧需部署星集控 ClassroomDeploy 包接收。
/// 文件实体上传到服务端暂存依赖部署包扩展的文件服务端点，V1 先打通命令链路。
library;


import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/api_client.dart';
import '../../core/models.dart';

final transferHistoryProvider =
    StateProvider<List<TransferItem>>((ref) => const []);

Future<void> loadTransferHistory(WidgetRef ref) async {
  final p = await SharedPreferences.getInstance();
  final items = decodeList(p.getString('xk.transfer.history'))
      .map((m) => TransferItem(
            fileName: (m['fileName'] ?? '').toString(),
            size: (m['size'] ?? 0) as int,
            sha256: (m['sha256'] ?? '').toString(),
            target: (m['target'] ?? '').toString(),
            at: DateTime.tryParse(m['at']?.toString() ?? '') ?? DateTime.now(),
            status: (m['status'] ?? '').toString(),
          ))
      .toList();
  ref.read(transferHistoryProvider.notifier).state = items;
}

Future<void> saveTransferHistory(WidgetRef ref) async {
  final p = await SharedPreferences.getInstance();
  final items = ref.read(transferHistoryProvider);
  p.setString(
      'xk.transfer.history',
      encodeList(items
          .map((t) => {
                'fileName': t.fileName,
                'size': t.size,
                'sha256': t.sha256,
                'target': t.target,
                'at': t.at.toIso8601String(),
                'status': t.status,
              })
          .toList()));
}

class FileTransferPage extends ConsumerStatefulWidget {
  const FileTransferPage({super.key});

  @override
  ConsumerState<FileTransferPage> createState() => _FileTransferPageState();
}

class _FileTransferPageState extends ConsumerState<FileTransferPage> {
  String? _target; // null = 全校
  List<String> _deviceNames = const [];
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      await loadTransferHistory(ref);
      final devices = await ref.read(apiProvider).listDevices();
      if (mounted) {
        setState(() => _deviceNames = devices.map((d) => d.name).toList());
      }
    });
  }

  Future<void> _pickAndSend() async {
    // withData:false —— 只拿文件路径与元数据，绝不全量读入文件字节（大文件会爆 RAM）。
    // V1 仅下发 name/size/sha256 元数据，文件实体由设备侧拉取。
    final result = await FilePicker.platform.pickFiles(allowMultiple: true, withData: false);
    if (result == null || result.files.isEmpty) return;
    setState(() => _busy = true);
    final api = ref.read(apiProvider);
    final devices = await api.listDevices();
    // 全校 → 逐设备；单设备 → 按名称匹配
    final targets = (_target == null)
        ? devices
        : devices.where((d) => d.name == _target).toList();
    if (targets.isEmpty) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('没有可下发的设备（离线或未连接后端）')));
      }
      return;
    }
    var ok = 0;
    var failed = 0;
    for (final f in result.files) {
      final path = f.path;
      if (path == null) {
        failed++;
        continue;
      }
      // 流式算 SHA，不把整个文件读进内存
      final sha = await CimsApi.sha256OfFile(path);
      final item = TransferItem(
        fileName: f.name,
        size: f.size,
        sha256: sha,
        target: _target ?? '全校 · ${targets.length} 台',
        at: DateTime.now(),
        status: 'pending',
      );
      ref.read(transferHistoryProvider.notifier).state = [item, ...ref.read(transferHistoryProvider)];
      var sent = 0;
      for (final d in targets) {
        try {
          await api.sendTask(
            d.uid,
            'file_push',
            scope: 'device',
            payload: {'name': f.name, 'size': f.size, 'sha256': sha},
          );
          sent++;
        } catch (_) {}
      }
      if (sent > 0) {
        ok++;
        _mark(item, 'sent');
      } else {
        failed++;
        _mark(item, 'failed');
      }
    }
    await saveTransferHistory(ref);
    if (mounted) {
      setState(() => _busy = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(failed == 0
              ? '已发送 $ok 个文件'
              : '已发送 $ok 个，$failed 个没发出去（教室电脑可能没开机）')));
    }
  }

  void _mark(TransferItem item, String status) {
    final list = ref.read(transferHistoryProvider);
    ref.read(transferHistoryProvider.notifier).state = [
      for (final t in list) (t.fileName == item.fileName && t.at == item.at) ? TransferItem(fileName: t.fileName, size: t.size, sha256: t.sha256, target: t.target, at: t.at, status: status) : t,
    ];
  }

  String _fmtSize(int b) {
    if (b >= 1048576) return '${(b / 1048576).toStringAsFixed(1)} MB';
    if (b >= 1024) return '${(b / 1024).toStringAsFixed(1)} KB';
    return '$b B';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final history = ref.watch(transferHistoryProvider);
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('发文件', style: theme.textTheme.titleMedium),
          const SizedBox(height: 4),
          Text('把课件、通知等文件送到教室电脑上。选好文件、选好发给谁即可。',
              style: theme.textTheme.bodySmall),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      FilledButton.icon(
                        onPressed: _busy ? null : _pickAndSend,
                        icon: const Icon(Icons.upload_file),
                        label: const Text('选择文件并发送'),
                      ),
                      const SizedBox(width: 12),
                      DropdownButton<String>(
                        value: _target,
                        hint: const Text('发给全校'),
                        items: [
                          const DropdownMenuItem(
                              value: null, child: Text('发给全校')),
                          for (final n in _deviceNames)
                            DropdownMenuItem(value: n, child: Text(n)),
                        ],
                        onChanged: (v) => setState(() => _target = v),
                      ),
                      const SizedBox(width: 12),
                      if (_busy)
                        const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2)),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                      _target == null
                          ? '会发给全校教室（共 ${_deviceNames.length} 台）'
                          : '只发给：$_target',
                      style: theme.textTheme.bodySmall),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text('传输历史（${history.length}）', style: theme.textTheme.titleSmall),
          const SizedBox(height: 8),
          Expanded(
            child: history.isEmpty
                ? Center(
                    child: Text('还没有发送过文件', style: theme.textTheme.bodySmall))
                : ListView.builder(
                    itemCount: history.length,
                    itemBuilder: (c, i) {
                      final t = history[i];
                      final color = switch (t.status) {
                        'sent' => const Color(0xFF3DDC84),
                        'failed' => theme.colorScheme.error,
                        _ => theme.colorScheme.outline,
                      };
                      return ListTile(
                        dense: true,
                        leading: Icon(Icons.insert_drive_file_outlined,
                            color: color),
                        title: Text(t.fileName),
                        subtitle: Text('${_fmtSize(t.size)} · ${t.target}'),
                        trailing: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(switch (t.status) {
                              'sent' => '已发送',
                              'failed' => '没发出去',
                              _ => '发送中',
                            }, style: TextStyle(color: color, fontSize: 12)),
                            Text(
                              '${t.at.hour.toString().padLeft(2, '0')}:${t.at.minute.toString().padLeft(2, '0')}',
                              style: theme.textTheme.bodySmall,
                            ),
                          ],
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
