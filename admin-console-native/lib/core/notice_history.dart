/// 通知历史 —— 老师回头还能翻的那一本账。
///
/// 为什么必须存下来：通知是**一次性**的。老师在讲台上、正对着投影仪看课件，
/// 一条通知弹出来她看见了；可她想不起来"刚才那条说的几点交"，回头找 ——
/// 窗口里已经没了。这不是"体验不够好"，是老师可能会误事。
///
/// 为什么只放本机文件、不上报服务端：历史是**这台机器**的记忆，
/// 老师只关心自己看到过什么。服务端那份已经由通知送达明细承担了。
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'log.dart';

/// 一条历史记录。
class NoticeRecord {
  final int seq;
  final String kind;
  final String title;
  final String body;
  final DateTime at;

  /// 老师是否已经确认过（popup 才需要关心）
  final bool confirmed;

  /// 老师当时的回复（空 = 没回复）
  final String reply;

  /// 是否已读（v2.1 未读红点：打开历史抽屉/确认即视为已读）。
  final bool read;

  const NoticeRecord({
    required this.seq,
    required this.kind,
    required this.title,
    required this.body,
    required this.at,
    this.confirmed = false,
    this.reply = '',
    this.read = true,
  });

  Map<String, dynamic> toJson() => {
        'seq': seq,
        'kind': kind,
        'title': title,
        'body': body,
        'at': at.toIso8601String(),
        'confirmed': confirmed,
        'reply': reply,
        'read': read,
      };

  static NoticeRecord? fromJson(Map<String, dynamic> m) {
    final seq = (m['seq'] as num?)?.toInt() ?? 0;
    if (seq <= 0) return null;
    DateTime at;
    try {
      at = DateTime.parse(m['at']?.toString() ?? '');
    } catch (_) {
      at = DateTime.now();
    }
    return NoticeRecord(
      seq: seq,
      kind: (m['kind'] ?? 'plain').toString(),
      title: (m['title'] ?? '').toString(),
      body: (m['body'] ?? '').toString(),
      at: at,
      confirmed: m['confirmed'] == true,
      reply: (m['reply'] ?? '').toString(),
      read: m['read'] != false,
    );
  }

  bool get isUrgent => kind == 'popup' || kind == 'fullscreen';
}

/// 历史存储（本机 `%LOCALAPPDATA%\xingjikong\history.json`）。
///
/// 只留最近 [kMaxRecords] 条：老师翻历史是找**最近几条**，不是考古；
/// 存全了只会让文件越滚越大、打开抽屉变慢。
class NoticeHistory {
  NoticeHistory._(this._items);

  static const int kMaxRecords = 200;

  final List<NoticeRecord> _items;
  bool _dirty = false;

  /// 最新在前。
  List<NoticeRecord> get all => List.unmodifiable(_items);

  static NoticeHistory? _instance;

  static NoticeHistory get instance => _instance ??= NoticeHistory._([]);

  /// 载入磁盘上的历史。失败（文件损坏/权限）时**退回空历史**而不是抛 ——
  /// 历史没了不影响软件用，启动就崩影响还很大。
  static Future<NoticeHistory> load() async {
    final f = _file();
    final items = <NoticeRecord>[];
    try {
      if (await f.exists()) {
        final text = await f.readAsString(encoding: utf8);
        final v = jsonDecode(text);
        if (v is List) {
          for (final e in v) {
            if (e is! Map) continue;
            final r = NoticeRecord.fromJson(Map<String, dynamic>.from(e));
            if (r != null) items.add(r);
          }
        }
      }
    } catch (e) {
      Log.w('通知历史读取失败（已从空历史开始）：$e', 'history');
    }
    final h = NoticeHistory._(items);
    _instance = h;
    return h;
  }

  static File _file() {
    final base =
        Platform.environment['LOCALAPPDATA'] ?? Directory.systemTemp.path;
    return File('$base${Platform.pathSeparator}xingjikong${Platform.pathSeparator}history.json');
  }

