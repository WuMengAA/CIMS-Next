/// 星集控 · 设备管控（5s 轮询心跳状态 + 操作菜单）
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_client.dart';
import '../../core/models.dart';
import '../../core/settings.dart';

/// 设备列表（每次轮询自动失效重建）
final devicesProvider = FutureProvider<List<CimsDevice>>((ref) async {
  return ref.read(apiProvider).listDevices();
});

class DevicesPage extends ConsumerStatefulWidget {
  const DevicesPage({super.key});

  @override
  ConsumerState<DevicesPage> createState() => _DevicesPageState();
}

class _DevicesPageState extends ConsumerState<DevicesPage> {
  Timer? _timer;
  bool _polling = false;
  // 设备卡片截图预览（5 分钟刷新，对齐网页端）
  final Map<String, String> _shots = {};
  Timer? _shotTimer;
  bool _shotBusy = false;

  @override
  void initState() {
    super.initState();
    // 首轮稍延迟，避免启动即打；之后改为「自调度 + 在途互斥」轮询。
    _timer = Timer(const Duration(seconds: 2), _poll);
    // 卡片截图预览：进入即拉一次，之后每 5 分钟刷新（对齐网页端）
    _refreshShots();
    _shotTimer = Timer.periodic(const Duration(minutes: 5), (_) => _refreshShots());
  }

  /// 拉取各设备最新截图（有图才缓存；失败静默）
  Future<void> _refreshShots() async {
    if (_shotBusy || !mounted) return;
    _shotBusy = true;
    final api = ref.read(apiProvider);
    final list = ref.read(devicesProvider).valueOrNull ?? const <CimsDevice>[];
    for (final d in list) {
      if (_shots.containsKey(d.uid)) continue;
      final cap = await api.getCapture(d.uid);
      if (cap != null && cap['image_base64'] != null) {
        _shots[d.uid] = cap['image_base64'].toString();
      }
    }
    _shotBusy = false;
    if (mounted) setState(() {});
  }

