/// 星集控 · 主页（左侧导航 + 内容区）
///
/// **身份适配**：
///   同一个人、不同身份，看到的侧栏不一样。规则是「能力是底线，身份决定默认」：
///     · 能力（服务端下发的 can.control/remote/manage）→ 决定**能不能**做，做不到的
///       一律不出现，哪怕在「更多功能」里；
///     · 身份（role）→ 决定**默认摆什么**，不在默认清单里的收进「更多功能」，
///       点一下依然能进（收的是注意力占用，不是权限）。
///   拿不到身份（直连 CIMS 密码登录 / 后端较旧）→ 不收敛，全量平铺。
library;

import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/device_agent.dart';
import '../../core/identity.dart';
import '../../core/settings.dart';
import '../../core/update_action.dart';
import '../../core/update_check.dart';
import '../../core/updater.dart';
import '../broadcast/broadcast_page.dart';
import '../devices/devices_page.dart';
import '../replies/replies_page.dart';
import '../review/review_page.dart';
import '../settings/settings_page.dart';
import '../swap/swap_page.dart';
import '../teacher/teacher_page.dart';
import '../tools/file_transfer_page.dart';
import '../tools/random_draw_page.dart';
import '../tools/volume_page.dart';
import 'package:url_launcher/url_launcher.dart';

/// 一个侧栏功能项。[key] 与 [Identity.primaryNav] 里的键一一对应。
/// [group] 是分组名（设备 / 通知 / 班级 / 工具 / 设置），桌面侧栏按组分段显示。
class _NavItem {
  final String key;
  final String group;
  final IconData icon;
  final IconData selectedIcon;
  final String label;
  final Widget page;
  const _NavItem(this.key, this.group, this.icon, this.selectedIcon, this.label, this.page);
}

/// 全部功能（顺序即侧栏顺序；同一组内按使用频率排）。身份适配只做"显不显示"，
/// 不动这份目录 —— 分组是视觉分隔，不改变权限逻辑。
const _catalog = <_NavItem>[
  // ── 设备 ──
  _NavItem('devices', '设备', Icons.devices_other_outlined, Icons.devices_other, '教室设备', DevicesPage()),
  // ── 通知 ──
  _NavItem('notify', '通知', Icons.campaign_outlined, Icons.campaign, '发通知', BroadcastPage()),
  _NavItem('replies', '通知', Icons.inbox_outlined, Icons.inbox, '回复收件箱', RepliesPage()),
  // ── 班级 ──
  _NavItem('teacher', '班级', Icons.school_outlined, Icons.school, '老师', TeacherPage()),
  _NavItem('swap', '班级', Icons.swap_horiz_outlined, Icons.swap_horiz, '自助切班', SwapPage()),
  _NavItem('random', '班级', Icons.casino_outlined, Icons.casino, '随机点名', RandomDrawPage()),
  // ── 工具 ──
  _NavItem('file', '工具', Icons.upload_file_outlined, Icons.upload_file, '发文件', FileTransferPage()),
  _NavItem('volume', '工具', Icons.volume_up_outlined, Icons.volume_up, '调音量', VolumePage()),
  _NavItem('review', '工具', Icons.fact_check_outlined, Icons.fact_check, '审核', ReviewPage()),
  // ── 设置 ──
  _NavItem('settings', '设置', Icons.settings_outlined, Icons.settings, '设置', SettingsPage()),
];

class HomePage extends ConsumerStatefulWidget {
  const HomePage({super.key});

  @override
  ConsumerState<HomePage> createState() => _HomePageState();
}

class _HomePageState extends ConsumerState<HomePage> {
  /// 当前功能**用 key 记**而不是下标：展开「更多功能」会让下标整体位移，
  /// 按下标记会在展开的一瞬间跳到别的页面。
  String _current = 'devices';

  /// 是否展开了「更多功能」（非本身份默认的入口）。
  bool _moreOpen = false;

