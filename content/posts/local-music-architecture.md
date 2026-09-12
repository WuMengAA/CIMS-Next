---
title: 本地音乐播放器的架构选型：为什么是 Flutter + Riverpod
date: '2026-09-07'
status: published
pinned: true
category: 工程笔记
tags:
  - Flutter
  - Riverpod
  - 音频
  - 架构
owner: admin
excerpt: 做一款"会思考"的本地音乐播放器，技术栈怎么选？从跨平台、状态管理到音频解码引擎，记录星璃·无限音乐画布的选型理由与权衡。
cover: /covers/local-music-architecture.svg
---

做一款本地音乐播放器，和做一款在线音乐 App 是两回事。本地播放器的核心约束是：**文件在用户硬盘上、离线可用、不依赖任何云端服务**，同时还要在 Windows / macOS / Linux / Android / iOS 上表现一致。下面记录我在「星璃·无限音乐画布」上的技术选型与理由。

## 为什么用 Flutter 而不是各平台原生

跨平台是硬需求。如果每个平台各写一套 UI 和播放逻辑，维护成本会爆炸。Flutter 用 Dart 单一代码库编译到六个平台，且自带 Skia / Impeller 渲染引擎，UI 表现不依赖系统控件，正好匹配我想要的"体素世界背景 + 液态玻璃"这种高度定制的视觉^[1]^。

> [!NOTE]
> Flutter 的取舍：牺牲了部分平台原生"手感"，换来了视觉与交互的完全可控。对一款以"沉浸体验"为卖点的播放器，这笔交易是划算的。

## 状态管理为什么落在 Riverpod

本地播放器的状态很碎：播放队列、循环模式、均衡器、歌词行偏移、扫描进度、收藏……如果散落在各个组件里会难以维护。Riverpod 提供编译期安全的依赖注入与可被测试 Provider，配合 `ref.watch` 的细粒度刷新，比传统的 `setState` 或 `InheritedWidget` 更适合这种"多状态交叉"的场景^[2]^。

## 音频解码引擎：media_kit 与 just_audio 的取舍

这是最关键的一处选型。两个库代表了两条路线：

- **media_kit**：底层封装 libmpv，几乎支持所有音频/视频格式与无损编码（FLAC、DSD、APE 等），解码能力最强^[3]^。
- **just_audio**：用各平台原生解码器（AVPlayer / MediaPlayer / ExoPlayer）实现，包体更小、更"原生"，但格式支持受平台限制，且高级特性（如精准 seek、外接设备路由）要配合 `audio_session` 等补件^[4]^。

我做本地播放器，用户硬盘里什么格式都有，所以选了 **media_kit** 作为主引擎——它能直接啃下冷门无损格式，省去"为什么这首歌放不了"的客服噩梦。

## 本地数据落在 SQFlite

曲库、播放列表、收藏、扫描缓存都是结构化数据，用 SQLite 封装 SQFlite 持久化最稳，查询也快^[5]^。配合后台 isolate 做文件扫描，避免阻塞 UI 线程。

## 小结

| 关注点 | 选型 | 理由 |
|------|------|------|
| UI 框架 | Flutter | 跨平台 + 视觉可控 |
| 状态管理 | Riverpod | 编译安全 + 可测试 |
| 音频引擎 | media_kit | 全格式解码 |
| 本地存储 | SQFlite | 结构化 + 快 |

选型没有银弹，只有约束。先把"本地、离线、全格式、跨平台"这几条钉死，技术栈自然就收敛了。

## 参考来源

1. Flutter 官方文档 — 《Flutter 框架概览》，https://docs.flutter.dev ，访问于 2026-09-07。
2. Riverpod 官方文档 — 《Introduction》，https://riverpod.dev/docs ，访问于 2026-09-07。
3. media_kit — GitHub 仓库（基于 libmpv 的跨平台媒体播放库），https://github.com/media-kit/media-kit ，访问于 2026-09-07。
4. just_audio — Ryan Heise，GitHub 仓库，https://github.com/ryanheise/just_audio ，访问于 2026-09-07。
5. SQFlite — TekArtik，GitHub 仓库（Flutter SQLite 插件），https://github.com/tekartik/sqflite ，访问于 2026-09-07。
