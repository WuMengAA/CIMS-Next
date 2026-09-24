/// 星集控 · 课堂工具：随机抽取（名单管理 / 防重复 / 历史，纯本地持久化）
library;


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/api_client.dart';
import '../../core/models.dart';

class RandomDrawState {
  final List<String> names;
  final Set<int> drawn;
  final List<DrawRecord> history;
  const RandomDrawState({
    this.names = const [],
    this.drawn = const {},
    this.history = const [],
  });

  RandomDrawState copyWith({
    List<String>? names,
    Set<int>? drawn,
    List<DrawRecord>? history,
  }) =>
      RandomDrawState(
        names: names ?? this.names,
        drawn: drawn ?? this.drawn,
        history: history ?? this.history,
      );
}

class RandomDrawNotifier extends StateNotifier<RandomDrawState> {
  RandomDrawNotifier() : super(const RandomDrawState());

  Future<void> load() async {
    final p = await SharedPreferences.getInstance();
    final names = (p.getStringList('xk.random.names') ?? const []);
    final drawn = (p.getStringList('xk.random.drawn') ?? const [])
        .map(int.tryParse)
        .whereType<int>()
        .toSet();
    final history = decodeList(p.getString('xk.random.history'))
        .map((m) => DrawRecord(
              names: (m['names'] as List? ?? const [])
                  .map((e) => e.toString())
                  .toList(),
              at: DateTime.tryParse(m['at']?.toString() ?? '') ??
                  DateTime.now(),
            ))
        .toList();
    state = RandomDrawState(names: names, drawn: drawn, history: history);
  }

  Future<void> _save(List<String>? names, Set<int>? drawn, List<DrawRecord>? history) async {
    final p = await SharedPreferences.getInstance();
    if (names != null) p.setStringList('xk.random.names', names);
    if (drawn != null) p.setStringList('xk.random.drawn', drawn.map((e) => '$e').toList());
    if (history != null) {
      p.setString(
          'xk.random.history',
          encodeList(history
              .map((h) => {'names': h.names, 'at': h.at.toIso8601String()})
              .toList()));
    }
  }

  void importNames(List<String> raw) {
    final clean = raw
        .map((e) => e.trim())
        .where((e) => e.isNotEmpty)
        .toList();
    if (clean.isEmpty) return;
    state = state.copyWith(names: clean, drawn: <int>{});
    _save(clean, <int>{}, null);
  }

  void clearNames() {
    state = state.copyWith(names: const [], drawn: <int>{});
    _save(const [], <int>{}, null);
  }

  void resetDrawn() {
    state = state.copyWith(drawn: <int>{});
    _save(null, <int>{}, null);
  }

  /// 抽取 n 人；useDrawn 时跳过已抽索引。
  /// 返回本次抽中名单并写入历史。
  List<String> draw(int n, {required bool useDrawn}) {
    if (state.names.isEmpty) return const [];
    final pool = <int>[];
    for (var i = 0; i < state.names.length; i++) {
      if (!useDrawn || !state.drawn.contains(i)) pool.add(i);
    }
    if (pool.isEmpty) return const [];
    pool.shuffle();
    final k = n.clamp(1, pool.length);
    final picked = pool.sublist(0, k);
    final pickedNames = picked.map((i) => state.names[i]).toList();
    final newDrawn = {...state.drawn, ...picked};
    final history = [DrawRecord(names: pickedNames, at: DateTime.now()), ...state.history];
    state = state.copyWith(drawn: newDrawn, history: history.take(50).toList());
    _save(null, newDrawn, history.take(50).toList());
    return pickedNames;
  }
}

final randomDrawProvider =
    StateNotifierProvider<RandomDrawNotifier, RandomDrawState>((ref) => RandomDrawNotifier());

class RandomDrawPage extends ConsumerStatefulWidget {
  const RandomDrawPage({super.key});

  @override
  ConsumerState<RandomDrawPage> createState() => _RandomDrawPageState();
}

class _RandomDrawPageState extends ConsumerState<RandomDrawPage> {
  final _input = TextEditingController();

