/// 星集控 · 课堂工具：文件传输（v2，2026-09-25 班级系统配套）
///
/// 旧 V1 只发元数据（name/size/sha256），文件本体从未离开发送机——设备自然
/// 收不到，发件人这边也只有一句"已发送"就没了下文。V2 把三环补齐：
///   ① 选文件 → 上传实体到网站（multipart POST /api/console/ext/files）；
///   ② 服务端代推 file_push 指令到目标班级的设备（POST /api/console/ext/file-push，
///     目标班级必须在调用者的绑定范围内，服务端逐班校验）；
///   ③ 桌面端轮询逐台回执（GET /api/console/ext/file-deliveries?file=…），
///     历史条目实时亮出"送达 x/y 台"，点开看每台明细与失败原因；
///   ④ 设备端下载落盘后弹本机通知（device_agent.dart _filePush）。
/// 「文件传输后没有消息提示」的两半（发件端没下文、收件端没动静）都在这条链上修掉。
///
/// 目标选择 v2：按**班级**发（不再挑设备名）。班级列表唯一来源 CIMS（/api/classes
/// 过滤身份绑定范围），取不到就明示错误——绝不回退演示班。
library;

import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/api_client.dart';
import '../../core/models.dart';
import '../../core/settings.dart';

final transferHistoryProvider =
    StateProvider<List<TransferItem>>((ref) => const []);

/// 会话内逐台回执明细：fileId → [{uid, state, detail}]。
/// 只活在本次运行里；重开应用后历史条目仍显示持久化的送达摘要。
final deliveryDetailProvider =
    StateProvider<Map<String, List<Map<String, String>>>>((ref) => {});

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
            fileId: (m['fileId'] ?? '').toString(),
            delivered: (m['delivered'] ?? 0) as int,
            total: (m['total'] ?? 0) as int,
          ))
      .toList();
  ref.read(transferHistoryProvider.notifier).state = items;
}

Future<void> saveTransferHistory(WidgetRef ref) async {
  final p = await SharedPreferences.getInstance();
  final items = ref.read(transferHistoryProvider);
  await p.setString(
      'xk.transfer.history',
      encodeList(items
          .map((t) => {
                'fileName': t.fileName,
                'size': t.size,
                'sha256': t.sha256,
                'target': t.target,
                'at': t.at.toIso8601String(),
                'status': t.status,
                'fileId': t.fileId,
                'delivered': t.delivered,
                'total': t.total,
              })
          .toList()));
}

/// 可选班级（class_id 是服务端校验键；name 只给人看，拿不到就退回 id）。
class _ClassOpt {
  final String id;
  final String name;
  const _ClassOpt(this.id, this.name);
  String get label => name.trim().isEmpty ? id : name;
}

class FileTransferPage extends ConsumerStatefulWidget {
  const FileTransferPage({super.key});

  @override
  ConsumerState<FileTransferPage> createState() => _FileTransferPageState();
}

