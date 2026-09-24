/// 星集控 · 课堂工具：音量调节
///
/// 逐设备拖动滑杆设定音量 / 静音，「应用」经命令通道下发 set_volume /
/// set_volume(muted) 任务（设备端执行需部署星集控 ClassroomDeploy 包）。
/// V1 无真实音量上报通道，滑杆为本地设定值，下发后按设备记录。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/models.dart';
import '../../core/settings.dart';
import '../devices/devices_page.dart';

class VolumePage extends ConsumerStatefulWidget {
  const VolumePage({super.key});

  @override
  ConsumerState<VolumePage> createState() => _VolumePageState();
}

class _VolumePageState extends ConsumerState<VolumePage> {
  final Map<String, double> _volumes = {};
  final Map<String, bool> _muted = {};
  bool _busy = false;

  Future<void> _apply(CimsDevice d) async {
    setState(() => _busy = true);
    try {
      final v = (_volumes[d.uid] ?? 50).round();
      await ref.read(apiProvider).sendTask(
            d.uid,
            'set_volume',
            scope: 'device',
            payload: {'value': v, 'muted': _muted[d.uid] ?? false},
          );
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('已向「${d.name}」下发音量 $v')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('下发失败：$e')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _applyAll(List<CimsDevice> devices) async {
    setState(() => _busy = true);
    var ok = 0;
    for (final d in devices) {
      try {
        final v = (_volumes[d.uid] ?? 50).round();
        await ref.read(apiProvider).sendTask(
              d.uid,
              'set_volume',
              scope: 'device',
              payload: {'value': v, 'muted': _muted[d.uid] ?? false},
            );
        ok++;
      } catch (_) {}
    }
    if (mounted) {
      setState(() => _busy = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('已向 $ok/${devices.length} 台设备应用音量')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final demo = ref.watch(settingsProvider.select((s) => s.demo));
    final devices = ref.watch(devicesProvider);
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('调音量', style: theme.textTheme.titleMedium),
          const SizedBox(height: 4),
          Text('拖动滑杆设定音量，点「应用」后教室电脑立即生效。',
              style: theme.textTheme.bodySmall),
          const SizedBox(height: 12),
          Expanded(
            child: devices.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(child: Text('加载失败：$e')),
              data: (list) {
                if (demo) list = const [];
                if (list.isEmpty) {
                  return Center(
                    child: Text('还没有教室设备', style: theme.textTheme.bodySmall),
                  );
                }
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Align(
                      alignment: Alignment.centerRight,
                      child: FilledButton.icon(
                        onPressed: _busy ? null : () => _applyAll(list),
                        icon: const Icon(Icons.checklist),
                        label: const Text('全部应用'),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Expanded(
                      child: ListView.builder(
                        itemCount: list.length,
                        itemBuilder: (c, i) {
                          final d = list[i];
                          final v = _volumes[d.uid] ?? 50;
                          final muted = _muted[d.uid] ?? false;
                          return Card(
                            margin: const EdgeInsets.only(bottom: 8),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                              child: Row(
                                children: [
                                  SizedBox(
                                      width: 140,
                                      child: Text(d.name,
                                          overflow: TextOverflow.ellipsis)),
                                  Expanded(
                                    child: Row(
                                      children: [
                                        IconButton(
                                          onPressed: () => setState(() {
                                            _muted[d.uid] = !muted;
                                            if (!muted) _volumes[d.uid] = 0;
                                          }),
                                          icon: Icon(muted
                                              ? Icons.volume_off
                                              : Icons.volume_up),
                                        ),
                                        Expanded(
                                          child: Slider(
                                            value: v.clamp(0, 100),
                                            onChanged: (nv) => setState(() {
                                              _muted[d.uid] = false;
                                              _volumes[d.uid] = nv;
                                            }),
                                          ),
                                        ),
                                        SizedBox(
                                            width: 36,
                                            child: Text('${v.round()}',
                                                textAlign: TextAlign.end)),
                                      ],
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  FilledButton.tonal(
                                    onPressed: _busy ? null : () => _apply(d),
                                    child: const Text('应用'),
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