  /// 每次抽几个人。界面固定「抽 1 人」，以后要支持多人抽取时把它接成输入框即可。
  static const int _count = 1;
  bool _noDup = true;
  List<String> _lastDraw = const [];
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(randomDrawProvider.notifier).load());
  }

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  void _import() {
    ref.read(randomDrawProvider.notifier).importNames(_input.text.split('\n'));
    ScaffoldMessenger.of(context)
        .showSnackBar(const SnackBar(content: Text('名单已保存到本机')));
  }

  Future<void> _fromDevices() async {
    setState(() => _busy = true);
    final devices = await ref.read(apiProvider).listDevices();
    if (mounted) {
      setState(() => _busy = false);
      if (devices.isEmpty) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('还没有教室设备可供取名')));
        return;
      }
      ref.read(randomDrawProvider.notifier).importNames(devices.map((d) => d.name).toList());
      _input.text = devices.map((d) => d.name).join('\n');
      ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('已放入 ${devices.length} 个设备名')));
    }
  }

  void _draw() {
    final picked =
        ref.read(randomDrawProvider.notifier).draw(_count, useDrawn: _noDup);
    if (picked.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('名单为空或已全部抽完，请导入名单或重置已抽')));
      return;
    }
    setState(() => _lastDraw = picked);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final s = ref.watch(randomDrawProvider);
    final remain = s.names.length - s.drawn.length;
    return Padding(
      padding: const EdgeInsets.all(20),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('随机点名', style: theme.textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(
              s.names.isEmpty
                  ? '先在下面「名单设置」里放进班级名单，然后就能点名了。'
                  : '共 ${s.names.length} 人，还有 $remain 人没抽到。',
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            // 主角区：结果 + 一个大按钮。老师一进来就能点。
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(vertical: 28),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.primaryContainer,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Center(
                        child: _lastDraw.isEmpty
                            ? Text('抽到的名字会显示在这里',
                                style: TextStyle(
                                    color: theme.colorScheme.onPrimaryContainer
                                        .withValues(alpha: 0.6)))
                            : Text(
                                _lastDraw.join('、'),
                                textAlign: TextAlign.center,
                                style: theme.textTheme.headlineMedium?.copyWith(
                                  color: theme.colorScheme.onPrimaryContainer,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    FilledButton.icon(
                      onPressed: _draw,
                      style: FilledButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 16)),
                      icon: const Icon(Icons.casino),
                      label: const Text('抽 1 人', style: TextStyle(fontSize: 16)),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Switch(
                          value: _noDup,
                          onChanged: (v) => setState(() => _noDup = v),
                        ),
                        const SizedBox(width: 6),
                        const Text('抽过的不再重复'),
                        const Spacer(),
                        TextButton.icon(
                          onPressed: () => ref
                              .read(randomDrawProvider.notifier)
                              .resetDrawn(),
                          icon: const Icon(Icons.restart_alt, size: 18),
                          label: const Text('重新开始一轮'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            // 名单平时收起来：老师设置一次，之后不用再看。
            Card(
              child: Theme(
                data: theme.copyWith(dividerColor: Colors.transparent),
                child: ExpansionTile(
                  tilePadding: const EdgeInsets.symmetric(horizontal: 16),
                  childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                  title: const Text('名单设置'),
                  subtitle: Text(
                      s.names.isEmpty ? '还没有名单' : '当前 ${s.names.length} 人'),
                  initiallyExpanded: s.names.isEmpty,
                  children: [
                    TextField(
                      controller: _input,
                      maxLines: 5,
                      minLines: 3,
                      decoration: const InputDecoration(
                        labelText: '班级名单',
                        hintText: '每行一个名字，粘进来后点「保存名单」',
                        alignLabelWithHint: true,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        FilledButton.tonal(onPressed: _import, child: const Text('保存名单')),
                        if (s.names.isNotEmpty)
                          TextButton(onPressed: () {
                            ref.read(randomDrawProvider.notifier).clearNames();
                            _input.clear();
                          }, child: const Text('清空名单')),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Theme(
                      data: theme.copyWith(dividerColor: Colors.transparent),
                      child: ExpansionTile(
                        tilePadding: EdgeInsets.zero,
                        title: Text('其他导入方式',
                            style: theme.textTheme.bodySmall?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant)),
                        children: [
                          Align(
                            alignment: Alignment.centerLeft,
                            child: OutlinedButton(
                                onPressed: _busy ? null : _fromDevices,
                                child: Text(_busy ? '导入中…' : '用教室设备名当名单')),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text('抽取历史（${s.history.length}）', style: theme.textTheme.titleSmall),
            const SizedBox(height: 8),
            if (s.history.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Text('还没有点名记录。',
                    style: theme.textTheme.bodySmall),
              )
            else
              ...s.history.take(20).map((h) => ListTile(
                    dense: true,
                    leading: const Icon(Icons.casino_outlined, size: 20),
                    title: Text(h.names.join('、')),
                    trailing: Text(
                      '${h.at.month}-${h.at.day} ${h.at.hour.toString().padLeft(2, '0')}:${h.at.minute.toString().padLeft(2, '0')}',
                      style: theme.textTheme.bodySmall,
                    ),
                  )),
          ],
        ),
      ),
    );
  }
}