  /// 该身份真正能看到的全部功能（能力是底线）。
  List<_NavItem> _allowed(Identity? id) {
    if (id == null) return _catalog;
    return _catalog.where((i) => id.allows(i.key)).toList();
  }

  /// 拆成「默认」与「更多」两段。
  ({List<_NavItem> primary, List<_NavItem> extra}) _split(
      Identity? id, List<_NavItem> allowed) {
    final keys = id?.primaryNav;
    if (keys == null) return (primary: allowed, extra: const []); // 不收敛
    final want = keys.toSet();
    final primary = allowed.where((i) => want.contains(i.key)).toList();
    final extra = allowed.where((i) => !want.contains(i.key)).toList();
    // 身份清单与能力清单完全对不上时（例如老师却没有任何设备权限），
    // 宁可退回全量，也不要给一个空侧栏。
    if (primary.isEmpty) return (primary: allowed, extra: const []);
    return (primary: primary, extra: extra);
  }

  @override
  Widget build(BuildContext context) {
    final demo = ref.watch(settingsProvider.select((s) => s.demo));
    final id = ref.watch(settingsProvider.select((s) => s.identity));
    final allowed = _allowed(id);
    final parts = _split(id, allowed);
    final shown = _moreOpen ? [...parts.primary, ...parts.extra] : parts.primary;

    // 当前选中的功能可能被身份/能力过滤掉了 → 落到第一项，避免空白与越界。
    if (shown.isEmpty) {
      return const Scaffold(body: Center(child: Text('当前身份没有可用的功能')));
    }
    if (!shown.any((i) => i.key == _current)) {
      _current = shown.first.key;
    }
    final selected = shown.indexWhere((i) => i.key == _current);
    final hasExtra = parts.extra.isNotEmpty;

    // 安卓 / 窄屏用底部导航栏（NavigationBar），桌面宽屏用左侧 NavigationRail。
    final useBottom = !kIsWeb && Platform.isAndroid ||
        MediaQuery.of(context).size.width < 720;

    // 内容区（顶栏 + 页面栈）两种布局复用同一份。
    final content = Column(
      children: [
        _Header(title: shown[selected].label, demo: demo, identity: id),
        if (ref.watch(updateProvider).hasUpdate)
          _UpdateBanner(latest: ref.watch(updateProvider).latest),
        Expanded(
          child: IndexedStack(
            index: selected,
            children: [
              for (final it in shown)
                // 用 key 固定页面状态：展开/收起「更多功能」会改变列表，
                // 没有 key 的话状态会按位置错配，页面被重置。
                KeyedSubtree(key: ValueKey(it.key), child: it.page),
            ],
          ),
        ),
      ],
    );

    if (useBottom) {
      return Scaffold(
        body: content,
        bottomNavigationBar: NavigationBar(
          selectedIndex: selected,
          onDestinationSelected: (i) {
            if (hasExtra && i == shown.length) {
              setState(() => _moreOpen = !_moreOpen);
              return;
            }
            setState(() => _current = shown[i].key);
          },
          destinations: [
            for (final it in shown)
              NavigationDestination(
                icon: Icon(it.icon),
                selectedIcon: Icon(it.selectedIcon),
                label: it.label,
              ),
            if (hasExtra)
              NavigationDestination(
                icon: const Icon(Icons.more_horiz),
                selectedIcon: const Icon(Icons.more_horiz),
                label: _moreOpen ? '收起' : '更多',
              ),
          ],
        ),
      );
    }

    // 桌面侧栏：自定义分组列表（组标签 + 图标项 + 「更多功能」折叠），
    // 比原生 NavigationRail 多了分组分段，解决「功能挤在一起顺序混乱」的问题。
    return Scaffold(
      body: Row(
        children: [
          _Sidebar(
            items: shown,
            selectedKey: _current,
            hasExtra: hasExtra,
            moreOpen: _moreOpen,
            onSelect: (key) => setState(() => _current = key),
            onToggleMore: () => setState(() => _moreOpen = !_moreOpen),
          ),
          const VerticalDivider(width: 1, thickness: 1),
          Expanded(child: content),
        ],
      ),
    );
  }
}

