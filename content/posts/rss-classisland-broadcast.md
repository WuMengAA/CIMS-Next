---
title: 给本地站点接上 RSS 与 ClassIsland 播报
date: '2026-09-06'
status: published
category: 工程笔记
tags:
  - RSS
  - ClassIsland
  - SvelteKit
  - 播报
owner: admin
excerpt: 怎么让一个本地内容站点既输出标准 RSS 订阅源，又能被 ClassIsland 当作校园信息屏的公告源拉取播报？记录 RSS 2.0 规范与 ClassIsland Web 公告格式的对接实践。
cover: /covers/rss-classisland-broadcast.svg
---

我的站点「Stelarith」是一个本地自托管的内容平台。除了正常的博客订阅，我还想让它**直接驱动一块信息屏**——用 ClassIsland 把站点公告、新文章、聚合新闻推送到桌面大屏。这就涉及两套格式：标准 RSS 2.0，和 ClassIsland 的 Web 公告源。

## 先输出标准 RSS 2.0

RSS 2.0 是站内博客最通用的订阅格式，规范由 RSS Advisory Board 维护。一个合法的 `rss` 根节点下挂一个 `channel`，`channel` 里有站点元信息，`item` 则是每篇文章：标题、链接、描述、发布时间（`pubDate`，RFC 822 格式）、分类（`category`）^[1]^。

```xml
<rss version="2.0">
  <channel>
    <title>Stelarith</title>
    <link>https://www.245959623.xyz</link>
    <description>星璃的内容平台</description>
    <item>
      <title>示例文章</title>
      <link>https://www.245959623.xyz/posts/xxx</link>
      <pubDate>Mon, 07 Sep 2026 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>
```

我在 SvelteKit 里用一个 `+server.ts` 路由直接生成这段 XML，作者字段取自建站时的 `owner`，保证订阅器能正确归类来源^[2]^。

## 再对接 ClassIsland 的 Web 公告源

ClassIsland 是开源的校园信息屏/播报工具。它的「Web 公告」提供方会向一个 URL 拉取 JSON，期望顶层是一个 `announcements` 数组，每条包含 `guid`、`summary`、`details`、`severity`、`startTime`、`endTime` 等字段；`severity` 用整数表示一般(0)/重要(1)/紧急(2)^[3]^。

我把"公告 + 新文章 + 聚合新闻"合成播报条目，映射到这个结构：公告本身 severity 高一些，新闻 severity 低一些，时间窗口给到未来 24 小时。ClassIsland 拉到后就会以桌面提醒形式播报出来。

> [!TIP]
> 端点地址填：`https://你的域名/api/classisland/announcements`。加 `?refresh=1` 可强制重新聚合新闻缓存。

## 两套格式共享一份内容

关键设计是：**文章、公告、新闻都来自同一个内容层**，RSS 和 ClassIsland 只是两种序列化视图。这样维护一份内容，既能被订阅器读，也能被信息屏读，不用各写一套。

## 参考来源

1. RSS 2.0 Specification — RSS Advisory Board，https://www.rssboard.org/rss-specification ，访问于 2026-09-06。
2. SvelteKit 文档 — 《Endpoints（+server.ts）》，https://kit.svelte.dev/docs/routing#server ，访问于 2026-09-06。
3. ClassIsland — GitHub 仓库（开源校园信息屏），https://github.com/ClassIsland/ClassIsland ，访问于 2026-09-06。
