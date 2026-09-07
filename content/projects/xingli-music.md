---
title: 星璃·无限音乐画布
date: '2026-09-07'
status: published
category: 活跃项目
tags:
  - Flutter
  - 音乐
  - 本地应用
  - 跨平台
owner: admin
siteUrl: https://www.245959623.xyz
excerpt: 一款"会思考"的本地音乐播放器。算法与小模型驱动，核心理念是"可停留的空间"——音乐为主，视觉与音效为辅，给你一个愿意多待一会儿的地方。
---

## 它是什么

星璃·无限音乐画布是一款**本地音乐播放器**，不依赖任何云端服务。你的文件留在你的硬盘上，离线也能听。它"会思考"的地方在于：用算法和小模型做智能策展——自动整理曲库、按场景推荐歌单、理解你当下的听歌节奏。

> [!NOTE]
> 核心理念是「可停留的空间」。播放器不该只是工具，而该是一个能安静陪伴你的地方。

## 技术栈

- **Flutter + Dart**：单一代码库跨 Windows / macOS / Linux / Android / iOS，视觉完全自定义^[1]^
- **Riverpod**：编译安全的状态管理，应对播放队列、循环、均衡器等多状态交叉^[2]^
- **media_kit**：基于 libmpv 的音频引擎，啃得下 FLAC / DSD / APE 等冷门无损格式^[3]^
- **SQFlite**：SQLite 封装，持久化曲库、歌单与收藏^[4]^

## 已实现 / 规划中的能力

- 文件扫描与元数据刮削（文件名匹配 + 音频指纹 + CUE 分轨）
- Apple Music 风格逐字歌词
- DLNA / AirPlay 投屏
- 体素世界背景 + 白噪音叠加 + 空间音效
- 小模型驱动的本地歌单策展

## 明确的边界

| 不做 | 原因 |
|------|------|
| 社交评论 | 本地工具，不做社区 |
| 云端推荐 | 不收集用户数据 |
| Hi-Fi 玄学 | 以听感与体验为准，不炒器材 |

## 参考来源

1. Flutter 官方文档 — https://docs.flutter.dev ，访问于 2026-09-07。
2. Riverpod 官方文档 — https://riverpod.dev/docs ，访问于 2026-09-07。
3. media_kit — GitHub 仓库，https://github.com/media-kit/media-kit ，访问于 2026-09-07。
4. SQFlite — GitHub 仓库，https://github.com/tekartik/sqflite ，访问于 2026-09-07。
