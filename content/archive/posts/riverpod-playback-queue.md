---
title: Riverpod 实战：播放队列与多状态管理
date: '2026-09-07'
updated: '2026-09-13'
status: published
category: 工程笔记
tags:
  - Riverpod
  - Flutter
  - 状态管理
  - 播放队列
  - 测试
owner: admin
excerpt: 本地播放器的状态又碎又交叉：队列、循环、均衡器、歌词偏移、扫描进度……记录星璃如何用 Riverpod 给状态分层、把"下一首该播什么"的分支逻辑收进可测试的 Notifier，以及高频播放位置为什么不进 Provider。
cover: /covers/riverpod-playback-queue.svg
---

本地播放器的状态很碎：播放队列、循环模式、均衡器、歌词行偏移、扫描进度、收藏。如果散落在各组件里，维护会失控。继上次聊完"为什么选 Riverpod"，这里落到具体——以**播放队列**为例，看怎么用 Provider 把状态收拢，以及哪些状态**不该**放进 Provider。

## 队列状态长什么样

一个播放队列至少要回答：

- 当前列表有哪些曲子（queue）
- 现在播到第几首（index）
- 循环模式（none / one / all）
- 随机是否开启（shuffle）
- 播放态（playing / paused / stopped）

这些状态彼此牵连：切随机要重排队列、切循环要改变"下一首"的边界、删除当前曲要修正 `index`。把它们塞进一个 `PlaybackQueueNotifier` 最自然。

## 用一个 Notifier 收口

```dart
final playbackQueueProvider =
    NotifierProvider<PlaybackQueueNotifier, PlaybackState>(
  PlaybackQueueNotifier.new,
);

class PlaybackQueueNotifier extends Notifier<PlaybackState> {
  @override
  PlaybackState build() => const PlaybackState(queue: [], index: 0);

  void playNext() {
    final s = state;
    if (s.shuffle) {
      // 从剩余曲目里随机挑一首
    } else if (s.loop == Loop.one) {
      // 重播当前
    } else if (s.index + 1 < s.queue.length) {
      state = s.copyWith(index: s.index + 1);
    } else if (s.loop == Loop.all) {
      state = s.copyWith(index: 0); // 回到开头
    }
    // 否则停在结尾
  }
}
```

UI 用 `ref.watch(playbackQueueProvider)` 细粒度订阅，只在队列相关字段变化时刷新对应组件——比 `setState` 全局重绘干净太多。

> [!TIP]
> 把"下一首该播什么"这种带分支的逻辑收进 Notifier 的方法里，UI 永远只调 `playNext()`，不碰判断。状态演进可测、可单步验证。

## 派生状态：能算出来的，就不要存

"当前曲目"不该是一份独立存储的数据，它应该由「队列 + 索引」推导出来。存两份，早晚会对不上。

```dart
/// 当前曲目 = queue[index]，不单独存一份
final currentTrackProvider = Provider<Track?>((ref) {
  final s = ref.watch(playbackQueueProvider);
  if (s.index < 0 || s.index >= s.queue.length) return null;
  return s.queue[s.index];
});

/// 能否切下一首，同样是派生出来的
final canSkipNextProvider = Provider<bool>((ref) {
  final s = ref.watch(playbackQueueProvider);
  if (s.queue.isEmpty) return false;
  if (s.loop == Loop.one || s.loop == Loop.all) return true;
  return s.index < s.queue.length - 1;
});
```

这样 UI 只 `ref.watch(currentTrackProvider)`，不需要知道队列和索引的关系。**派生状态是 Riverpod 最值钱的能力**——它把"两处数据保持一致"这类 bug 从根上消除。

## 给状态分层：不是所有状态都该进 Provider

最容易犯的错，是把一切都塞进 Provider。我按**变化频率**和**生命周期**两个维度切：

| 状态 | 变化频率 | 是否持久化 | 放哪 |
|------|----------|------------|------|
| 播放队列 / 循环 / 随机 | 低（用户操作才变） | 是 | `NotifierProvider` |
| 均衡器增益 | 中（拖动时变） | 是 | `NotifierProvider` |
| 歌词行偏移 | 低 | 是 | `NotifierProvider` |
| 当前曲目 | 派生 | — | `Provider`（computed） |
| 投屏设备列表 | 低 | 否 | `StreamProvider` |
| 扫描进度 | **高**（每秒多次） | 否 | `AsyncNotifierProvider` **+ 节流** |
| 播放位置（进度条） | **极高**（帧级） | 否 | **不进 Provider**，直连流 |

