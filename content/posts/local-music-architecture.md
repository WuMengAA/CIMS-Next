---
title: 本地音乐播放器的架构选型：为什么是 Flutter + Riverpod
date: '2026-09-07'
updated: '2026-09-13'
status: published
pinned: true
category: 工程笔记
tags:
  - Flutter
  - Riverpod
  - 音频
  - 架构
  - 踩坑
owner: admin
excerpt: 做一款"会思考"的本地音乐播放器，技术栈怎么选？从跨平台、状态管理到音频解码引擎，记录星璃·无限音乐画布的选型理由、真实踩过的五个坑，以及把技术栈"挤"出来的四条约束。
cover: /covers/local-music-architecture.svg
---

做一款本地音乐播放器，和做在线音乐 App 是两回事。在线播放器的核心是"流的调度"——缓冲、码率自适应、CDN 选路，服务端可以帮你兜底；本地播放器的核心却是"文件的理解"：你面对的是用户硬盘上一堆命名混乱、元数据残缺、格式五花八门的文件，**没有任何服务端可用**。

下面记录我在「星璃·无限音乐画布」上的技术选型。所有结论都锚定同一组约束，而不是"哪个框架更流行"。

## 约束先于选型：先钉死四条底线

我给自己列了四条不可妥协的约束。技术栈不是"选"出来的，是被这四条挤出来的：

| 约束 | 含义 | 直接排除掉的方案 |
|------|------|-----------------|
| 本地离线 | 不依赖任何云端服务，断网可用 | 一切需要账号体系 / 云 API 的架构 |
| 全格式 | 用户硬盘里 FLAC、DSD、APE、CUE 什么都有 | 只用平台原生解码器的方案 |
| 跨平台 | Windows / macOS / Linux / Android / iOS 表现一致 | 各平台各写一套原生 |
| 视觉可控 | "体素世界 + 液态玻璃"本身就是卖点 | 依赖系统原生控件的 UI 框架 |

> [!NOTE]
> 选型没有银弹，只有约束。把这四条钉死之后，技术栈几乎是唯一解。这也是我把约束放在最前面的原因：很多人问"该用什么框架"，其实真正该问的是"我不能放弃什么"。

## 跨平台：Flutter 换来了什么，牺牲了什么

跨平台是硬需求。如果 Windows 一套 Qt、macOS 一套 SwiftUI、Android 一套 Compose，同样的播放逻辑要写三遍、同样的 bug 要修三遍——对独立开发者是灾难。

Flutter 用 Dart 单一代码库编译到六个平台，自带 Skia / Impeller 渲染引擎，UI 不依赖系统控件。这一点对我的"体素世界背景 + 液态玻璃"至关重要，因为这种高定制视觉靠原生控件几乎做不出来 [1]。

代价也很明确：Flutter 牺牲了一部分平台原生"手感"。滚动惯性、文本选择、原生右键菜单这些细节，都要靠插件或自绘去补齐。对一款以沉浸体验为卖点的播放器，这笔交易是划算的——**视觉与交互的完全可控，比原生手感的一致性更值钱**。

## 状态管理：Riverpod 如何收拢"碎状态"

本地播放器的状态又碎又交叉：播放队列、循环模式、均衡器、歌词行偏移、扫描进度、收藏、投屏设备……散落在各个 Widget 里，很快就会变成"改一处崩三处"。

Riverpod 的价值在于：编译期安全的依赖注入、可被单元测试的 Provider、以及 `ref.watch` 的细粒度刷新。比 `setState` 或 `InheritedWidget` 更适合这种多状态交叉的场景 [2]。

```dart
// 把「队列 + 循环模式 + 当前索引」收进一个 Notifier，
// UI 只 watch 自己关心的那一片，不因无关状态重绘
final playbackQueueProvider =
    NotifierProvider<PlaybackQueue, QueueState>(PlaybackQueue.new);

class PlaybackQueue extends Notifier<QueueState> {
  @override
  QueueState build() => const QueueState(
        tracks: [],
        index: -1,
        loopMode: LoopMode.off,
      );

  void enqueue(List<Track> incoming, {bool playNext = false}) {
    final next = [...state.tracks];
    final at = playNext ? state.index + 1 : next.length;
    next.insertAll(at < 0 ? 0 : at, incoming);
    state = state.copyWith(tracks: next);
  }

  Track? advance(int delta) {
    final n = state.tracks.length;
    if (n == 0) return null;
    final raw = state.index + delta;
    // 列表循环要取模，关闭循环要夹紧边界——两种语义必须分开写，
    // 混在一起就会出现「最后一首点下一首跳回第一首」的经典 bug
    final i = state.loopMode == LoopMode.all ? raw % n : raw.clamp(0, n - 1);
    state = state.copyWith(index: i);
    return state.tracks[i];
  }
}
```

这里的关键是 `advance()` 里的循环语义：列表循环取模、关闭循环夹紧边界，**必须分开写**。我早期把它们合并成一个 `clamp` 套 `if` 的写法，结果最后一首点"下一首"会跳回第一首——典型的、不写测试就发现不了的 bug。

