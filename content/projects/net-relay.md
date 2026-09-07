---
title: 星璃音乐·中转服务器
date: '2026-09-07'
status: published
category: 本地项目
tags:
  - 中继
  - WebSocket
  - 联机
  - 一起听
owner: admin
excerpt: 让「星璃·无限音乐画布」跨公网、跨 NAT 也能一起听、能联机的中转服务器。一个协议复用的房间感知扇出器，本机常驻、开机自启。
---

## 它解决什么问题

星璃音乐的客户端联机栈（`NetNode` / `LanDiscovery` / `session_provider`）一开始只跑局域网：同一台路由器下能互相发现、能一起听。但一旦跨公网、跨 NAT，纯局域网方案就够不着了。中转服务器（net-relay）的作用，是把"局域网里能做的事"延伸到公网——**不重写客户端协议，只补一个协议复用的房间感知扇出器**。

> [!NOTE]
> 瓶颈从来不是客户端没实现联机，而是 NAT 不可达。所以中转服务器做得很薄：它严格按客户端既有的 `NetMessage` 形状路由，客户端几乎零改动就能跨网。

## 它是什么

一个常驻在本机的 Node 服务，绑定 `0.0.0.0:8765`，对外暴露 WebSocket 端点 `/ws`。内部逻辑很简单：

- 维护房间（room）与成员（按 `localId` 区分）
- 收到消息看 `to` 字段：有 `to` 就定向投递给指定成员，没有就广播给同房其他成员
- 处理控制帧 `ctl:join / ready / peerJoin / peerLeave / ping`，维护房间拓扑
- 来源自环过滤：自己发的消息不会回显给自己

关键是它**完全复用客户端的消息信封**（`NetMessage`：JSON，含 `t`/`f`/`to`/`p`），所以"一起听"广播（`listenState`）、体素编辑（`edit`）、聊天（`chat`）都能原样透传，无需任何转换层。

## 怎么跑起来

```bash
# 绑定 0.0.0.0 让 localhost + 本机 LAN + 局域网设备都能连
HOST=0.0.0.0 PORT=8765 node index.js
```

为免后台进程随会话退出，已落地 `start_relay.bat` + Windows 计划任务 `XingliRelay`（开机自启、`RestartCount=3` / 1min、不抢占已运行实例），重启后由计划任务接管。

## 验证层次

不做"看起来能连"就完事，分三层验证：

1. **协议层**：自带测试服跑 16 项断言（ready / peerJoin / peerLeave / 广播 / 定向 / 自环过滤），期望 16/16
2. **运行时**：`/healthz` 在 `127.0.0.1` 与本机 LAN IP 双地址探针均 `{"ok":true}`
3. **特性层**：临时脚本连真实实例，断言 `listenState`/`edit`/`chat` 透传 + 自环过滤 + 定向 + `peerLeave`，跑完即删

三层全过，才敢交付双设备真机联调步骤。

## 参考来源

1. WebSocket — MDN Web Docs（客户端联机栈基于 WebSocket），https://developer.mozilla.org/en-US/docs/Web/API/WebSocket ，访问于 2026-09-07。
2. RFC 6455 — The WebSocket Protocol（IETF 标准），https://datatracker.ietf.org/doc/html/rfc6455 ，访问于 2026-09-07。
3. Dart `dart:io` 库 — WebSocket 客户端实现（NetNode 基于它），https://api.dart.dev/ ，访问于 2026-09-07。
