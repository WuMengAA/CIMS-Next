/// 星集控 · 使用者身份（桌面端界面适配的依据）
///
/// 身份快照**由服务端解算**后下发（网站 `GET /api/me` 的 `identity` 字段），
/// 客户端只负责"照着摆"：
///   · 从 role 自己推导权限 → 迟早与服务端分叉，出现「界面点得了、服务端拒绝」；
///   · 拿不到身份（直连 CIMS 密码登录、或后端未升级）→ 返回 null，
///     此时界面**不收敛**，全量平铺 —— 宁可多给入口，也不要把功能藏起来。
library;

/// 未知角色/未登录时的"全量"行为：primaryNav 为 null 表示不收敛。
class Identity {
  /// 原始角色标识（owner/admin/editor/moderator/teacher/techrep/user/viewer）
  final String role;

  /// 人话角色名（站长 / 电教委员 / 老师 / 学生 / 访客）
  final String roleLabel;

  /// 显示秩位（L3 电教委员 之类，仅展示用）
  final String levelLabel;

  final String displayName;

  /// 班级 / 年级绑定（本班范围据此确定）
  final String className;
  final String gradeName;

  /// 设备轴（与内容等级正交，由服务端算好）
  final bool canControl;
  final bool canRemote;
  final bool canManage;
  final bool canIssue;

  /// 可广播范围：class / grade / school
  final List<String> broadcastScopes;

  const Identity({
    required this.role,
    this.roleLabel = '',
    this.levelLabel = '',
    this.displayName = '',
    this.className = '',
    this.gradeName = '',
    this.canControl = false,
    this.canRemote = false,
    this.canManage = false,
    this.canIssue = false,
    this.broadcastScopes = const [],
  });

  factory Identity.fromJson(Map<String, dynamic> j) {
    final can = j['can'];
    final canMap = can is Map ? Map<String, dynamic>.from(can) : const <String, dynamic>{};
    bool flag(String k) => canMap[k] == true;
    final scopes = j['broadcastScopes'];
    return Identity(
      role: (j['role'] ?? '').toString(),
      roleLabel: (j['roleLabel'] ?? '').toString(),
      levelLabel: (j['levelLabel'] ?? '').toString(),
      displayName: (j['displayName'] ?? '').toString(),
      className: (j['className'] ?? '').toString(),
      gradeName: (j['gradeName'] ?? '').toString(),
      canControl: flag('control'),
      canRemote: flag('remote'),
      canManage: flag('manage'),
      canIssue: flag('issue'),
      broadcastScopes: scopes is List
          ? scopes.map((e) => e.toString()).where((e) => e.isNotEmpty).toList()
          : const [],
    );
  }

  Map<String, dynamic> toJson() => {
        'role': role,
        'roleLabel': roleLabel,
        'levelLabel': levelLabel,
        'displayName': displayName,
        'className': className,
        'gradeName': gradeName,
        'can': {
          'control': canControl,
          'remote': canRemote,
          'manage': canManage,
          'issue': canIssue,
        },
        'broadcastScopes': broadcastScopes,
      };

  /// 界面上的"我是谁"（拿不到角色名就退回一个中性说法）。
  String get who => roleLabel.isNotEmpty ? roleLabel : '用户';

  /// 一句话说清这个身份在集控里能做什么 —— 界面上要**正着说一遍**，
  /// 否则用户只会觉得"我的功能怎么少了"，而不是"这些本来就不是我的活"。
  String get blurb {
    switch (role) {
      case 'owner':
      case 'admin':
        return '全校设备、用户与站点设置';
      case 'editor':
        return '内容与页面管理，可查看全校设备';
      case 'moderator':
        return '审核内容与权限申请，按年级查看设备';
      case 'teacher':
        return '看本班设备、发本年级通知、课堂点名';
      case 'techrep':
        return '运维本班设备、处理报修、本班沟通';
      case 'user':
        return '查看本班设备状态、提交报修';
      case 'viewer':
        return '只能观看，不能做任何操作';
      default:
        return '';
    }
  }

  /// 该身份在桌面端**默认摆出来**的功能键。
  ///
  /// `null` = 不收敛（未识别身份，例如直连 CIMS 密码登录）→ 全部平铺。
  /// 不在这个列表里的功能**依然可用**，只是收进侧栏「更多功能」——
  /// 收起来的是"注意力占用"，不是权限。
  List<String>? get primaryNav {
    switch (role) {
      case 'viewer':
        return const ['devices', 'settings'];
      case 'user':
        return const ['devices', 'settings'];
      case 'teacher':
        // 安卓老师界面：班级设备 + 广播 + 审核为核心，随机点名/音量/设置收在「更多」。
        return const ['teacher', 'devices', 'notify', 'review', 'random', 'volume', 'settings'];
      case 'techrep':
        return const ['teacher', 'devices', 'notify', 'review', 'random', 'file', 'volume', 'settings'];
      case 'moderator':
        // 审核员：审核是主责，班级设备 + 审核默认摆出。
        return const ['teacher', 'devices', 'review', 'notify', 'settings'];
      case 'owner':
      case 'admin':
      case 'editor':
        return null; // 管理身份：全量入口
      default:
        return null; // 未知身份：不收敛（排障时不必先找菜单）
    }
  }

  /// 侧栏功能的准入：能力是底线（身份收敛只在"能用什么"之上再做"默认摆什么"）。
  ///
  /// [key] 是侧栏功能键；返回 false 的项一律不出现（哪怕是"更多功能"里）。
  bool allows(String key) {
    switch (key) {
      case 'swap':
        // 发起/审批互换是对班级资源的写操作：与服务端 requiredTier 对齐
        // （create/cancel/rollback=control、approve/reject/config=manage）。
        return canControl || canManage;
      case 'notify':
      case 'file':
      case 'volume':
        // 这三项都是对教室设备下发指令，没有设备控制权就没得谈。
        return canControl || canRemote || canManage;
      case 'devices':
        // 看一眼设备状态也算能力（watch 档），任何登录身份都保留。
        return true;
      default:
        // 随机点名 / 设置是纯本地或身份设置，不设设备门槛。
        return true;
    }
  }
}
