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
  /// 原始角色标识（owner/admin/editor/moderator/teacher/homeroom/techrep/user/viewer）
  final String role;

  /// 人话角色名（站长 / 班主任 / 老师 / 电教委员 / 学生 / 访客）
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

  /// v2 动作矩阵（2026-09-25，服务端 /api/me identity.can 下发）：
  /// watch=监控、playback=回放、voice=发语音、notify=发通知、file=传文件、
  /// shutdown=关机。旧服务端快照缺这些键时回退到粗档（control/manage），
  /// 避免新旧两端错位时把管理员的功能也藏掉。
  final bool canWatch;
  final bool canPlayback;
  final bool canVoice;
  final bool canNotify;
  final bool canFile;
  final bool canShutdown;

  /// v2 班级范围：'*'（全校）或真实 class_id 列表（空 = 未绑定/无范围）。
  final List<String> classScope;

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
    this.canWatch = false,
    this.canPlayback = false,
    this.canVoice = false,
    this.canNotify = false,
    this.canFile = false,
    this.canShutdown = false,
    this.classScope = const [],
    this.broadcastScopes = const [],
  });

  factory Identity.fromJson(Map<String, dynamic> j) {
    final can = j['can'];
    final canMap = can is Map ? Map<String, dynamic>.from(can) : const <String, dynamic>{};
    bool flag(String k) => canMap[k] == true;
    final scopes = j['broadcastScopes'];
    // 兼容三种 classScope 形态：'*' / 数组 / 缺失（缺失=旧服务端，按 className 展示）。
    final rawScope = j['classScope'];
    List<String> scope;
    if (rawScope == '*') {
      scope = const ['*'];
    } else if (rawScope is List) {
      scope = rawScope.map((e) => e.toString()).where((e) => e.isNotEmpty).toList();
    } else {
      scope = const [];
    }
    // 旧服务端没有 watch/file/voice/notify 键：粗档兜底，避免管理员被藏功能。
    final legacyHasCanMap = canMap.isNotEmpty;
    final coarseControl = flag('control');
    final coarseManage = flag('manage');
    return Identity(
      role: (j['role'] ?? '').toString(),
      roleLabel: (j['roleLabel'] ?? '').toString(),
      levelLabel: (j['levelLabel'] ?? '').toString(),
      displayName: (j['displayName'] ?? '').toString(),
      className: (j['className'] ?? '').toString(),
      gradeName: (j['gradeName'] ?? '').toString(),
      canControl: coarseControl,
      canRemote: flag('remote'),
      canManage: coarseManage,
      canIssue: flag('issue'),
      canWatch: flag('watch') || coarseControl || coarseManage,
      canPlayback: flag('playback') || flag('watch') || coarseControl || coarseManage,
      canVoice: flag('voice') || (legacyHasCanMap ? false : coarseControl || coarseManage),
      canNotify: flag('notify') || coarseControl || coarseManage,
      canFile: flag('file') || (legacyHasCanMap ? false : coarseControl || coarseManage),
      canShutdown: flag('shutdown'),
      classScope: scope,
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
          'watch': canWatch,
          'playback': canPlayback,
          'voice': canVoice,
          'notify': canNotify,
          'file': canFile,
          'shutdown': canShutdown,
        },
        'classScope': classScope,
        'broadcastScopes': broadcastScopes,
      };

  /// 界面上的"我是谁"（拿不到角色名就退回一个中性说法）。
  String get who => roleLabel.isNotEmpty ? roleLabel : '用户';

  /// 班级范围的人话（面板顶部"我能管哪些班"）。
  String get scopeText {
    if (classScope.contains('*')) return '全校';
    if (classScope.isEmpty) return requiresBinding ? '未绑定班级' : '';
    return classScope.join('、');
  }

  /// 该身份是否必须绑定班级才能干活（v2：老师≤2 班、班主任 1 班、电教委员 1 班；
  /// 管理员免绑=全校；user/viewer 压根禁入不算"待绑定"）。
  bool get requiresBinding =>
      const ['teacher', 'homeroom', 'techrep'].contains(role);

  /// 一句话说清这个身份在集控里能做什么 —— 界面上要**正着说一遍**，
  /// 否则用户只会觉得"我的功能怎么少了"，而不是"这些本来就不是我的活"。
  String get blurb {
    switch (role) {
      case 'owner':
      case 'admin':
        return '全校设备：远控、监控、回放、语音、通知、传文件、关机';
      case 'editor':
        return '内容与页面管理';
      case 'moderator':
        return '审核内容与权限申请';
      case 'homeroom':
        return '本班：远控、监控、回放、发语音、发通知、传文件';
      case 'teacher':
        return '向所带班级（≤2 个）传文件';
      case 'techrep':
        return '电教委员面板 + 文件传输';
      case 'user':
        return '普通用户不可进入集控';
      case 'viewer':
        return '游客不可进入集控';
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
      case 'user':
        // 双重严禁（2026-09-25）：游客/普通用户连"看设备"都不给 ——
        // 前端只剩设置页，后端 /api/console/* 一律 401/403。
        return const ['settings'];
      case 'teacher':
        // v2：传文件是唯一设备动作；设备监控页收回。
        return const ['file', 'settings'];
      case 'techrep':
        // v2：电教委员面板 + 文件传输 + 回复收件箱。
        return const ['teacher', 'file', 'replies', 'settings'];
      case 'homeroom':
        return const ['teacher', 'devices', 'file', 'notify', 'volume', 'settings'];
      case 'moderator':
        // 审核员：审核是主责（设备页随 v2 收回 —— 无 watch 档）。
        return const ['teacher', 'review', 'notify', 'settings'];
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
      case 'volume':
        // 对教室设备下发指令：v2 用动作矩阵（notify）兜粗档（旧服务端兼容）。
        return canNotify || canControl || canRemote || canManage;
      case 'replies':
        // 回复收件箱：查看被控端确认/回复与执行回执 —— 需要能下发通知/管理设备。
        return canNotify || canManage || canControl;
      case 'file':
        // v2 传文件：动作矩阵明示（老师/班主任/电教委员/站长）。
        return canFile || canControl || canManage;
      case 'devices':
        // v2 双重严禁：监控=watch 档，user/viewer 在服务端就没有 watch，
        // 设备页整页不出现（此前"任何登录身份都保留"违反"游客严禁进入"）。
        return canWatch;
      case 'playback':
        return canPlayback || canWatch;
      default:
        // 随机点名 / 设置是纯本地或身份设置，不设设备门槛。
        return true;
    }
  }
}