  /// 拉一次设备列表；上一轮尚未回包时直接跳过本轮，杜绝在途请求无限叠加
  /// （后端慢/不可达时，固定周期 invalidate 会越积越多，内存与连接数持续上涨）。
  void _poll() {
    if (!mounted) return;
    if (_polling) return;
    _polling = true;
    ref.invalidate(devicesProvider);
    ref.read(devicesProvider.future).whenComplete(() {
      _polling = false;
      _timer = Timer(const Duration(seconds: 5), _poll);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _shotTimer?.cancel();
    super.dispose();
  }

  Future<void> _act(CimsDevice d, String action) async {
    final api = ref.read(apiProvider);
    final label = {
      'restart': '重启',
      'refresh': '刷新数据',
      'lock': '锁屏',
      'screenshot': '截图',
      'notify': '发通知',
      'remote': '远程控制',
    }[action] ?? action;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text('$label设备'),
        content: Text('确认对「${d.name}」执行「$label」？'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('取消')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('执行')),
        ],
      ),
    );
    if (ok != true) return;
    // 调音量：先问目标音量，再带参数下发
    if (action == 'set_volume') {
      final ctrl = TextEditingController(text: '60');
      final v = await showDialog<int>(
        context: context,
        builder: (c) => AlertDialog(
          title: const Text('调音量'),
          content: TextField(
            controller: ctrl,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: '音量（0-100）'),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c), child: const Text('取消')),
            FilledButton(
              onPressed: () {
                final n = int.tryParse(ctrl.text);
                if (n != null && n >= 0 && n <= 100) Navigator.pop(c, n);
              },
              child: const Text('执行'),
            ),
          ],
        ),
      );
      if (v == null) return;
      try {
        await api.deviceAction(d.uid, 'set_volume', {'volume': v});
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('已下发音量 $v → ${d.name}')));
      } catch (e) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('下发失败：$e')));
      }
      return;
    }
    // 截图链路特殊：下发只是第一步，还要等设备回传再展示（#T07.7 步骤 4）。
    if (action == 'screenshot') {
      await _remoteScreenshot(d);
      return;
    }
    // 远程控制链路特殊：下发 remote_control_start 后轮询 VNC 会话回执（#T07.7 步骤 5）。
    if (action == 'remote') {
      await _remoteControl(d);
      return;
    }
    try {
      final r = await api.deviceAction(d.uid, action);
      final msg = (r is Map && r['message'] != null) ? r['message'].toString() : '已下发 $label';
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('下发失败：$e')));
    }
  }

  /// 远程控制闭环：下发 remote_control_start → 弹「等待会话回执」进度框
  /// （轮询 ext vnc-session，双 key uid+host，最长 30s）→ 拿到 {ip,port,token}
  /// 后展示会话信息 + 可复制；没配置 noVNC 时引导用 VNC 客户端直连。
  /// 「重新发起」会再走一遍（再下发、再等），无需用户重新确认。
  Future<void> _remoteControl(CimsDevice d) async {
    final api = ref.read(apiProvider);
    try {
      await api.deviceRemoteStart(d.uid);
      if (!mounted) return;
      final again = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (_) => _RemoteDialog(api: api, device: d),
      );
      if (again == true && mounted) {
        await _remoteControl(d);
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('远程控制下发失败：$e')));
    }
  }

  /// 远程截图闭环：下发指令 → 弹「等待回传」进度框（轮询 ext captures）→ 出图展示。
  /// 「重新截图」会再走一遍（再下发、再等），无需用户重新确认。
  Future<void> _remoteScreenshot(CimsDevice d) async {
    final api = ref.read(apiProvider);
    try {
      await api.deviceAction(d.uid, 'screenshot');
      if (!mounted) return;
      final again = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (_) => _CaptureDialog(api: api, device: d),
      );
      if (again == true && mounted) {
        await _remoteScreenshot(d);
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('截图下发失败：$e')));
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
          Row(
            children: [
              Text('设备列表', style: theme.textTheme.titleMedium),
              const SizedBox(width: 12),
              Text('每 5 秒自动刷新心跳状态', style: theme.textTheme.bodySmall),
              const Spacer(),
              FilledButton.tonalIcon(
                onPressed: () => ref.invalidate(devicesProvider),
                icon: const Icon(Icons.refresh),
                label: const Text('刷新'),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Expanded(
            child: devices.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(child: Text('加载失败：$e')),
              data: (list) {
                if (demo) {
                  return _buildList(theme, _demoDevices);
                }
                if (list.isEmpty) {
                  return Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.cloud_off, size: 48, color: theme.colorScheme.outline),
                        const SizedBox(height: 12),
                        const Text('还没有教室设备'),
                        const SizedBox(height: 4),
                        Text('教室电脑装好客户端并开机后会自动出现；也可到「设置」查看连接状态',
                            textAlign: TextAlign.center,
                            style: theme.textTheme.bodySmall),
                      ],
                    ),
                  );
                }
                final online = list.where((d) => d.online).length;
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('在线 $online / ${list.length}',
                        style: theme.textTheme.bodySmall
                            ?.copyWith(color: theme.colorScheme.primary)),
                    const SizedBox(height: 8),
                    Expanded(child: _buildList(theme, list)),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildList(ThemeData theme, List<CimsDevice> list) {
    return ListView.builder(
      itemCount: list.length,
      itemBuilder: (c, i) {
        final d = list[i];
        return Card(
          margin: const EdgeInsets.only(bottom: 8),
          clipBehavior: Clip.antiAlias,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // 设备桌面截图预览（5 分钟刷新；无图时占位）
              if (_shots[d.uid] != null)
                Ink.image(
                  image: MemoryImage(base64Decode(_shots[d.uid]!)),
                  fit: BoxFit.cover,
                  height: 120,
                  width: double.infinity,
                )
              else
                Container(
                  height: 120,
                  width: double.infinity,
                  color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.35),
                  child: Center(
                    child: Text(
                      '暂无截图预览 · 点「远程截图」获取',
                      style: TextStyle(
                        fontSize: 12,
                        color: theme.colorScheme.outline,
                      ),
                    ),
                  ),
                ),
              ListTile(
            leading: CircleAvatar(
              backgroundColor: d.online
                  ? const Color(0xFF1D3A2C)
                  : theme.colorScheme.surfaceContainerHighest,
              child: Icon(
                d.online ? Icons.desktop_windows : Icons.desktop_access_disabled,
                color: d.online ? const Color(0xFF3DDC84) : theme.colorScheme.outline,
              ),
            ),
            title: Text(d.name),
            subtitle: Text(
              '${d.classLabel} · ${d.online ? '最近心跳' : '上次在线'} ${d.last.isNotEmpty ? d.last : '—'}',
              style: theme.textTheme.bodySmall,
            ),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: d.online
                        ? const Color(0xFF1D3A2C)
                        : theme.colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(d.online ? '在线' : '离线',
                      style: TextStyle(
                          fontSize: 12,
                          color: d.online
                              ? const Color(0xFF3DDC84)
                              : theme.colorScheme.outline)),
                ),
                PopupMenuButton<String>(
                  tooltip: '操作',
                  onSelected: (a) => _act(d, a),
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 'remote', child: Text('远程控制')),
                    PopupMenuItem(value: 'restart', child: Text('重启设备')),
                    PopupMenuItem(value: 'refresh', child: Text('刷新数据')),
                    PopupMenuItem(value: 'lock', child: Text('锁屏')),
                    PopupMenuItem(value: 'screenshot', child: Text('远程截图')),
                    PopupMenuItem(value: 'notify', child: Text('发送通知')),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  static final _demoDevices = [
    CimsDevice(
        uid: 'uid-d1',
        name: '八年级 3 班 · 教室大屏',
        online: true,
        ip: '',
        last: '刚刚',
        className: '八年级 3 班'),
    CimsDevice(
        uid: 'uid-d2',
        name: '九年级 1 班 · 教室大屏',
        online: true,
        ip: '',
        last: '1 分钟前',
        className: '九年级 1 班'),
    CimsDevice(
        uid: 'uid-d3',
        name: '备用设备',
        online: false,
        ip: '',
        last: '3 小时前',
        className: '未分班'),
  ];
}

/// 「远程截图」弹窗：先转圈等待设备回传（2s 间隔轮询，最多 30s），
/// 拿到 PNG 后渲染图片；「重新截图」= pop(true) 由调用方再走一遍闭环。
class _CaptureDialog extends StatefulWidget {
  final CimsApi api;
  final CimsDevice device;
  const _CaptureDialog({required this.api, required this.device});

  @override
  State<_CaptureDialog> createState() => _CaptureDialogState();
}

class _CaptureDialogState extends State<_CaptureDialog> {
  Timer? _timer;
  int _tries = 0;
  Uint8List? _png;
  String _phase = '已下发指令，正在等待设备回传截图…';
  static const int _maxTries = 15; // 2s × 15 = 30s 上限

  @override
  void initState() {
    super.initState();
    _poll();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _poll() async {
    // 轮询语义：没拿到就再问；失败/超时由 getCapture 内部吞掉（返回 null）。
    final c = await widget.api.getCapture(widget.device.uid);
    if (!mounted) return;
    if (c != null) {
      final b64 = (c['image_base64'] ?? '').toString();
      if (b64.isNotEmpty) {
        try {
          final bytes = base64Decode(b64);
          if (bytes.isNotEmpty) {
            setState(() {
              _png = bytes;
              _phase = '收到截图（${c['bytes'] ?? bytes.length} bytes）';
            // 截图就绪横幅：让老师不用盯着进度框也知道「图回来了」。
            // dialog context 也能解析到 MaterialApp 根部的 ScaffoldMessenger。
            final messenger = ScaffoldMessenger.maybeOf(context);
            if (messenger != null) {
              messenger.showSnackBar(SnackBar(
                content: Text('「${widget.device.name}」已回传截图，请在弹窗中查看'),
                duration: const Duration(seconds: 4),
              ));
            }
            });
            return;
          }
        } catch (_) {
          // base64 坏数据 → 当没拿到继续轮询
        }
      }
    }
    _tries++;
    if (_tries >= _maxTries) {
      setState(() =>
          _phase = '等待超时：设备未回传截图（可能离线，或教室端代理未升级到支持截图）');
      return;
    }
    _timer = Timer(const Duration(seconds: 2), _poll);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return AlertDialog(
      title: Text('远程截图 · ${widget.device.name}'),
      content: SizedBox(
        width: 520,
        child: _png != null
            ? ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 420),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: Image.memory(_png!, fit: BoxFit.contain),
                ),
              )
            : Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: CircularProgressIndicator(),
                  ),
                  const SizedBox(height: 8),
                  Text(_phase, textAlign: TextAlign.center),
                  if (_tries >= _maxTries) ...[
                    const SizedBox(height: 8),
                    Text('可稍后重新对设备执行「远程截图」',
                        style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant)),
                  ],
                ],
              ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('关闭'),
        ),
        if (_png != null)
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('重新截图'),
          ),
      ],
    );
  }
}

