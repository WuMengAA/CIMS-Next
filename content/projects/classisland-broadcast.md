---
title: 星璃公告广播网关
date: '2026-09-07'
updated: '2026-09-13'
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

「星璃公告广播网关」是 Stelarith 平台对外暴露的一个端点：`https://你的域名/api/classisland/announcements`。它把站内的"公告 + 新文章 + 聚合新闻"合成一份 ClassIsland 能直接拉取的 Web 公告源，让一块信息屏自动播报站点动态。

## 它怎么工作

ClassIsland 是开源的校园信息屏 / 播报工具。它的「Web 公告」提供方会向一个 URL 拉取 JSON，期望顶层是 `announcements` 数组，每条含 `guid`、`summary`、`details`、`severity`、`startTime`、`endTime`。

网关做的事：

1. 聚合三类内容——站点公告、最新博客、RSS 聚合来的新闻
2. 映射到 ClassIsland 的 `announcements` 结构，时间窗口给到未来 24 小时
3. 输出 JSON；加 `?refresh=1` 可强制重新聚合新闻缓存

## 字段与 severity 映射

| 字段 | 含义 |
|------|------|
| `guid` | 唯一标识，**必须稳定**，否则会被当成新公告重复播报 |
| `summary` | 摘要，屏上大字显示 |
| `details` | 详情正文 |
| `severity` | `0` 一般 / `1` 重要 / `2` 紧急 |
| `startTime` / `endTime` | 生效时间窗（ISO 8601） |

映射规则：

| 来源 | severity | 理由 |
|------|----------|------|
| 站点公告 | 1 ~ 2 | 本来就是"通知"，该被看见 |
| 新文章 | 0 | 日常更新，不该打断 |
| 聚合新闻 | 0 | 背景信息，不是行动项 |

> [!TIP]
> 原则很简单：**能被当成"通知"的才提高紧急度，日常内容一律最低。** 否则信息屏很快就会变成噪音源——而人对噪音的反应是整体忽略它，包括真正重要的那几条。

## 与 RSS 的关系

RSS 2.0 和 ClassIsland 播报是**同一个内容层的两种序列化视图**：订阅器读 XML，信息屏读 JSON。维护一份内容，两种出口都覆盖，不用各写一套。

```
内容层 ──► /rss.xml                       （XML 视图，给订阅器）
      └──► /api/classisland/announcements （JSON 视图，给信息屏）
```

## 联调与排错

对接外部消费方时，最有效的办法是**直接模拟对方的请求**——信息屏这类客户端失败时往往什么都不显示，靠看界面查不出原因：

```bash
# 看公告条数
curl -s https://你的域名/api/classisland/announcements | jq '.announcements | length'

# 强制刷新缓存后再验一次
curl -s "https://你的域名/api/classisland/announcements?refresh=1" | jq '.announcements[0]'
```

三个最容易踩的坑：

1. **`guid` 不稳定**——用数组下标或时间戳生成 guid，内容顺序一变就被判为新公告，反复播报。guid 必须绑定到内容本身的稳定标识（slug 或主键）。
2. **缓存掩盖了改动**——改了内容却不刷新，容易误判成"代码没生效"。任何有缓存的接口都该留一个强制刷新开关。
3. **站点对信息屏不可达**——信息屏在另一台机器上拉数据，站点的协议、端口、证书都要对它有效。自签证书会被拒绝，且**报错很不明显**。

## 参考来源

1. ClassIsland — GitHub 仓库（开源校园信息屏），https://github.com/ClassIsland/ClassIsland ，访问于 2026-09-13。
2. RSS 2.0 Specification — RSS Advisory Board，https://www.rssboard.org/rss-specification ，访问于 2026-09-13。
