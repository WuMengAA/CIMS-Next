---
title: 给本地站点接上 RSS 与 ClassIsland 播报
date: '2026-09-06'
updated: '2026-09-13'
status: published
category: 工程笔记
tags:
  - RSS
  - ClassIsland
  - SvelteKit
  - 播报
  - 自托管
owner: admin
excerpt: 怎么让一个自托管内容站点既输出标准 RSS 2.0，又能被 ClassIsland 当作信息屏的公告源拉取播报？记录两种格式的对接实现、一份内容两种视图的架构，以及 XML 转义、RFC 822 时区、guid 稳定性这些联调时才暴露的坑。
cover: /covers/rss-classisland-broadcast.svg
---

我的站点「Stelarith」是一个自托管的内容平台。除了正常的博客订阅，我还想让它**直接驱动一块信息屏**——用 ClassIsland 把站点公告、新文章、聚合新闻推送到桌面大屏。这就涉及两套格式：标准 RSS 2.0，和 ClassIsland 的 Web 公告源。

## 先输出标准 RSS 2.0

RSS 2.0 是博客最通用的订阅格式，规范由 RSS Advisory Board 维护 [1]。一个合法的 `rss` 根节点下挂一个 `channel`，`channel` 里放站点元信息，`item` 则是每篇文章：标题、链接、描述、发布时间（`pubDate`，**RFC 822 格式**）、分类（`category`）。

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

在 SvelteKit 里用一个 `+server.ts` 路由直接生成 [2]：

```ts
// src/routes/rss.xml/+server.ts
import { listItems } from '$lib/server/content-store';

export const GET = async () => {
  const posts = listItems('posts').filter((p) => p.status === 'published');

  const items = posts.map((p) => `
    <item>
      <title>${escapeXml(p.title)}</title>
      <link>${SITE_URL}/posts/${p.slug}</link>
      <guid isPermaLink="true">${SITE_URL}/posts/${p.slug}</guid>
      <pubDate>${new Date(p.date).toUTCString()}</pubDate>
      <description>${escapeXml(p.excerpt ?? '')}</description>
    </item>`).join('');

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
     <rss version="2.0"><channel>
       <title>Stelarith</title>
       <link>${SITE_URL}</link>
       <description>星璃的内容平台</description>
       ${items}
     </channel></rss>`,
    { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } },
  );
};
```

## 再对接 ClassIsland 的 Web 公告源

ClassIsland 是开源的校园信息屏 / 播报工具 [3]。它的「Web 公告」提供方会向一个 URL 拉取 JSON，期望顶层是一个 `announcements` 数组：

| 字段 | 含义 |
|------|------|
| `guid` | 唯一标识，**必须稳定**，否则会被当成新公告重复播报 |
| `summary` | 摘要，屏上大字显示 |
| `details` | 详情正文 |
| `severity` | 整数：`0` 一般 / `1` 重要 / `2` 紧急 |
| `startTime` / `endTime` | 生效时间窗，ISO 8601 |

```json
{
  "announcements": [
    {
      "guid": "post:relay-protocol-design",
      "summary": "新文章：设计一套极简联机协议",
      "details": "星型房主拓扑、JSON 信封、主机即 DJ……",
      "severity": 0,
      "startTime": "2026-09-13T00:00:00+08:00",
      "endTime": "2026-09-14T00:00:00+08:00"
    }
  ]
}
```

映射规则我是这么定的：**公告本身 severity 高（1~2），新文章与聚合新闻 severity 低（0）**，时间窗统一给到未来 24 小时。原则是——能被当成"通知"的才提高紧急度，日常内容一律最低，否则信息屏会变成噪音源。

> [!TIP]
> 端点地址填：`https://你的域名/api/classisland/announcements`。加 `?refresh=1` 可强制重新聚合新闻缓存。

## 架构：一份内容，两种视图

关键设计是：**文章、公告、新闻都来自同一个内容层**，RSS 和 ClassIsland 只是两种序列化视图。

```
content/  ──►  content-store（唯一内容层）
                  ├──► /rss.xml                        (RSS 2.0 视图)
                  ├──► /api/classisland/announcements  (JSON 视图)
                  └──► 站点页面                        (HTML 视图)
```

这样维护一份内容，既能被订阅器读，也能被信息屏读，不用各写一套。新增一种输出格式时，只需要加一个序列化函数，不动内容层。

## 五个真实踩过的坑

1. **XML 没转义导致订阅源整个失效**：标题里出现 `&`、`<` 会破坏 XML 结构，订阅器直接报"解析失败"。所有插入 XML 的文本**必须转义**，含特殊字符的正文用 `CDATA` 包裹。这是最容易漏、后果最严重的一条。
2. **`pubDate` 时区写错**：RSS 要求 RFC 822 格式（如 `Mon, 07 Sep 2026 00:00:00 GMT`）。用 `toISOString()` 生成的是 ISO 8601，部分严格的阅读器会拒绝。直接 `new Date(x).toUTCString()` 最省心。
3. **`guid` 不稳定导致重复播报**：早期 guid 用数组下标生成，内容顺序一变 guid 就变，ClassIsland 把同一条公告当成新公告反复播报。**guid 必须绑定到内容本身的稳定标识**（如 slug 或数据库主键）。
4. **缓存让调试变得迷惑**：新闻聚合有缓存，改了内容却不刷新，容易误判成"代码没生效"。加了 `?refresh=1` 强制刷新后定位问题快了很多——**任何有缓存的接口都应该留一个强制刷新开关**。
5. **自托管站点的可达性问题**：ClassIsland 在信息屏那台机器上拉数据，站点必须对它可达。本地自托管时要么走内网 IP，要么需要公网可达；HTTPS 证书也要有效，自签证书会被拒绝且**报错信息很不明显**。

## 联调方法

排查这类"另一端静默失败"的问题，最有效的还是直接模拟对方的请求：

```bash
# 1. 先看 RSS 是否合法 XML
curl -s https://你的域名/rss.xml | xmllint --noout - && echo "XML OK"

# 2. 再看公告源 JSON 结构
curl -s https://你的域名/api/classisland/announcements | jq '.announcements | length'

# 3. 强制刷新缓存后再验一次
curl -s "https://你的域名/api/classisland/announcements?refresh=1" | jq '.announcements[0]'
```

> [!IMPORTANT]
> 对接外部消费方时，**永远先用 curl 模拟对方的请求**再去看 UI。信息屏、订阅器这类客户端失败时往往什么都不显示，靠肉眼观察界面是查不出原因的。

## 参考来源

1. RSS 2.0 Specification — RSS Advisory Board，https://www.rssboard.org/rss-specification ，访问于 2026-09-13。
2. SvelteKit 文档 — 《Endpoints（+server.ts）》，https://kit.svelte.dev/docs/routing#server ，访问于 2026-09-13。
3. ClassIsland — GitHub 仓库（开源校园信息屏），https://github.com/ClassIsland/ClassIsland ，访问于 2026-09-13。
4. RFC 822 — Standard for ARPA Internet Text Messages（`pubDate` 日期格式来源），https://datatracker.ietf.org/doc/html/rfc822 ，访问于 2026-09-13。
