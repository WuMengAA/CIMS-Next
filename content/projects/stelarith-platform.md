---
title: Stelarith 内容平台
date: '2026-09-06'
status: published
category: 云端项目
tags:
  - SvelteKit
  - 多用户
  - 内容平台
  - 自托管
owner: admin
siteUrl: https://www.245959623.xyz
excerpt: 支撑本站的多用户内容平台。博客、项目、文档、论坛、公告、反馈、友链、归档一应俱全，并自带新闻聚合、RSS 订阅与 ClassIsland 播报能力。
---

## 它是什么

Stelarith 是支撑本站的**多用户内容平台**，用 SvelteKit 构建、adapter-node 部署、文件式存储（无需数据库即可运行）。它把"写文章、发项目、建文档、开论坛"收进同一个后台，并为管理员提供审核、友链认证、归档回滚等能力。

## 模块地图

- **博客 / 项目 / 文档**：三类内容各自的列表与专页，支持多作者、标签、分类
- **论坛**：用户自由发帖、自建频道，支持置顶 / 锁定 / 删除
- **公告 / 反馈**：类 GitHub Issue 的反馈系统 + 站点公告
- **友链**：可申请站长认证，认证后显示徽章
- **归档**：版本快照与一键回滚，保留历史痕迹
- **新闻 / RSS / 播报**：聚合知名新闻源、输出 RSS、对接 ClassIsland 信息屏^[1]^^[2]^

## 技术要点

- 服务端 `load` 保证 SSR 与 SEO，文件路由 + `+server.ts` 提供 API
- 权限矩阵区分 `admin / editor / moderator / user`，敏感操作服务端校验
- 设计遵循克制的暗色规范，最大宽度 1400px，字重不过载^[3]^

## 当前状态

持续迭代中。RSS 与 ClassIsland 播报已上线，多用户门控与基础社区功能已就绪，统一审核台与文件管理在路线图上。

## 参考来源

1. RSS 2.0 Specification — RSS Advisory Board，https://www.rssboard.org/rss-specification ，访问于 2026-09-06。
2. ClassIsland — GitHub 仓库，https://github.com/ClassIsland/ClassIsland ，访问于 2026-09-06。
3. SvelteKit 文档 — https://kit.svelte.dev ，访问于 2026-09-06。