## 音频引擎：media_kit 与 just_audio 的正面对比

这是最关键的一处选型。两个库代表两条完全不同的路线：

| 维度 | media_kit | just_audio |
|------|-----------|------------|
| 底层 | 封装 libmpv | 平台原生解码器 |
| 格式支持 | 几乎全格式（FLAC / DSD / APE / SACD ISO）==极强== | 受平台限制（AVPlayer / ExoPlayer / MediaPlayer） |
| 包体 | 较大（附带 libmpv 动态库） | 小 |
| 精准 seek | 内建 | 需配合 `audio_session` 等补件 |
| 外接设备路由 | 强 | 依赖平台能力 |

我选了 **media_kit** 作为主引擎 [3]。理由很实际：做本地播放器，用户硬盘里什么格式都有，冷门无损放不出来就是最差体验——"为什么这首歌放不了"是没有任何解释空间的失败。libmpv 带来的那点包体增长，换来的是格式焦虑的彻底消失。

`just_audio` 并非不好 [4]。它在"只放 mp3 / m4a、追求原生手感和包体"的场景下是更优解，只是不匹配我的第二条约束。

## 存储与扫描：SQFlite 与 isolate 的边界

曲库、播放列表、收藏、扫描缓存都是结构化数据，用 SQLite 封装 SQFlite 是自然选择 [5]。但**扫描必须跑在独立 isolate 里**——几万首歌逐个 `stat()` + 读 tag，放在主 isolate 会直接把 UI 卡成幻灯片。

```dart
Future<ScanResult> scanLibrary(String root) async {
  final sw = Stopwatch()..start();
  // 注意：SQFlite 连接不能跨 isolate 共享，必须各自 open 一份
  final db = await openDatabase(p.join(root, 'stelarith.db'));
  var added = 0;
  await db.transaction((txn) async {
    await for (final entity in Directory(root).list(recursive: true)) {
      if (!_isAudio(entity.path)) continue;
      final tag = await readTags(entity.path);
      await txn.insert(
        'tracks',
        tag.toMap(),
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
      added++;
    }
  });
  await db.close();
  return ScanResult(count: added, elapsed: sw.elapsed);
}
```

关键约束是 **SQFlite 的数据库连接不能跨 isolate 共享**，每个 isolate 必须自己 `openDatabase()`。我最初试图把主 isolate 的 db 句柄传进 worker，运行时直接抛错——SQLite 连接绑定在创建它的线程上。

## 五个真实踩过的坑

1. **libmpv 的打包体积**：Windows 上引入 media_kit 后 release 包增大约 30MB+。必须在 CI 里盯住产物体积，否则某天突然发现安装包翻倍都不知道是谁干的。
2. **isolate 不能共享 SQFlite 连接**：见上。每个 isolate 各自 open，写入用 batch 批量提交把事务开销压下去。
3. **路径编码的两副面孔**：Windows 上可能遇到 GBK 编码路径，macOS 上则是 NFD / NFC 归一化问题（同一个 "é" 有两种字节表示）。所有路径入库前统一归一化，否则会出现"同一首歌被扫成两条"。
4. **AudioEngine 生命周期与热重载**：播放器实例若挂在会被重建的 Provider 里，热重载后会出现两个引擎同时出声。必须放在不会被自动 dispose 的顶层 Provider，并在 `ref.onDispose` 里显式释放。
5. **桌面端系统集成要靠插件补齐**：托盘图标、全局媒体键、任务栏进度——这些"播放器该有的东西"Flutter 本身不提供，得靠 `tray_manager`、`window_manager` 一类插件补。这部分工作量常被严重低估。

## 一张表总结

| 关注点 | 选型 | 理由 | 被放弃的替代 |
|--------|------|------|-------------|
| UI 框架 | Flutter | 跨平台 + 视觉完全可控 | 各平台原生 |
| 状态管理 | Riverpod | 编译期安全 + 可测试 + 细粒度刷新 | setState / BLoC |
| 音频引擎 | media_kit | 全格式解码（libmpv） | just_audio |
| 本地存储 | SQFlite | 结构化 + 查询快 | Hive / Isar |
| 扫描并发 | isolate | 不阻塞 UI | 主线程直扫 |

选型没有银弹，只有约束。先把"本地、离线、全格式、跨平台"钉死，技术栈自然就收敛了——而收敛之后的每一步，都会比一开始就想着"用什么最潮"轻松得多。

## 参考来源

1. Flutter 官方文档 — 《Flutter 框架概览》，https://docs.flutter.dev ，访问于 2026-09-07。
2. Riverpod 官方文档 — 《Introduction》，https://riverpod.dev/docs ，访问于 2026-09-07。
3. media_kit — GitHub 仓库（基于 libmpv 的跨平台媒体播放库），https://github.com/media-kit/media-kit ，访问于 2026-09-07。
4. just_audio — Ryan Heise，GitHub 仓库，https://github.com/ryanheise/just_audio ，访问于 2026-09-07。
5. SQFlite — TekArtik，GitHub 仓库（Flutter SQLite 插件），https://github.com/tekartik/sqflite ，访问于 2026-09-07。
