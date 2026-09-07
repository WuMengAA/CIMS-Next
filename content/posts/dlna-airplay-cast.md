---
title: DLNA / AirPlay 投屏：把本地音乐推到音箱
date: '2026-09-07'
status: published
category: 工程笔记
tags:
  - DLNA
  - AirPlay
  - 投屏
  - 音频
owner: admin
excerpt: 本地播放器不该被束缚在耳机里。记录星璃怎么用 DLNA（UPnP AV）把音乐推到客厅音箱，用 AirPlay 推到 Apple 设备——两种协议，一个目标：让音乐走出屏幕。
---

大多数本地播放器只在自己窗口里出声。但用户的音箱在客厅、在书房的 HomePod、在书架上那台老功放。把音乐"推"过去，体验才完整。星璃做了两条投屏路线：DLNA 和 AirPlay。

## DLNA：安卓 / 智能音箱的通用语

DLNA 基于 UPnP 架构，本质是一套设备发现 + 媒体控制 + 传输的协议族。播放器在局域网里发现支持 DLNA 的渲染设备（renderer），把当前曲目作为网络资源交给它播放，自己退居"遥控器"角色——进度、音量、上下首都通过控制协议回传。

> [!NOTE]
> DLNA 的好处是覆盖面广：大量安卓电视、智能音箱、部分功放都自带 DLNA 渲染能力，几乎零配置就能用。代价是各厂商实现参差，握手细节要容错。

## AirPlay：Apple 生态的无线音频

AirPlay 是 Apple 的无线流媒体协议，能在 Apple 设备间把音频推到 Apple TV、HomePod 或支持 AirPlay 的扬声器。在 Apple 平台原生框架（AVFoundation + AVKit）里，AirPlay 是内建能力——只要把媒体路由交给系统，系统就会在控制器里提供 AirPlay 选择器。

投屏的目标从来不是"多一个按钮"，而是让音乐**脱离屏幕存在**：你关掉 App、锁屏、去倒杯水，歌还在音箱里响着。

## 两条路线的取舍

| 路线 | 覆盖 | 实现 |
|------|------|------|
| DLNA / UPnP AV | 安卓、智能音箱、部分功放 | 局域网发现 + 控制协议 |
| AirPlay | Apple 设备 | 系统原生框架 |

它们不互斥：星璃按平台能力同时暴露两种出口，用户选手边最方便的那台设备。

## 参考来源

1. DLNA — Digital Living Network Alliance（DLNA 标准概览），https://en.wikipedia.org/wiki/Digital_Living_Network_Alliance ，访问于 2026-09-07。
2. UPnP — Open Connectivity Foundation（UPnP AV 架构，DLNA 的传输底座），https://openconnectivity.org/ ，访问于 2026-09-07。
3. AirPlay — Apple 开发者文档（Streaming and AirPlay），https://developer.apple.com/airplay ，访问于 2026-09-07。