/// 「远程控制」弹窗（#T07.7 步骤 5）：下发 remote_control_start 后轮询 VNC 会话
/// 回执（2s × 15 = 30s），拿到 {ip, port, token} 后展示连接信息。
///
/// 会话是瞬态的（IP/端口/令牌每次启动都变），展示两个出口：
///   ① 配置了 noVNC 地址（网站设置 novnc_url）→ 一键用系统浏览器打开 noVNC 页面；
///   ② 没有 noVNC → 复制「ip:port + 令牌」，用任意 VNC 客户端直连。
/// 「重新发起」= pop(true) 由调用方再走一遍闭环。
class _RemoteDialog extends StatefulWidget {
  final CimsApi api;
  final CimsDevice device;
  const _RemoteDialog({required this.api, required this.device});

  @override
  State<_RemoteDialog> createState() => _RemoteDialogState();
}

class _RemoteDialogState extends State<_RemoteDialog> {
  Timer? _timer;
  int _tries = 0;
  Map<String, dynamic>? _session;
  String _phase = '已下发远程控制指令，正在等待教室端回报会话地址…';
  String? _novnc;
  static const int _maxTries = 15; // 2s × 15 = 30s 上限

  @override
  void initState() {
    super.initState();
    _loadNovnc();
    _poll();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _loadNovnc() async {
    final st = await widget.api.fetchExtSettings();
    if (!mounted) return;
    final u = st?['novnc_url'];
    if (u is String && u.trim().isNotEmpty) {
      setState(() => _novnc = u.trim());
    }
  }

  Future<void> _poll() async {
    // 双 key 轮询：先按 client_id（uid），miss 再按 host（agent 的 UID）——
    // 两个串在部署里不同，只查 uid 会永远等不到（#T07.7 步骤 5 脱节修复）。
    final sess = await widget.api.deviceRemoteStatus(
      widget.device.uid,
      host: widget.device.host.isEmpty ? null : widget.device.host,
    );
    if (!mounted) return;
    if (sess != null && sess['ip'] != null && sess['port'] != null) {
      setState(() {
        _session = sess;
        _phase = '已拿到教室端 VNC 会话';
      });
      return;
    }
    _tries++;
    if (_tries >= _maxTries) {
      setState(() => _phase = '等待超时：未收到教室端会话回执（设备可能离线、'
          '教室端代理未升级，或网站 ext 密钥未配置）');
      return;
    }
    _timer = Timer(const Duration(seconds: 2), _poll);
  }

  Future<void> _openNoVnc() async {
    final novnc = _novnc;
    final s = _session;
    if (novnc == null || novnc.isEmpty || s == null) return;
    try {
      final u = Uri.parse(novnc);
      final withQuery = u.replace(queryParameters: {
        ...u.queryParameters,
        'autoconnect': 'true',
        'host': s['ip'].toString(),
        'port': s['port'].toString(),
        if (s['token'] != null && '${s['token']}'.isNotEmpty)
          'password': s['token'].toString(),
        'path': 'websockify',
      });
      final ok = await launchUrl(withQuery,
          mode: LaunchMode.externalApplication);
      if (!ok && mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('无法打开浏览器，请手动复制连接信息')));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('noVNC 地址无法打开，请手动连接')));
      }
    }
  }

  Future<void> _copyInfo() async {
    final s = _session;
    if (s == null) return;
    final ip = s['ip'].toString();
    final port = s['port'].toString();
    final tok = s['token']?.toString() ?? '';
    final text = 'VNC: $ip:$port\n令牌: $tok';
    await Clipboard.setData(ClipboardData(text: text));
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('连接信息已复制到剪贴板')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final s = _session;
    final ip = s?['ip']?.toString() ?? '';
    final port = s?['port']?.toString() ?? '';
    final tok = s?['token']?.toString() ?? '';
    return AlertDialog(
      title: Text('远程控制 · ${widget.device.name}'),
      content: SizedBox(
        width: 480,
        child: s == null
            ? Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: CircularProgressIndicator(),
                  ),
                  const SizedBox(height: 8),
                  Text(_phase, textAlign: TextAlign.center),
                  if (_tries >= _maxTries) ...[
                    const SizedBox(height: 8),
                    Text('可稍后重新对设备发起「远程控制」',
                        style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant)),
                  ],
                ],
              )
            : Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_phase,
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 10),
                  _kv(theme, '教室端地址', '$ip:$port'),
                  if (tok.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    _kv(theme, '会话令牌', tok, mono: true),
                  ],
                  const SizedBox(height: 6),
                  Text('会话是瞬态的：结束控制或设备重启后地址失效，需重新发起。',
                      style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant)),
                  const SizedBox(height: 12),
                  if (_novnc != null && _novnc!.isNotEmpty)
                    FilledButton.icon(
                      onPressed: _openNoVnc,
                      icon: const Icon(Icons.screen_share, size: 18),
                      label: const Text('用浏览器打开 noVNC 画面'),
                    )
                  else
                    Text('未配置 noVNC 地址（网站设置 novnc_url）：复制连接信息后用 VNC 客户端直连。',
                        style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant)),
                ],
              ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('关闭'),
        ),
        if (s != null)
          OutlinedButton.icon(
            onPressed: _copyInfo,
            icon: const Icon(Icons.copy, size: 16),
            label: const Text('复制连接信息'),
          ),
        if (s != null)
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('重新发起'),
          ),
      ],
    );
  }

  Widget _kv(ThemeData theme, String label, String value, {bool mono = false}) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 88,
          child: Text(label,
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
        ),
        Expanded(
          child: SelectableText(
            value,
            style: mono
                ? (theme.textTheme.bodySmall?.copyWith(
                    fontFamily: 'monospace', letterSpacing: 0.5))
                : theme.textTheme.bodyMedium,
          ),
        ),
      ],
    );
  }
}