class _FileTransferPageState extends ConsumerState<FileTransferPage> {
  List<_ClassOpt> _classes = const [];
  Set<String> _picked = const {};
  String? _classError;
  bool _loadingClasses = true;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      await loadTransferHistory(ref);
      await _loadClasses();
    });
  }

  /// 班级来源（v2 唯一真实来源，绝不掺演示班）：
  ///   · 身份绑定 '*'（管理员）→ 网站真实全班列表；
  ///   · 绑定具体班级（老师/班主任/电教委员）→ 真实列表里挑出绑定的（顺带拿人话班名）；
  ///   · 未绑定 → 明示"先找管理员绑班"，服务端同样会拦（双保险）；
  ///   · CIMS 不可达 → 明示错误；绑定角色可退回用绑定 id 当选项（服务端按 id 校验照样通）。
  Future<void> _loadClasses() async {
    final id = ref.read(settingsProvider).identity;
    final scope = id?.classScope ?? const <String>[];
    final isAll = scope.contains('*');
    if (!isAll && scope.isEmpty) {
      if (mounted) {
        setState(() {
          _loadingClasses = false;
          _classError = '你还没有绑定班级：请找管理员在后台「用户管理」里给这个账号绑定班级。';
        });
      }
      return;
    }
    final all = await ref.read(apiProvider).listSiteClasses();
    if (!mounted) return;
    if (all == null) {
      if (isAll) {
        setState(() {
          _loadingClasses = false;
          _classError = '班级列表暂时拿不到：CIMS 不可达或尚未导入班级（只显示真实班级，不使用演示数据）。';
        });
      } else {
        // 绑定 id 本身就是服务端认可的键，班名拿不到就先显示 id，不挡老师干活。
        setState(() {
          _loadingClasses = false;
          _classes = [for (final c in scope) _ClassOpt(c, c)];
          if (_classes.length == 1) _picked = {_classes.first.id};
        });
      }
      return;
    }
    final names = <String, String>{
      for (final c in all)
        (c['class_id'] ?? '').toString(): (c['name'] ?? '').toString(),
    };
    setState(() {
      _loadingClasses = false;
      _classError = null;
      if (isAll) {
        _classes = [
          for (final c in all)
            if ((c['class_id'] ?? '').toString().isNotEmpty)
              _ClassOpt((c['class_id']).toString(), (c['name'] ?? '').toString()),
        ];
      } else {
        _classes = [for (final c in scope) _ClassOpt(c, names[c] ?? c)];
      }
      // 只带一个班的身份（班主任/单班老师）：自动选上，少一步操作。
      if (_classes.length == 1) _picked = {_classes.first.id};
    });
  }

  Future<void> _pickAndSend() async {
    if (_picked.isEmpty) {
      _snack('先在下面选要发给哪个班');
      return;
    }
    // withData:false —— 只拿文件路径与元数据，绝不全量读入内存（大文件会爆 RAM）。
    final result =
        await FilePicker.platform.pickFiles(allowMultiple: true, withData: false);
    if (result == null || result.files.isEmpty) return;
    setState(() => _busy = true);
    final api = ref.read(apiProvider);
    final pickedClasses = _picked.toList();
    final targetText = _targetText(pickedClasses);
    var okCount = 0;
    var failCount = 0;
    var lastError = '';
    for (final f in result.files) {
      final path = f.path;
      if (path == null) {
        failCount++;
        continue;
      }
      // 流式算 SHA，不把整个文件读进内存
      final sha = await CimsApi.sha256OfFile(path);
      var item = TransferItem(
        fileName: f.name,
        size: f.size,
        sha256: sha,
        target: targetText,
        at: DateTime.now(),
        status: 'pending',
      );
      _prepend(item);
      try {
        // ① 文件实体上传（≤100MB，服务端落盘登记 file_objects）
        final file = await api.uploadFile(path);
        // ② 服务端代推 file_push 指令到目标班级的全部设备（逐台建档回执）
        final push = await api.pushFile(
          (file['id'] ?? '').toString(),
          classes: pickedClasses,
        );
        final results = push['results'];
        final total = results is List ? results.length : 0;
        item = _retarget(item,
            fileId: (file['id'] ?? '').toString(),
            status: 'sent',
            total: total);
        okCount++;
        if (item.fileId.isNotEmpty && item.total > 0) {
          unawaited(_pollDeliveries(item.fileId));
        }
      } catch (e) {
        lastError = e.toString();
        _retarget(item, status: 'failed');
        failCount++;
      }
    }
    await saveTransferHistory(ref);
    if (mounted) {
      setState(() => _busy = false);
      _snack(failCount == 0
          ? '已发出 $okCount 个文件，等教室电脑接收（下方历史会实时亮出送达情况）'
          : '已发出 $okCount 个，$failCount 个没发出去：$lastError');
    }
  }

  /// 逐台回执轮询：每 3s 一次、最多 90s，全部终态（acked/failed）即停。
  /// 每轮刷新历史条目的送达摘要 + 会话内明细，发件人不再"发完没音讯"。
  Future<void> _pollDeliveries(String fileId) async {
    final api = ref.read(apiProvider);
    for (var i = 0; i < 30; i++) {
      await Future.delayed(const Duration(seconds: 3));
      if (!mounted) return;
      List<Map<String, dynamic>> rows;
      try {
        rows = await api.fileDeliveries(fileId);
      } catch (_) {
        continue; // 网络抖动下一轮再试
      }
      if (rows.isEmpty) continue;
      final acked = rows.where((r) => r['state'] == 'acked').length;
      final failed = rows.where((r) => r['state'] == 'failed').length;
      final total = rows.length;
      ref.read(deliveryDetailProvider.notifier).state = {
        ...ref.read(deliveryDetailProvider),
        fileId: [
          for (final r in rows)
            {
              'uid': (r['uid'] ?? '').toString(),
              'state': (r['state'] ?? '').toString(),
              'detail': (r['detail'] ?? '').toString(),
            },
        ],
      };
      TransferItem? cur;
      for (final t in ref.read(transferHistoryProvider)) {
        if (t.fileId == fileId) {
          cur = t;
          break;
        }
      }
      if (cur != null) {
        final done = acked + failed >= total;
        final status = !done
            ? 'sent'
            : (failed == 0 ? 'sent' : (acked == 0 ? 'failed' : 'partial'));
        _retarget(cur, status: status, delivered: acked, total: total);
      }
      if (acked + failed >= total) return;
    }
    // 90s 超时：有确认算部分送达，一台都没确认按失败计（不等一个可能永远不回的设备）。
    TransferItem? cur;
    for (final t in ref.read(transferHistoryProvider)) {
      if (t.fileId == fileId) {
        cur = t;
        break;
      }
    }
    if (cur != null && cur.status == 'sent') {
      _retarget(cur,
          status: cur.delivered > 0 ? 'partial' : 'failed',
          delivered: cur.delivered,
          total: cur.total);
    }
  }

  // ---- 历史列表操作 ----

  void _prepend(TransferItem item) {
    ref.read(transferHistoryProvider.notifier).state = [
      item,
      ...ref.read(transferHistoryProvider),
    ];
  }

  TransferItem _retarget(
    TransferItem t, {
    String? fileId,
    String? status,
    int? delivered,
    int? total,
  }) {
    final neu = TransferItem(
      fileName: t.fileName,
      size: t.size,
      sha256: t.sha256,
      target: t.target,
      at: t.at,
      status: status ?? t.status,
      fileId: fileId ?? t.fileId,
      delivered: delivered ?? t.delivered,
      total: total ?? t.total,
    );
    final list = ref.read(transferHistoryProvider);
    ref.read(transferHistoryProvider.notifier).state = [
      for (final x in list)
        (x.at == t.at && x.fileName == t.fileName && x.fileId == t.fileId) ? neu : x,
    ];
    return neu;
  }

  String _targetText(List<String> pickedIds) {
    final names = [
      for (final id in pickedIds)
        _classes.where((c) => c.id == id).firstOrNull?.label ?? id,
    ];
    if (names.length <= 2) return names.join('、');
    return '${names.length} 个班';
  }

  void _snack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  String _fmtSize(int b) {
    if (b >= 1048576) return '${(b / 1048576).toStringAsFixed(1)} MB';
    if (b >= 1024) return '${(b / 1024).toStringAsFixed(1)} KB';
    return '$b B';
  }

  Color _statusColor(ThemeData theme, String status) => switch (status) {
        'sent' => const Color(0xFF3DDC84),
        'partial' => const Color(0xFFF59E0B),
        'failed' => theme.colorScheme.error,
        _ => theme.colorScheme.outline,
      };

  String _statusText(TransferItem t) => switch (t.status) {
        'pending' => '发送中…',
        'failed' => '没发出去',
        'sent' when t.total > 0 && t.delivered >= t.total => '全部送达',
        'sent' || 'partial' when t.total > 0 => '送达 ${t.delivered}/${t.total} 台',
        'sent' => '已发出',
        _ => '发送中…',
      };

  /// 逐台明细（本次会话内才有完整明细；重开应用后显示持久化摘要）。
  void _showDetail(TransferItem t) {
    final detail = ref.read(deliveryDetailProvider)[t.fileId] ?? const [];
    showModalBottomSheet<void>(
      context: context,
      builder: (c) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.all(16),
          children: [
            Text('「${t.fileName}」送达明细',
                style: Theme.of(c).textTheme.titleSmall),
            const SizedBox(height: 4),
            Text(t.target, style: Theme.of(c).textTheme.bodySmall),
            const SizedBox(height: 8),
            if (detail.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Text(
                  t.total > 0
                      ? '摘要：送达 ${t.delivered}/${t.total} 台（逐台明细只在本次运行内保留）'
                      : '这条记录没有逐台明细（旧版本发送，或文件还没开始推送）',
                  style: Theme.of(c).textTheme.bodySmall,
                ),
              )
            else
              for (final d in detail)
                ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(
                    switch (d['state']) {
                      'acked' => Icons.check_circle,
                      'failed' => Icons.error,
                      _ => Icons.schedule,
                    },
                    size: 20,
                    color: switch (d['state']) {
                      'acked' => const Color(0xFF3DDC84),
                      'failed' => Theme.of(c).colorScheme.error,
                      _ => Theme.of(c).colorScheme.outline,
                    },
                  ),
                  title: Text(d['uid'] ?? '', style: const TextStyle(fontSize: 13)),
                  subtitle: Text(
                    d['detail'] ?? '',
                    style: Theme.of(c).textTheme.bodySmall,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
          ],
        ),
      ),
    );
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
          Text('把课件、通知等文件送到教室电脑上。选好班级、选好文件即可；'
              '教室端收到后会自动弹通知，这里会逐台亮出送达情况。',
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
                        onPressed: _busy || !_canSend ? null : _pickAndSend,
                        icon: const Icon(Icons.upload_file),
                        label: Text(_busy ? '正在发送…' : '选择文件并发送'),
                      ),
                      const SizedBox(width: 12),
                      if (_busy)
                        const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2)),
                      const Spacer(),
                      if (_classes.length > 1)
                        TextButton(
                          onPressed: _busy
                              ? null
                              : () => setState(() {
                                    _picked = _picked.length == _classes.length
                                        ? {}
                                        : {for (final c in _classes) c.id};
                                  }),
                          child: Text(_picked.length == _classes.length
                              ? '清空'
                              : '全选'),
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text('发给哪些班', style: theme.textTheme.labelLarge),
                  const SizedBox(height: 6),
                  if (_loadingClasses)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 8),
                      child: SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2)),
                    )
                  else if (_classError != null)
                    Text(
                      _classError!,
                      style: TextStyle(color: theme.colorScheme.error),
                    )
                  else if (_classes.isEmpty)
                    Text('还没有可选的班级（CIMS 里尚未导入班级）',
                        style: TextStyle(color: theme.colorScheme.error))
                  else
                    Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      children: [
                        for (final c in _classes)
                          FilterChip(
                            label: Text(c.label),
                            selected: _picked.contains(c.id),
                            onSelected: _busy
                                ? null
                                : (v) => setState(() {
                                      _picked = v
                                          ? {..._picked, c.id}
                                          : _picked.where((x) => x != c.id).toSet();
                                    }),
                          ),
                      ],
                    ),
                  if (!_loadingClasses && _classError == null && _classes.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        _picked.isEmpty
                            ? '先勾选要发的班级，文件会送到这些班的全部教室电脑'
                            : '将推送到：${_targetText(_picked.toList())} 的全部教室电脑（收到后自动弹通知）',
                        style: theme.textTheme.bodySmall,
                      ),
                    ),
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
                      final color = _statusColor(theme, t.status);
                      final hasDetail = t.fileId.isNotEmpty;
                      return ListTile(
                        dense: true,
                        leading: Icon(Icons.insert_drive_file_outlined,
                            color: color),
                        title: Text(t.fileName),
                        subtitle: Text(
                            '${_fmtSize(t.size)} · ${t.target}'
                            '${hasDetail ? ' · 点看明细' : ''}'),
                        trailing: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(_statusText(t),
                                style: TextStyle(color: color, fontSize: 12)),
                            Text(
                              '${t.at.hour.toString().padLeft(2, '0')}:${t.at.minute.toString().padLeft(2, '0')}',
                              style: theme.textTheme.bodySmall,
                            ),
                          ],
                        ),
                        onTap: hasDetail ? () => _showDetail(t) : null,
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }

  bool get _canSend => _classes.isNotEmpty && _classError == null;
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull {
    for (final v in this) {
      return v;
    }
    return null;
  }
}