  /// 记一条。同一 seq 重复记（catch-up 与指令通道都可能处理同一条通知）
  /// 只更新，不产生两条 —— 否则历史里同一条通知会出现两次，老师会以为
  /// "集控是不是重复发了"。
  void add(NoticeRecord rec) {
    final idx = _items.indexWhere((e) => e.seq == rec.seq && rec.seq > 0);
    if (idx >= 0) {
      _items[idx] = rec;
    } else {
      _items.insert(0, rec);
      if (_items.length > kMaxRecords) {
        _items.removeRange(kMaxRecords, _items.length);
      }
    }
    _dirty = true;
  }

  void markConfirmed(int seq) {
    final idx = _items.indexWhere((e) => e.seq == seq);
    if (idx < 0) return;
    _items[idx] = NoticeRecord(
      seq: _items[idx].seq,
      kind: _items[idx].kind,
      title: _items[idx].title,
      body: _items[idx].body,
      at: _items[idx].at,
      confirmed: true,
      reply: _items[idx].reply,
    );
    _dirty = true;
  }

  /// 标记某条为已读（打开历史抽屉/确认时调用；未读红点据此消除）。
  void markRead(int seq) {
    final idx = _items.indexWhere((e) => e.seq == seq);
    if (idx < 0 || _items[idx].read) return;
    _items[idx] = NoticeRecord(
      seq: _items[idx].seq,
      kind: _items[idx].kind,
      title: _items[idx].title,
      body: _items[idx].body,
      at: _items[idx].at,
      confirmed: _items[idx].confirmed,
      reply: _items[idx].reply,
      read: true,
    );
    _dirty = true;
  }

  void setReply(int seq, String text) {
    final idx = _items.indexWhere((e) => e.seq == seq);
    if (idx < 0) return;
    _items[idx] = NoticeRecord(
      seq: _items[idx].seq,
      kind: _items[idx].kind,
      title: _items[idx].title,
      body: _items[idx].body,
      at: _items[idx].at,
      confirmed: true,
      reply: text,
    );
    _dirty = true;
  }

  /// 落盘。**失败只记日志**：写不进去不等于历史不能用（内存里还在），
  /// 也不该因为一个日志文件把界面搞崩。
  Future<void> flush() async {
    if (!_dirty) return;
    _dirty = false;
    try {
      final f = _file();
      await f.parent.create(recursive: true);
      await f.writeAsString(
        jsonEncode(_items.map((e) => e.toJson()).toList()),
        flush: true,
        encoding: utf8,
      );
    } catch (e) {
      Log.w('通知历史写入失败：$e', 'history');
    }
  }

  Future<void> clear() async {
    _items.clear();
    _dirty = true;
    await flush();
  }
}

/// 让界面能响应式地订阅历史（抽屉靠它刷新）。
class NoticeHistoryController extends Notifier<List<NoticeRecord>> {
  @override
  List<NoticeRecord> build() => const <NoticeRecord>[];

  /// 启动时从磁盘载入一次。拿不到就当没有历史 —— 不影响任何主功能。
  Future<void> load() async {
    final h = await NoticeHistory.load();
    state = h.all;
  }

  void add(NoticeRecord rec) {
    final h = NoticeHistory.instance;
    h.add(rec);
    state = h.all;
    unawaitedSave(h);
  }

  void markConfirmed(int seq) {
    final h = NoticeHistory.instance;
    h.markConfirmed(seq);
    h.markRead(seq);
    state = h.all;
    unawaitedSave(h);
  }

  void markRead(int seq) {
    final h = NoticeHistory.instance;
    h.markRead(seq);
    state = h.all;
    unawaitedSave(h);
  }

  void setReply(int seq, String text) {
    final h = NoticeHistory.instance;
    h.setReply(seq, text);
    state = h.all;
    unawaitedSave(h);
  }

  Future<void> clear() async {
    final h = NoticeHistory.instance;
    await h.clear();
    state = h.all;
  }

  void unawaitedSave(NoticeHistory h) {
    // 落盘不阻塞界面；写失败只记日志（见 NoticeHistory.flush）
    h.flush();
  }
}

final noticeHistoryProvider =
    NotifierProvider<NoticeHistoryController, List<NoticeRecord>>(
        NoticeHistoryController.new);
