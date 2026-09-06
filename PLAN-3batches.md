# 星璃站点功能升级 · 三批实施计划（功能篇）

> 目标：从「个人博客」升级为「多用户内容平台」。评论/公告/反馈/权限矩阵已落地，本计划补齐其余子系统，分三批交付，每批 `vite build` 0 error + 冒烟测试通过。

## 架构基线（已确立，必须遵守）
- 纯文件存储，无外部 DB；运行数据在 `content/*.json`、源文在 `content/{posts,projects,docs}/*.md`。
- 权限矩阵 `can(role, action)`（`src/lib/permissions.ts`）：角色 `admin | editor | moderator | user`。
- 所有公开页数据走 `+page.server.ts` 的 `load`（SSR/SEO 友好），**禁止** `onMount` 内 `fetch` 取内容。
- 后台沿用 Shadcn Sidebar + TanStack Table 范式；API 用 `json()` + `verifyToken`。
- 服务运行：`PORT=8090 node build/index.js`；构建 `node node_modules/vite/bin/vite.js build`。

## 已完成（本会话）
- 权限矩阵 + 角色扩展（admin/editor/moderator/user）
- 评论：API（防垃圾/限频）+ 通用组件 + posts/docs/projects 嵌入 + 后台审核
- 公告：数据 + API + 全局横幅 + 列表页 + 后台 CRUD
- 反馈：数据 + API + 列表/提交/详情页 + 后台状态流转/官方回复
- 前台 nav、后台侧边栏、仪表盘统计接入上述模块

---

## 批次一：内容 & 社区地基（先做，撑起其余批次）
**1. 文章完整支持 + 多用户上传**
- frontmatter 扩展：`author`（用户名）、`coverImage`、`summary`、`updatedAt`（git log 取最后修改时间，构建期注入）。
- 作者主页 `/u/[username]`：资料卡（昵称/角色/简介/注册日）+ 其文章/项目/文档列表。
- 流量统计：内存计数 + 落盘 `content/stats.json`（按 slug 的 PV、近 7 日序列）；详情页 `load` 自增 PV（登录态不计自身）。
- SEO 强化：三个详情页 `<svelte:head>` 动态 `title`/`description`/`og:title`/`og:description`/`og:image`（封面或默认卡 1200x630）。

**2. 项目多用户 + 申请软件专页**
- 项目加 `owner` 字段；登录用户可提交「软件专页申请」`/apply/project`（名称/简介/仓库/官网/分类）。
- 存 `content/project-applications.json`，进审核队列；管理员后台通过→生成 `status: published` 专页。

**3. 文档用户纠正**
- 文档详情页「纠错」按钮 → 提交建议文本/替换片段 → 存 `content/doc-corrections.json`。
- 后台 `/admin/doc-corrections` 审核，采纳后改写源 md 并写归档。

**批次一验收**：build 0 error；作者页可访问；PV 自增；项目申请进队列；文档纠错进队列；未登录态入口隐藏。

---

## 批次二：社交 & 论坛 & 归档
**1. 论坛**
- 模型 `ForumChannel` / `ForumThread` / `ForumPost`。
- 路由 `/forum`、`/forum/[channel]`、`/forum/[channel]/[thread]`（详情+回复）。
- 用户自由发帖；建频道需 `moderate` 或审核；后台 `/admin/forum` 置顶/锁定/删除。

**2. 友链 + 站长认证**
- `/links` 展示认证徽章（verified）；申请页补「站长认证」字段（所有权证明）。
- 审核通过打 `verified: true`。

**3. 归档系统**
- 版本快照：保存文章/项目/文档时写 diff 到 `content/archive/[type]/[slug].jsonl`。
- `/archive` 浏览历史版本、查看、回滚。

**批次二验收**：论坛可发帖/建频道；友链认证流程通；归档可回滚；后台页 200。

---

## 批次三：全能后台（审核 / 文件 / 安全）
**1. 统一审核系统** `/admin/moderation`
- 聚合：评论待审、反馈、文档纠错、项目申请、友链申请、论坛举报。
- 统一「通过 / 拒绝 / 删除」，权限 `moderate` 或 `admin`。

**2. 文件管理** `/admin/media`
- 上传（写 `content/media/` 或 `static/media/`）、列表、删除、复制引用路径；文章引用媒体。

**3. 安全系统** `/admin/security`
- 审计日志 `content/audit.json`：登录成败、管理员增删改发、token 失效。
- 安全设置：登录失败锁定、IP 限频、会话时长；展示审计 + 可保存。

**批次三验收**：审核台聚合所有待办；媒体可上传/删除；审计有记录；设置可保存。

---

## 交付节奏（每批）
写代码 → `vite build`（0 error）→ 杀旧 8090 进程重启 → 冒烟（API+页面+权限门控）→ 清测试数据 → commit。每批结束贴预览 + 变更清单。

## 范围外（用户未要求，暂不做）
AI 聊天组件、第三方评论（Disqus）、ES 检索（<500 篇用前端模糊检索）、支付/会员。
