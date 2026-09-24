/// 星集控 · 自助切班（班级互换申请）
///
/// T07.8 棒 3：桌面端发起/审批互换（与 web 面板 swap 视图同语义）。
/// 数据直连 CIMS management 8097 的 `/class/swap` 路由族：
///   · 发起（swap / oneway）→ POST /class/swap
///   · 审批/驳回（manage 档）→ POST /class/swap/{id}/approve|reject
///   · 撤销/回退（control 档）→ POST /class/swap/{id}/cancel|rollback
/// 权限由服务端硬校验（approve/reject/config → manage；其余写操作 → control），
/// 界面只做「有权限才显示按钮」的体验层收敛，不构成安全边界。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/settings.dart';

/// 页面数据：申请列表 + 班级目录 + 审批开关（一次拉齐，下拉刷新重拉）。
final swapPageProvider = FutureProvider.autoDispose<_SwapData>((ref) async {
  final api = ref.read(apiProvider);
  final items = await api.swapList();
  final classes = await api.listClassEntities();
  final requiresApproval = await api.swapRequiresApproval();
  return _SwapData(items, classes, requiresApproval);
});

class _SwapData {
  final List<Map<String, dynamic>> items;
  final List<Map<String, dynamic>> classes;
  final bool requiresApproval;
  const _SwapData(this.items, this.classes, this.requiresApproval);
}

/// 状态徽标文案（与 web 面板一致）。
const _statusLabel = <String, String>{
  'pending': '待批准',
  'approved': '已批准',
  'executing': '执行中',
  'executed': '已执行',
  'rolled_back': '已回退',
  'rejected': '已驳回',
};

const _typeLabel = <String, String>{'swap': '互换', 'oneway': '单切'};

Color _statusColor(String s) => switch (s) {
      'pending' => const Color(0xFFE6A23C),
      'approved' || 'executing' => const Color(0xFF3D9BE9),
      'executed' => const Color(0xFF3DDC84),
      'rolled_back' => const Color(0xFF9E9E9E),
      'rejected' => const Color(0xFFE5484D),
      _ => const Color(0xFF9E9E9E),
    };

String _fmtTime(Object? iso) {
  if (iso == null) return '—';
  final s = iso.toString().replaceAll('T', ' ').replaceAll('Z', '');
  return s.length > 16 ? s.substring(0, 16) : s;
}

class SwapPage extends ConsumerStatefulWidget {
  const SwapPage({super.key});

  @override
  ConsumerState<SwapPage> createState() => _SwapPageState();
}

class _SwapPageState extends ConsumerState<SwapPage> {
  bool _showForm = false;
  final _formKey = GlobalKey<FormState>();
  String? _from;
  String? _to;
  String _type = 'swap';
  final _reason = TextEditingController();
  final _start = TextEditingController();
  final _end = TextEditingController();
  bool _submitting = false;