/// 桌面分组侧栏：按 [group] 分段渲染图标项，组与组之间用标签分隔。
class _Sidebar extends StatelessWidget {
  final List<_NavItem> items;
  final String selectedKey;
  final bool hasExtra;
  final bool moreOpen;
  final ValueChanged<String> onSelect;
  final VoidCallback onToggleMore;
  const _Sidebar({
    required this.items,
    required this.selectedKey,
    required this.hasExtra,
    required this.moreOpen,
    required this.onSelect,
    required this.onToggleMore,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    // 按组分组（保持目录顺序）
    final groups = <String, List<_NavItem>>{};
    for (final it in items) {
      groups.putIfAbsent(it.group, () => []).add(it);
    }
    final entries = groups.entries.toList();

    return SizedBox(
      width: 200,
      child: ListView(
        padding: const EdgeInsets.symmetric(vertical: 8),
        children: [
          for (var g = 0; g < entries.length; g++) ...[
            if (g > 0)
              Divider(
                height: 16,
                indent: 16,
                endIndent: 16,
                color: Colors.white.withValues(alpha: 0.05),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 2),
              child: Text(
                entries[g].key,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            for (final it in entries[g].value)
              ListTile(
                dense: true,
                selected: it.key == selectedKey,
                selectedTileColor:
                    theme.colorScheme.primary.withValues(alpha: 0.10),
                leading: Icon(
                  it.key == selectedKey ? it.selectedIcon : it.icon,
                  size: 20,
                ),
                title: Text(it.label, style: const TextStyle(fontSize: 13)),
                onTap: () => onSelect(it.key),
              ),
          ],
          if (hasExtra) ...[
            const SizedBox(height: 4),
            ListTile(
              dense: true,
              leading: const Icon(Icons.more_horiz, size: 20),
              title: Text(moreOpen ? '收起' : '更多功能',
                  style: const TextStyle(fontSize: 13)),
              onTap: onToggleMore,
            ),
          ],
        ],
      ),
    );
  }
}

/// 顶部“有更新”提示条（票 #245）。点「去更新」打开站点，点「稍后」本次会话不再弹。
class _UpdateBanner extends ConsumerWidget {
  final AppVersion? latest;
  const _UpdateBanner({this.latest});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final s = ref.watch(settingsProvider);
    final action = ref.watch(updateActionProvider);
    final busy = action != null &&
        action.phase != UpdatePhase.done &&
        action.phase != UpdatePhase.error;
    // 去官网下载的兜底链接：接口给的 url 优先，否则回落站点首页。
    final target = (latest != null && latest!.url.isNotEmpty)
        ? latest!.url
        : (s.siteHost.isNotEmpty ? s.siteHost : kDefaultSiteHost);
    final title = latest != null
        ? (latest!.forced
            ? '当前版本已停止支持，请更新到 v${latest!.version}'
            : '发现新版本 v${latest!.version}（build ${latest!.build}）')
        : '发现新版本';
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: theme.colorScheme.primaryContainer,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.system_update_alt,
                  size: 18, color: theme.colorScheme.onPrimaryContainer),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  busy ? (action.message) : title,
                  style: TextStyle(
                      fontSize: 13,
                      color: theme.colorScheme.onPrimaryContainer),
                ),
              ),
              if (latest != null && latest!.notes.isNotEmpty && !busy) ...[
                Tooltip(
                  message: latest!.notes,
                  child: const Icon(Icons.info_outline, size: 16),
                ),
                const SizedBox(width: 8),
              ],
              if (!busy)
                TextButton(
                  onPressed: () =>
                      ref.read(updateProvider.notifier).dismiss(),
                  child: const Text('稍后'),
                ),
              const SizedBox(width: 4),
              if (!busy)
                FilledButton(
                  onPressed: () {
                    if (latest != null) {
                      ref
                          .read(updateActionProvider.notifier)
                          .start(latest!);
                    }
                  },
                  child: const Text('立即更新'),
                )
              else
                const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
            ],
          ),
          if (busy && (action.fraction != null)) ...[
            const SizedBox(height: 8),
            LinearProgressIndicator(value: action.fraction),
          ],
          if (action!.phase == UpdatePhase.error) ...[
            const SizedBox(height: 6),
            TextButton(
              onPressed: () async {
                try {
                  await launchUrl(Uri.parse(target),
                      mode: LaunchMode.externalApplication);
                } catch (_) {
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text('无法打开 $target')));
                  }
                }
              },
              child: const Text('或去官网手动下载'),
            ),
          ],
        ],
      ),
    );
  }
}

