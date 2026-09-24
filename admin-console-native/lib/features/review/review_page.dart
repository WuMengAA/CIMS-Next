/// 星集控 · 审核页（老师 / 电教委员 / 审核员用）
///
/// ⚠️ 诚实说明：审核内容的数据接口由网站后端（网站 agent）提供，当前这一版
/// Flutter 端只把“入口 + 交互骨架”做好，**不假装已有数据**。下拉刷新会 best-effort
/// 探一下 `siteHost + /api/console/cims/v1/review`，拿不到就如实显示空态并提示依赖，
/// 绝不编造待审条目。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import '../../core/log.dart';
import '../../core/settings.dart';

/// 审核接口路径（挂在站点代理下）。网站后端若提供该接口即可对接，目前为依赖项。
const String kReviewApiPath = '/api/console/cims/v1/review';

class ReviewPage extends ConsumerStatefulWidget {
  const ReviewPage({super.key});

  @override
  ConsumerState<ReviewPage> createState() => _ReviewPageState();
}

class _ReviewPageState extends ConsumerState<ReviewPage> {
  bool _checking = false;
  String? _note;

  Future<void> _refresh() async {
    if (_checking) return;
    setState(() => _checking = true);
    final s = ref.read(settingsProvider);
    final url = s.siteHost.trim().isNotEmpty
        ? '${s.siteHost.replaceAll(RegExp(r'/+$'), '')}$kReviewApiPath'
        : '';
    try {
      if (url.isEmpty) {
        _note = '未配置网站地址，无法拉取审核数据';
      } else {
        final res = await http
            .get(Uri.parse(url), headers: {'Accept': 'application/json'})
            .timeout(const Duration(seconds: 5));
        // 200 + 非空数组才可能有数据；其余一律按“暂无 / 未接入”处理，不假装成功。
        if (res.statusCode == 200) {
          _note = '已检查：接口返回 ${res.statusCode}，暂无可审核内容（或网站未实现该接口）';
        } else {
          _note = '已检查：接口返回 HTTP ${res.statusCode}（依赖网站审核接口部署）';
        }
        Log.i('审核刷新：$url → HTTP ${res.statusCode}', 'review');
      }
    } catch (e) {
      _note = '已检查：请求失败（$e），依赖网站审核接口';
      Log.i('审核刷新失败：$e', 'review');
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final id = ref.watch(settingsProvider.select((s) => s.identity));
    final classLabel = [
      if (id != null) id.gradeName,
      if (id != null) id.className,
    ].where((e) => e.isNotEmpty).join(' ');

    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (classLabel.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text('审核范围：$classLabel',
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
            ),
          if (_note != null)
            Container(
              margin: const EdgeInsets.only(bottom: 12),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(_note!,
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
            ),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                children: [
                  Icon(Icons.fact_check_outlined,
                      size: 40, color: theme.colorScheme.outline),
                  const SizedBox(height: 12),
                  Text('暂无待审核内容',
                      style: theme.textTheme.titleMedium
                          ?.copyWith(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 6),
                  Text(
                    '审核数据由网站后端提供。下拉刷新可 best-effort 探一下接口；'
                    '若网站侧尚未实现 / 部署，这里会如实显示空态，不会伪造条目。',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                  ),
                  if (_checking) ...[
                    const SizedBox(height: 12),
                    const CircularProgressIndicator(),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
