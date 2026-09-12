---
title: Riverpod 实战：播放队列与多状态管理
date: '2026-09-07'
status: published
category: 工程笔记
tags:
  - Riverpod
  - Flutter
  - 状态管理
  - 播放队列
owner: admin
excerpt: 本地播放器的状态又碎又交叉：队列、循环、均衡器、歌词偏移、扫描进度……记录星璃如何用 Riverpod 把"播放队列"这一类状态收进可测试的 Provider。
cover: /covers/riverpod-playback-queue.svg
---

本地播放器的状态很碎：播放队列、循环模式、均衡器、歌词行偏移、扫描进度、收藏。如果散落在各组件里，维护会失控。继上次聊完"为什么选 Riverpod"，这里落到具体——以**播放队列**为例，看怎么用 Provider 把状态收拢。

## 队列状态长什么样

一个播放队列至少要回答：

- 当前列表有哪些曲子（queue）
- 现在播到第几首（currentIndex）
- 循环模式（none / one / all）
- 随机是否开启（shuffle）
- 播放态（playing / paused / stopped）

这些状态彼此牵连：切随机要重排队列、切循环要改变"下一首"的边界、删除当前曲要修正 `currentIndex`。把它们塞进一个 `PlaybackQueueNotifier`（`StateNotifier` 或 `Notifier`）最自然。

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

## 为什么这样好维护

- **编译安全**：Provider 的类型在编译期就定了，拼错字段直接报错
- **可测试**：Notifier 不依赖 Widget，单测直接 `build()` + 调方法 + 断言 `state`
- **细粒度刷新**：只订阅需要的字段，避免无谓重绘

## 参考来源

1. Riverpod — 官方文档（《Notifier & StateNotifier》），https://riverpod.dev/docs ，访问于 2026-09-07。
2. Flutter — 官方文档（状态管理概览），https://docs.flutter.dev ，访问于 2026-09-07。
