---
title: 星璃音乐·体素联机大厅
date: '2026-09-07'
status: published
category: 本地项目
tags:
  - 联机
  - 体素
  - Flutter
  - 一起听
owner: admin
excerpt: 星璃音乐里"一起听 + 体素联机"的客户端栈：WebSocket 长连、UDP 局域网发现、星型房主拓扑，以及"主机即 DJ"的播放跟随。本地优先，不依赖中转也能跑局域网。
---

## 它是什么

这是「星璃·无限音乐画布」里负责**多人同空间**的客户端模块：一个体素世界大厅，朋友们进来后能互见、能聊天、能一起编辑场景，房主播放音乐时其他人自动跟随曲目与进度。它和音乐播放器共享同一套状态，是"可停留的空间"从单人走向多人的一步。

## 协议栈（早已完整）

- **NetNode**：基于 `dart:io` 的 WebSocket 长连，收发 `NetMessage`（JSON 信封，含 `t`/`f`/`to`/`p`）
- **LanDiscovery**：UDP 8767 广播，做局域网内的设备发现，免去手动填地址
- **session_provider**：星型拓扑（房主-客户端），房主即 DJ，通过 `listenState` 广播播放态，客户端 `_applyRemoteListen` 跟随
- **NetMsgType** 关键索引：`edit=5`、`transform=4`、`vitals=6`、`chat=7`、`listenState=8`（一起听）、`requestListen=9`、`editSnapshot=12`

> [!NOTE]
> 设计上把"联机"和"播放"彻底解耦：联机只负责把 `listenState` 这种控制帧同步过去，具体播放由各自客户端本地执行——所以断网也不会让别人的歌停下，只是不再同步。

## 两种连接方式

大厅提供开关：

- **局域网**：直接走 `LanDiscovery` beacon，零配置
- **中转服务器**：连 `ws://<地址>:8765/ws`，跨公网/跨 NAT（见「星璃音乐·中转服务器」项目）

建房后自动复制 6 位房间号，对方填同地址 + 房间号即可加入。

## 为什么本地优先

整个联机栈跑在用户设备上，房间状态不落任何第三方服务器（除非显式接中转）。这意味着一起听是**点对点的陪伴**，没有"云端房间"要维护，也没有数据要上传。

## 参考来源

1. Dart `dart:io` 库 — WebSocket 客户端（NetNode 基于它），https://api.dart.dev/ ，访问于 2026-09-07。
2. WebSocket — MDN Web Docs，https://developer.mozilla.org/en-US/docs/Web/API/WebSocket ，访问于 2026-09-07。
3. 用户数据报协议（UDP）— 维基百科（LanDiscovery 基于 UDP 广播做局域网发现），https://en.wikipedia.org/wiki/User_Datagram_Protocol ，访问于 2026-09-07。
