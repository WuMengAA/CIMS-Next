/// 星集控 · 领域模型
library;

import 'dart:convert';

/// CIMS 客户端设备（/account/{id}/client/list + 详情归一化）
///
/// [className] 是给人看的班级名（如「八年级 3 班」）；[className] 为空时
/// 界面应显示「未分班」而不是把 uid 当名字——老师不认识 uid。
class CimsDevice {
  final String uid;
  final String name;
  final bool online;
  final String ip;
  final String last;
  final String className;
  /// 机器名（CIMS 上报的 host，如 N7-20091211）。**与 [uid] 不同**：uid 是 CIMS
  /// 的 client_id，host 是教室端代理的 device_uid —— 远程控制/截图回传按 host
  /// 双 key 查询时要用它（#T07.7 步骤 5）。
  final String host;

  const CimsDevice({
    required this.uid,
    required this.name,
    required this.online,
    required this.ip,
    required this.last,
    this.className = '',
    this.host = '',
  });

  factory CimsDevice.fromJson(Map<String, dynamic> j) {
    final status = (j['status'] ?? '').toString();
    final rawName = (j['name'] ?? '').toString().trim();
    return CimsDevice(
      uid: (j['uid'] ?? j['id'] ?? '').toString(),
      // 没有人类可读名字时给一个中性默认名，绝不把 uid 暴露给用户
      name: rawName.isNotEmpty ? rawName : '未命名设备',
      online: status == 'online' || j['online'] == true,
      ip: (j['mac'] ?? j['ip'] ?? '').toString(),
      last: (j['registered_at'] ?? '').toString(),
      className: (j['class_name'] ?? j['class_id'] ?? j['class'] ?? '')
          .toString()
          .trim(),
      host: (j['host'] ?? '').toString(),
    );
  }

  /// 用于界面展示的「班级」文案：没有分班时给中性提示，不暴露内部编码。
  String get classLabel => className.isNotEmpty ? className : '未分班';
}

/// 广播通知（站点侧留痕归一化）
class NoticeItem {
  final String id;
  final String title;
  final String scope;
  final String at;
  const NoticeItem({required this.id, required this.title, required this.scope, required this.at});
}

/// 随机抽取记录
class DrawRecord {
  final List<String> names;
  final DateTime at;
  const DrawRecord({required this.names, required this.at});
}

/// 文件传输历史条目
class TransferItem {
  final String fileName;
  final int size;
  final String sha256;
  final String target;
  final DateTime at;
  final String status; // pending / sent / failed
  const TransferItem({
    required this.fileName,
    required this.size,
    required this.sha256,
    required this.target,
    required this.at,
    required this.status,
  });
}

/// 调试自检步骤结果（调试面板 / CLI 自检脚本共用）
class CheckStep {
  final String name;
  final bool ok;
  final int ms;
  final String detail;

  const CheckStep({
    required this.name,
    required this.ok,
    required this.ms,
    required this.detail,
  });

  @override
  String toString() => '${ok ? "OK " : "FAIL"} $name (${ms}ms) $detail';
}

/// 简单 JSON 序列化辅助（用于 shared_preferences 持久化列表）
List<Map<String, dynamic>> decodeList(String? raw) {
  if (raw == null || raw.isEmpty) return [];
  try {
    final v = jsonDecode(raw);
    return (v is List) ? v.whereType<Map<String, dynamic>>().toList() : [];
  } catch (_) {
    return [];
  }
}

String encodeList(List<Map<String, dynamic>> items) => jsonEncode(items);
