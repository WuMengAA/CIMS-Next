---
title: 星璃公告广播网关
date: '2026-09-07'
status: published
category: 云端项目
tags:
  - 播报
  - ClassIsland
  - RSS
  - 信息屏
owner: admin
excerpt: 把站点公告、新文章、聚合新闻合成一份 ClassIsland Web 公告源，推送到桌面信息屏。一份内容，两种序列化视图：RSS 给订阅器，播报给大屏。
---

## 它是什么

「星璃公告广播网关」是 Stelarith 平台对外暴露的一个**云端端点**：`https://你的域名/api/classisland/announcements`。它把站内的"公告 + 新文章 + 聚合新闻"合成一份 ClassIsland 能直接拉取的 Web 公告源，让一块信息屏自动播报站点动态。

## 它怎么工作

ClassIsland 是开源的校园信息屏 / 播报工具，它的「Web 公告」提供方会向一个 URL 拉取 JSON，期望顶层是 `announcements` 数组，每条含 `guid`、`summary`、`details`、`severity`、`startTime`、`endTime`；`severity` 用整数表示一般(0)/重要(1)/紧急(2)。

网关做的事：

1. 聚合三类内容——站点公告、最新博客、RSS 聚合来的新闻
2. 映射到 ClassIsland 的 `announcements` 结构：公告 severity 高一些，新闻低一些，时间窗口给到未来 24 小时
3. 输出 JSON；加 `?refresh=1` 可强制重新聚合新闻缓存

## 与 RSS 的关系

RSS 2.0 和 ClassIsland 播报是**同一个内容层的两种序列化视图**：订阅器读 XML，信息屏读 JSON。维护一份内容，两种出口都覆盖，不用各写一套。

## 参考来源

1. ClassIsland — GitHub 仓库（开源校园信息屏），https://github.com/ClassIsland/ClassIsland ，访问于 2026-09-07。
2. RSS 2.0 Specification — RSS Advisory Board，https://www.rssboard.org/rss-specification ，访问于 2026-09-07。