class _Header extends ConsumerWidget {
  final String title;
  final bool demo;
  final Identity? identity;
  const _Header({required this.title, required this.demo, this.identity});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final s = ref.watch(settingsProvider);
    return Container(
      height: 56,
      padding: const EdgeInsets.symmetric(horizontal: 20),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(bottom: BorderSide(color: Colors.white.withValues(alpha: 0.06))),
      ),
      child: Row(
        children: [
          Text(title,
              style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
          const Spacer(),
          if (demo)
            _Pill(
              text: '演示模式',
              bg: theme.colorScheme.tertiaryContainer,
              fg: theme.colorScheme.onTertiaryContainer,
              tip: '正在使用示例数据，不会连接真实教室',
            )
          else ...[
            Icon(Icons.circle,
                size: 8,
                color: (s.token.isNotEmpty && s.accountId.isNotEmpty)
                    ? const Color(0xFF3DDC84)
                    : theme.colorScheme.error),
            const SizedBox(width: 6),
            Text(
              s.token.isEmpty
                  ? '未登录'
                  : (s.accountId.isEmpty ? '正在读取学校信息…' : '已连接'),
              style: theme.textTheme.bodySmall,
            ),
            if (identity != null) ...[
              const SizedBox(width: 10),
              // 身份条：把"我是谁、我能干什么"直接写在顶栏，不让人猜。
              _Pill(
                text: identity!.levelLabel.isNotEmpty
                    ? '${identity!.levelLabel} · ${identity!.who}'
                    : identity!.who,
                bg: theme.colorScheme.secondaryContainer,
                fg: theme.colorScheme.onSecondaryContainer,
                tip: identity!.blurb.isEmpty
                    ? identity!.who
                    : '${identity!.who} — ${identity!.blurb}',
              ),
            ],
            // 本机被控：这台电脑正在被集控管着。状态必须写在顶栏 ——
            // 它是"关窗也不退出"的理由，看不见的话用户会以为已经关干净了。
            if (s.agentEnabled) ...[
              const SizedBox(width: 10),
              ValueListenableBuilder<AgentStatus>(
                valueListenable: ref.watch(deviceAgentProvider).status,
                builder: (_, st, _) => _Pill(
                  text: st.live ? '本机被控中' : '本机被控 · 未连接',
                  bg: st.live
                      ? const Color(0xFF14321F)
                      : theme.colorScheme.errorContainer,
                  fg: st.live
                      ? const Color(0xFF3DDC84)
                      : theme.colorScheme.onErrorContainer,
                  tip: '这台电脑已接入集控：可被远程关机 / 重启 / 锁屏 / 截屏 / 调音量。\n'
                      '关掉窗口不会退出，会缩到右下角托盘里继续待命。\n'
                      '设备名：${s.deviceName.isNotEmpty ? s.deviceName : s.deviceUid}\n身份键：${s.deviceUid}\n${st.phase}',
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  final String text;
  final Color bg;
  final Color fg;
  final String tip;
  const _Pill({required this.text, required this.bg, required this.fg, required this.tip});

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tip,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(text, style: TextStyle(fontSize: 12, color: fg)),
      ),
    );
  }
}