  @override
  void dispose() {
    _reason.dispose();
    _start.dispose();
    _end.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_from == null || _to == null) {
      _toast('请选择互换的两个班级');
      return;
    }
    if (_from == _to) {
      _toast('不能与自身互换');
      return;
    }
    setState(() => _submitting = true);
    try {
      final r = await ref.read(apiProvider).swapCreate(
            fromClassId: _from!,
            toClassId: _to!,
            swapType: _type,
            reason: _reason.text.trim(),
            effectiveStartAt: _start.text.trim().isEmpty ? null : _start.text.trim(),
            effectiveEndAt: _end.text.trim().isEmpty ? null : _end.text.trim(),
          );
      final st = (r['status'] ?? '').toString();
      final msg = st == 'pending' ? '已提交，等待审批' : '已执行';
      _toast(msg);
      setState(() {
        _showForm = false;
        _reason.clear();
        _start.clear();
        _end.clear();
      });
      ref.invalidate(swapPageProvider);
    } catch (e) {
      _toast('提交失败：$e');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _act(String id, String action, {String? reason}) async {
    try {
      await ref
          .read(apiProvider)
          .swapAct(id, action, reason: reason ?? '');
      _toast(action == 'approve'
          ? '已批准'
          : action == 'reject'
              ? '已驳回'
              : action == 'rollback'
                  ? '已回退'
                  : '已撤销');
      ref.invalidate(swapPageProvider);
    } catch (e) {
      _toast('操作失败：$e');
    }
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(msg), duration: const Duration(seconds: 3)));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final id = ref.watch(settingsProvider.select((s) => s.identity));
    final canManage = id?.canManage ?? false;
    final async = ref.watch(swapPageProvider);

    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(swapPageProvider),
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.swap_horiz, size: 18),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text('自助切班',
                            style: theme.textTheme.titleSmall
                                ?.copyWith(fontWeight: FontWeight.w600)),
                      ),
                      TextButton.icon(
                        onPressed: () => setState(() => _showForm = !_showForm),
                        icon: Icon(_showForm ? Icons.expand_less : Icons.add),
                        label: Text(_showForm ? '收起' : '发起申请'),
                      ),
                    ],
                  ),
                  Text(
                    async.hasValue && async.value!.requiresApproval
                        ? '当前为审批模式：提交后需管理员批准才生效'
                        : '当前为免审批模式：提交后立即生效；到期自动回退',
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                  ),
                  if (_showForm) ...[
                    const SizedBox(height: 12),
                    Form(
                      key: _formKey,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _classDropdown(
                            label: 'A 班（当前方案要被换走）',
                            value: _from,
                            onChanged: (v) => setState(() => _from = v),
                          ),
                          const SizedBox(height: 10),
                          _classDropdown(
                            label: 'B 班（与之互换 / 切到它）',
                            value: _to,
                            onChanged: (v) => setState(() => _to = v),
                          ),
                          const SizedBox(height: 10),
                          SegmentedButton<String>(
                            segments: const [
                              ButtonSegment(value: 'swap', label: Text('互换')),
                              ButtonSegment(value: 'oneway', label: Text('单切')),
                            ],
                            selected: {_type},
                            onSelectionChanged: (s) =>
                                setState(() => _type = s.first),
                          ),
                          const SizedBox(height: 10),
                          TextField(
                            controller: _reason,
                            decoration: const InputDecoration(
                              labelText: '原因（选填）',
                              hintText: '例如：周四大扫除，两班互调',
                              isDense: true,
                              border: OutlineInputBorder(),
                            ),
                          ),
                          const SizedBox(height: 10),
                          TextField(
                            controller: _start,
                            decoration: const InputDecoration(
                              labelText: '生效开始（选填，ISO8601）',
                              hintText: '2026-09-24T14:00:00',
                              isDense: true,
                              border: OutlineInputBorder(),
                            ),
                          ),
                          const SizedBox(height: 10),
                          TextField(
                            controller: _end,
                            decoration: const InputDecoration(
                              labelText: '生效结束（选填，到期自动回退）',
                              hintText: '2026-09-24T17:00:00',
                              isDense: true,
                              border: OutlineInputBorder(),
                            ),
                          ),
                          const SizedBox(height: 12),
                          SizedBox(
                            width: double.infinity,
                            child: FilledButton.icon(
                              onPressed: _submitting ? null : _submit,
                              icon: _submitting
                                  ? const SizedBox(
                                      width: 16,
                                      height: 16,
                                      child: CircularProgressIndicator(strokeWidth: 2),
                                    )
                                  : const Icon(Icons.send),
                              label: Text(_submitting ? '提交中…' : '提交申请'),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Text('互换申请记录',
                  style: theme.textTheme.titleSmall
                      ?.copyWith(fontWeight: FontWeight.w600)),
              const Spacer(),
              IconButton(
                tooltip: '刷新',
                icon: const Icon(Icons.refresh, size: 18),
                onPressed: () => ref.invalidate(swapPageProvider),
              ),
            ],
          ),
          const SizedBox(height: 4),
          if (async.isLoading)
            const Padding(
                padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()))
          else if (async.hasError)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Text('加载失败：${async.error}',
                    style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ),
            )
          else if (async.value!.items.isEmpty)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(20),
                child: Text('暂无互换申请。班主任或电教委员可发起班级互换。'),
              ),
            )
          else
            for (final it in async.value!.items)
              _SwapCard(
                item: it,
                canManage: canManage,
                classNameOf: (cid) => _className(async.value!.classes, cid),
                onAct: _act,
              ),
        ],
      ),
    );
  }

  String _className(List<Map<String, dynamic>> classes, String id) {
    for (final c in classes) {
      if ((c['id'] ?? '') == id || (c['class_id'] ?? '') == id) {
        final n = (c['name'] ?? '').toString();
        if (n.isNotEmpty) return n;
        return id;
      }
    }
    return id;
  }

  Widget _classDropdown({
    required String label,
    required String? value,
    required ValueChanged<String?> onChanged,
  }) {
    final classes = ref.watch(swapPageProvider).value?.classes ?? const [];
    return DropdownButtonFormField<String>(
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(
        labelText: label,
        isDense: true,
        border: const OutlineInputBorder(),
      ),
      items: [
        for (final c in classes)
          DropdownMenuItem(
            value: (c['id'] ?? c['class_id'] ?? '').toString(),
            child: Text(
              _className(classes, (c['id'] ?? c['class_id'] ?? '').toString()),
              overflow: TextOverflow.ellipsis,
            ),
          ),
      ],
      onChanged: onChanged,
    );
  }
}