最后两行是我踩过坑的地方，单独说。

### 高频状态陷阱一：进度条不该 watch Provider

播放位置每秒变化几十次。做成 `StateProvider<Duration>` 再在 Widget 里 `ref.watch`，整棵子树会跟着重建——进度条能动，但整页都在抖。

正确做法是让进度条**自己订阅音频引擎的位置流**，走局部 `setState`，不惊动 Provider 树：

```dart
class _PositionBarState extends State<PositionBar> {
  late final StreamSubscription<Duration> _sub;
  Duration _pos = Duration.zero;

  @override
  void initState() {
    super.initState();
    // 只订阅流，不进 Riverpod —— 时间驱动的状态不该经过 Provider 树
    _sub = audioEngine.positionStream.listen((d) {
      if (mounted) setState(() => _pos = d);
    });
  }

  @override
  void dispose() { _sub.cancel(); super.dispose(); }
}
```

> [!WARNING]
> 判断标准很简单：**一秒内能变好几次的状态，不要放进 Provider。** Provider 适合"用户操作驱动"的状态，不适合"时间驱动"的状态。

### 高频状态陷阱二：扫描进度必须节流

扫描几千首歌时，每扫到一首就 `state = ...`，通知量会爆炸。我按**数量与时间双条件**节流，取先到者：

```dart
void onTrackFound() {
  _sinceEmit++;
  final now = DateTime.now();
  // 双条件节流：够 50 首或过了 200ms 才通知，避免通知风暴
  if (_sinceEmit < 50 &&
      now.difference(_lastEmit) < const Duration(milliseconds: 200)) return;
  _lastEmit = now;
  _sinceEmit = 0;
  state = AsyncData(state.valueOrNull!.copyWith(done: _count));
}
```

## 可测试性：这比"少写代码"更重要

Riverpod 的一个实际好处是 Provider 能脱离 Widget 单独测。用 `ProviderContainer` 直接操作，不需要 `testWidgets`、不需要渲染树：

```dart
test('列表循环时，最后一首的下一首应回到第一首', () {
  final container = ProviderContainer();
  addTearDown(container.dispose);

  final q = container.read(playbackQueueProvider.notifier);
  q.enqueue([trackA, trackB, trackC]);
  q.setLoop(Loop.all);
  q.seek(2); // 停在最后一首

  q.playNext();
  expect(container.read(playbackQueueProvider).index, 0);
  expect(container.read(canSkipNextProvider), isTrue);
});
```

这类测试跑起来是毫秒级。相比之下，靠手动点 UI 验证"最后一首点下一首"这种边界，最容易漏也最耗时。

## 三个真实踩过的坑

1. **在 Provider 里 watch 了高频流**：早期我把 `positionStream` 包成 `StreamProvider` 又在别处 watch，Provider 树每秒重建几十次。定位方式很笨但有效——给 `build` 打日志数调用次数，看谁在疯狂重建。
2. **`autoDispose` 把播放器单例回收了**：播放引擎若挂在 `autoDispose` 的 Provider 上，页面退栈后引擎被回收，声音会突然停。这类**跨页面存活**的对象必须放在不带 `autoDispose` 的顶层 Provider，并在 `ref.onDispose` 里显式释放，别依赖自动回收。
3. **`family` 的参数不稳定**：用 `family` 按曲目取歌词时，若传入每次新建的对象而非 id 字符串，Provider 会每次判定为新参数并重新计算。传**可比较的标量**（String / int），不要传对象。

## 为什么这样好维护

- **编译安全**：Provider 的类型在编译期就定了，拼错字段直接报错
- **可测试**：Notifier 不依赖 Widget，单测直接 `build()` + 调方法 + 断言 `state`
- **细粒度刷新**：只订阅需要的字段，避免无谓重绘
- **单一数据源**：派生状态消除了"两份数据不同步"这一整类 bug

这些规则不是文档教我的，是一个个"页面卡了""声音突然停了""歌词每次都重新加载"之后总结出来的。状态管理真正难的从来不是 API，而是**判断哪些状态该放哪里**。

## 参考来源

1. Riverpod — 官方文档（《Notifier & StateNotifier》与 Testing），https://riverpod.dev/docs ，访问于 2026-09-13。
2. Flutter — 官方文档（状态管理概览），https://docs.flutter.dev/data-and-backend/state-mgmt ，访问于 2026-09-13。
3. Riverpod — GitHub 仓库（async / family / autoDispose 说明），https://github.com/rrousselGit/riverpod ，访问于 2026-09-13。
