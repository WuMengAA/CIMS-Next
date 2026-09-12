---
title: Stelarith 内容平台
date: '2026-09-06'
updated: '2026-09-13'
status: published
category: 云端项目
tags:
  - SvelteKit
  - 多用户
  - 内容平台
  - 自托管
owner: admin
siteUrl: https://www.245959623.xyz
excerpt: 支撑本站的多用户内容平台。博客、项目、文档、论坛、公告、反馈、友链、归档一应俱全，并自带新闻聚合、RSS 订阅与 ClassIsland 播报——文件式存储，无需数据库即可运行。
---

## 它是什么

Stelarith 是支撑本站的**多用户内容平台**，用 SvelteKit 构建、adapter-node 部署、文件式存储（无需数据库即可运行）。它把"写文章、发项目、建文档、开论坛"收进同一个后台，并为管理员提供审核、友链认证、归档回滚等能力。

> [!NOTE]
> "文件式存储"是刻意的取舍：内容就是磁盘上的 Markdown 文件，备份等于复制目录，迁移等于换路径，出问题可以直接 `cat`。代价是并发写入需要自己处理，换来的是**不依赖任何数据库服务**。

## 模块地图

| 模块 | 能力 |
|------|------|
| 博客 / 项目 / 文档 | 三类内容各自的列表与专页，支持多作者、标签、分类 |
| 论坛 | 用户自由发帖、自建频道，支持置顶 / 锁定 / 删除 |
| 公告 / 反馈 | 类 GitHub Issue 的反馈系统 + 站点公告 |
| 友链 | 可申请站长认证，认证后显示徽章 |
| 归档 | 版本快照与一键回滚，保留历史痕迹 |
| 新闻 / RSS / 播报 | 聚合新闻源、输出 RSS 2.0、对接 ClassIsland 信息屏 |

## 技术要点

| 层面 | 做法 |
|------|------|
| 渲染 | 服务端 `load` 保证 SSR 与 SEO；文件路由 + `+server.ts` 提供 API |
| 权限 | 矩阵区分 `admin / editor / moderator / user`，**敏感操作一律服务端校验** |
| 内容 | Markdown + frontmatter，改完即时生效（运行时读取，无需重新构建） |
| Markdown | 自实现扩展：callout、`==高亮==`、上标下标、任务列表、KaTeX、脚注 |
| 设计 | 克制的暗色规范，最大宽度 1400px，字重不过载 |

内容改完**不需要重新构建**是这套架构最顺手的一点：编辑 Markdown 存盘，刷新页面就能看到结果。迭代内容时省掉了整个构建环节。

## 部署与运维

平台跑在 Windows 上，由计划任务托管开机自启：

```
计划任务 StelarithServer（SYSTEM / 开机触发）
   └── run-prod.bat（守护循环）
         └── node -r D:\Stelarith\loadenv.cjs build/index.js
```

守护脚本负责三件事：启动前释放端口上的残留监听、node 崩溃后自动拉起、失败退避避免空转刷日志。环境变量由 `loadenv.cjs` 统一注入，避免 Windows 计划任务环境下变量丢失。

> [!WARNING]
> 运维上有两个坑值得记：一是计划任务默认有 **72 小时执行时限**，跑满会被系统掐掉，必须显式设为无限；二是 Windows 批处理里**裸 `|` 会被 cmd 当成管道符**，写进 `echo` 行会让整个脚本以 255 静默失败——这类错误既不报错也不写日志，最难查。

## 当前状态

持续迭代中。RSS 与 ClassIsland 播报已上线，多用户门控与基础社区功能已就绪，统一审核台与文件管理在路线图上。内容体系（博客 / 项目 / 文档）正在持续填充与深化。

## 参考来源

1. RSS 2.0 Specification — RSS Advisory Board，https://www.rssboard.org/rss-specification ，访问于 2026-09-13。
2. ClassIsland — GitHub 仓库，https://github.com/ClassIsland/ClassIsland ，访问于 2026-09-13。
3. SvelteKit 文档 — https://kit.svelte.dev ，访问于 2026-09-13。
4. Node.js 文档 — adapter-node 部署说明，https://kit.svelte.dev/docs/adapter-node ，访问于 2026-09-13。