class _SwapCard extends StatelessWidget {
  final Map<String, dynamic> item;
  final bool canManage;
  final String Function(String) classNameOf;
  final Future<void> Function(String id, String action, {String? reason}) onAct;
  const _SwapCard({
    required this.item,
    required this.canManage,
    required this.classNameOf,
    required this.onAct,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final st = (item['status'] ?? '').toString();
    final type = (item['swap_type'] ?? 'swap').toString();
    final from = (item['from_class_id'] ?? '').toString();
    final to = (item['to_class_id'] ?? '').toString();
    final reason = (item['reason'] ?? '').toString();
    final rejectReason = (item['rejected_reason'] ?? '').toString();
    final actions = <Widget>[];

    void btn(String label, String action, {Color? color}) {
      actions.add(OutlinedButton(
        style: OutlinedButton.styleFrom(
          foregroundColor: color ?? theme.colorScheme.primary,
          visualDensity: VisualDensity.compact,
          padding: const EdgeInsets.symmetric(horizontal: 10),
        ),
        onPressed: () => onAct((item['id'] ?? '').toString(), action),
        child: Text(label, style: const TextStyle(fontSize: 12)),
      ));
    }

    if (st == 'pending') {
      if (canManage) {
        btn('批准', 'approve', color: const Color(0xFF3DDC84));
        btn('驳回', 'reject', color: const Color(0xFFE5484D));
      }
      btn('撤销', 'cancel');
    }
    if (st == 'executed') {
      btn('手动回退', 'rollback', color: const Color(0xFFE6A23C));
    }

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: _statusColor(st).withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    _statusLabel[st] ?? st,
                    style: TextStyle(
                      fontSize: 12,
                      color: _statusColor(st),
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Text(_typeLabel[type] ?? type,
                    style: theme.textTheme.bodySmall),
                const Spacer(),
                Text(_fmtTime(item['created_at']),
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              '${classNameOf(from)}  ${type == 'swap' ? '⇄' : '→'}  ${classNameOf(to)}',
              style: theme.textTheme.titleSmall
                  ?.copyWith(fontWeight: FontWeight.w600),
            ),
            if (reason.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text('原因：$reason', style: theme.textTheme.bodySmall),
            ],
            if (st == 'rejected' && rejectReason.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text('驳回原因：$rejectReason',
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: const Color(0xFFE5484D))),
            ],
            if (item['effective_start_at'] != null ||
                item['effective_end_at'] != null) ...[
              const SizedBox(height: 4),
              Text(
                '生效：${_fmtTime(item['effective_start_at'])} ~ ${_fmtTime(item['effective_end_at'])}',
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            ],
            if (actions.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(spacing: 8, children: actions),
            ],
          ],
        ),
      ),
    );
  }
}
