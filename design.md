# Stelarith 站点设计基准（Design Spec）

> 本文件是站点的统一排版 / 视觉 / 响应式规范。所有页面改动都应遵循此处约定。
> 选型来源：`D:\Stellara\.md\design-md\vercel\DESIGN.md`（Vercel 暗色规范）。

## 1. 选型结论

- **规范**：Vercel 暗色风格（紧凑、现代 SaaS 感，契合现有暗色主题）。
- **不适用项**：规范里浅色/高对比部分跳过；保留本站已有暗色变量体系。
- **范围**：全站统一（内容阅读页、列表页、后台、账户、友链、归档）。

## 2. 设计 Token

| Token | 值 | 说明 |
|-------|-----|------|
| `--radius` | `0.5rem` (8px) | 圆角基准（Vercel md）；sm=4.8 / md=6.4 / lg=8 / xl=11.2 |
| `--font-sans` | `Inter Variable` + 中文回退 | 正文 / UI |
| `--font-heading` | `Lora Variable` + 衬线回退 | 标题（display） |
| `--font-mono` | 系统等宽栈 | 代码 |
| 容器宽度 | `max-w-[1400px]` | 全站内容容器（Vercel lg 容器） |
| 间距基准 | `4px` | Tailwind 默认刻度 |

## 3. 排版规则（Typography）

- **字重上限 600**：全站 `font-bold`(700) / `font-black` 一律改用 `font-semibold`(600)。
  Vercel 明确规定 display 字重不超过 600，绝不用 700+。
- **负字间距**：标题 `tracking-tight`（h1 `-0.04em` / h2 `-0.03em` / h3 `-0.02em`）。
- **正文节奏**：`.prose p, .prose li` 使用 `16px / line-height 1.75`（中文形密，放宽自 Vercel 的 1.5）。
- **标题层级**（已落到 `.prose`）：
  - h1 `32/40` · h2 `24/32` · h3 `20/28` · h4 `16`
  - 代码 `13/20`，代码块圆角 6px、内边距 `1rem 1.25rem`、横向可滚。
- **表格**：整站统一 `.prose table` 边框 + 圆角 + 表头底色 + 隔行斑马纹 + 悬停高亮 + 窄屏横向滚动。
- 标题 `text-wrap: balance`（多行标题均衡断行）。

## 4. 响应式断点（Responsive）

遵循 Vercel 四档（本项目用 Tailwind 等效类）：

| 断点 | 宽度 | 处理 |
|------|------|------|
| `< 600px` | 手机 | 单列堆叠、侧边栏收起、详情页三栏 → 导航/目录隐藏或折叠 |
| `600–959px` | 小平板 | 双列开始 |
| `960–1199px` | 大平板 | 三栏内容区铺开 |
| `≥ 1200px` | 桌面 | 完整布局，容器 1400px 居中 |

落地要点：
- 详情页（docs / posts）三栏布局 `md:flex-row`，TOC 仅 `lg:block` 显示，移动端用 `<details>` 折叠目录。
- 账户页头部 `flex-wrap`，长用户名 `min-w-0 truncate` 防溢出。
- 代码块、表格均 `overflow-x: auto`，不撑破窄屏。

## 5. 阴影 / 层级

- 用 1px inset hairline（border）+ 轻投影表达层级，避免重阴影。
- 卡片：`rounded-xl border border-border/60 bg-card`。

## 6. 已落地文件

- `src/routes/layout.css`：`.prose` 排版基准 + 扩展语法（上标/下标/高亮/callout）样式。
- `src/lib/components/container.svelte`：容器统一 `max-w-[1400px]`。
- `src/routes/docs/[slug]/+page.svelte`、`src/routes/posts/[slug]/+page.svelte`：详情页容器对齐 1400px。
- 8 处 `font-bold` → `font-semibold`（侧边栏 logo、首页 hero、admin 壳/仪表盘/登录）。
- `src/routes/account/+page.svelte`：窄屏头部 `flex-wrap` + 截断。

## 6.1 多用户 / 活动 / 页面过渡（本次新增）

| 能力 | 落地文件 | 规范约束 |
|------|----------|----------|
| 页面过渡 | `src/lib/transition.ts` + `layout.css` 的 `::view-transition-*` | 只动画命名内容区，根快照不动；`prefers-reduced-motion` 下全禁 |
| 前台/后台滑块 | `src/lib/components/view-switch.svelte` | `rounded-lg` + `border-border/60`，指示块 1px ring，`font-medium` |
| 用户管理 | `src/routes/admin/users/*` | 卡片 `rounded-xl border border-border/60 bg-card`，标题 `font-semibold` |
| 活动中心 | `src/routes/admin/activities/*` | 同上；统计数值用 `font-heading font-semibold tracking-tight` |
| 在线心跳 | `src/lib/components/presence-heartbeat.svelte` | 无 UI；60s 一次，不可见时暂停 |
| 个人资料 | `src/routes/account/+page.svelte` | 表单标签 `text-sm`，说明 `text-xs text-muted-foreground` |

数据层：`node:sqlite`（Node 22 内置，零依赖），库文件 `content/stelarith.db`（不入 git）。

## 6.2 集控面板真实数据化 / 权限 / 访问体验（本次新增）

### 集控面板（`/admin/console` → `static/console/`）

面板此前在站点内嵌模式下，通知历史 / 班级交流 / 操作日志三块**只能显示内置演示数据**（看着像通了其实是假的）。本次接入站点侧真实后端。

| 能力 | 落地文件 | 规范约束 |
|------|----------|----------|
| 协作数据表 | `src/lib/server/db.ts` 增 `console_notices` / `console_chat` / `console_audit` | 与 `users`/`sessions`/`activities` 同库同风格；均带 `created_at` 索引 |
| 协作数据层 | `src/lib/server/console-ext.ts` | 写入统一 `cut()` 截断（标题 200 / 消息 1000）；审计只记元数据 |
| 协作接口 | `src/routes/api/console/ext/[...path]/+server.ts` | 全部需 `viewConsole`；写操作需 `submitIssue`，通知留痕需 `controlDevice` |
| 面板接线 | `static/console/api.js` 的 `ext()` + `normNotices/normChat/normAudit` | **配了后端就绝不再静默回退演示数据**；失败如实报错 |
| 权限下发 | `src/routes/admin/console/+page.server.ts` → iframe query | **内嵌时 fail-closed**：未明确授权即视为无权限 |
| 权限门控 | `static/console/app.js` 的 `PERM` / `allow()` / `applyGating()` | 导航项无权限直接隐藏；按钮禁用并 `title` 说明原因 |
| 操作审计 | 面板关键动作 → `POST /api/console/ext/audit` | 下发课表/配置、设备指令、通知、远程控制、点歌推送均留痕 |

权限位与 `src/lib/permissions.ts` 一一对应：`control`=`controlDevice`、`remote`=`remoteControl`、`manage`=`manageDevices`、`issue`=`submitIssue`。服务端硬校验为准，前端仅做体验层。

### 访问体验

| 问题 | 修法 | 规范约束 |
|------|------|----------|
| 禁用 JS / 脚本加载失败时整站白屏（`.reveal` 初始 `opacity:0` 靠 JS 解锁） | `src/app.html` 加 `<noscript><style>` + `layout.css` 加 `@media (scripting: none)` | 双保险覆盖新旧浏览器 |
| 键盘用户需 Tab 穿过整条侧边栏才能到正文 | 根布局加 `.skip-link` → `#main-content`（`tabindex="-1"`） | 平时 `translateY(-250%)` 移出视口，`:focus` 归位 |
| 客户端导航后读屏无感知 | 根布局 `aria-live` 隐藏区播报新页面标题（`afterNavigate` + 60ms） | 仅 `sr-only`，视觉用户无感 |
| `/admin` 同时渲染前台侧栏 + 后台侧栏（两列导航） | 根布局 `isAdmin` 时不再渲染 `AppSidebar`/前台顶栏/公告条 | SSR 期即可判定，无闪烁 |
| `/admin/login` 被套进后台外壳（整屏卡片被挤到右侧） | 后台布局 `isLogin` 时只渲染 `children` | — |
| 面板窄屏表格撑破布局、键盘焦点环不可见 | `static/console/styles.css` 加 `:focus-visible` 统一焦点环 + `@media(max-width:760px)` 侧栏收窄/表格横向滚动 | — |

## 6.3 登录表单提交（踩坑约束）

管理后台登录页 `src/routes/admin/login/+page.svelte`，两个必须遵守的约束：

| 约束 | 原因 | 症状 |
|------|------|------|
| 表单内的 `<Button>` **必须显式写 `type="submit"`** | `$lib/components/ui/button` 的 `type` 默认值是 `"button"`（shadcn 约定），不写就不会触发 `submit` 事件 | 点击「登录」**毫无反应**：不发请求、不跳转、无报错。表单含两个输入框时浏览器也不做隐式提交，回车同样无效 |
| 监听表单动作结果用 `onUpdate`，**不要用 `onUpdated`** | `onUpdate` 的事件形参是 `{ form, result }`；`onUpdated` 只在页面数据刷新后触发，形参**只有 `{ form }`** | 解构 `result` 得到 `undefined`，回调内抛 `TypeError`，失败提示（密码错误等）永远不会弹出 |

排查要点：改完用 `curl`/`fetch` 取 `/admin/login` 的 SSR 产物，统计 `<button ... type="submit">` 的**数量必须 ≥ 1**；为 0 即命中此坑。

> 注：服务端 `verifyLogin` + `cookies.set('admin_token')` 与 CSRF 配置（见 §6.1）都正常时，按钮不提交是**唯一**的静默失败点——从 Network 面板看是**一个请求都没有**，容易误判为后端问题。

## 6.4 高危约束（本轮修复，务必遵守）

这几条都是「会静默出错/会开安全口子」的类型，改到相关代码时先读本节。

### ① 集控 CIMS 代理**必须**鉴权（高危）

`src/routes/api/console/cims/[...cims]/+server.ts` 持有服务端特权令牌（`CIMS_ADMIN_EMAIL/PASSWORD` 换取），
能读全部账号/设备、能下发重启与锁屏、能写 CIMS 资源。

**`hooks.server.ts` 只守 `/admin` 页面路由，`/api` 在 `SKIP_PREFIX` 跳过列表里 —— 这个文件里的鉴权是唯一一道门。**
曾缺失该鉴权，结果：匿名 `curl /api/console/cims/account/list` 直接 200，等于把校园设备控制权公开给任何能访问本站的人。

规矩：任何新增 `/api/console/*` 代理，第一行就要 `verifyToken(cookies.admin_token)` + `can(role, "viewConsole")`；
写操作按最小必要权限细分（设备指令 `controlDevice`、远程控制 `remoteControl`、资源写入 `manageDevices`）。

> 同目录的 `ext` 代理一直有 `guard()`；`cims` 代理漏了。**成对存在的路由，改一个要看另一个。**

### ② 页面过渡只在**根布局**注册一次

`enableViewTransitions()` 内部的 `onNavigate` 是**组件级**生命周期（`onMount` 注册、随组件销毁注销）。
根布局与 `admin/+layout.svelte` 各注册一份 → 同一次导航连开两次 View Transition，
后一次把前一次顶掉，前一次的 `ready/finished` 以 `AbortError: Transition was skipped` 拒绝。

- 只在 `src/routes/+layout.svelte` 调用；函数内已加幂等标记 + `onDestroy` 复位兜底。
- 另外 `startViewTransition()` 返回的 `ViewTransition` **必须**接管 `ready/finished` 的 rejection，
  否则导航竞态（如登录后立即失效重取 `/admin/__data.json`）会在控制台留下 unhandled rejection。

### ③ `/uploads/[filename]`：先 decode，再防穿越

`url.pathname` 是 **percent-encoded** 的。不 `decodeURIComponent` 就直接 `path.resolve("uploads", ...)`，
任何**中文/空格文件名**的上传都会 404（上传成功、预览裂图）。解码后必须校验仍在 `uploads/` 内（防 `..%2F` 穿越）。

### ④ 站外图片一律加 `referrerpolicy="no-referrer"`

B 站图床（`i*.hdslb.com`）等按 Referer 防盗链，带本站 Referer 会 403 变裂图。
已覆盖：`voicehub` 封面、`renderMarkdown` 的全局 `<img>` 增强。

### ⑤ `static/console/api.js` 是 IIFE，导出对象里**不要写简写属性**

该文件末尾 `global.API = API` 是**整个面板唯一出口**。曾把内部实现 `vhubList/vhubRequest/vhubPush`
写成简写 `voicehubList, voicehubRequest, voicehubPush` —— 这些标识符并不存在，
对象字面量一求值即抛 `ReferenceError`，`global.API` 从未赋值，
表现为面板除顶部条外**全白**、`app.js` 报 `API is not defined`。

正确写法是把内部名显式映射：`voicehubList: vhubList, ...`。
改完可用桩环境跑一次该文件，确认 `window.API` 真的被赋值（而不是「看起来没报错」）。

### ⑥ 已知未修：集控「课表/组件配置」取不到真实数据

面板 `api.js` 的 `cli()` 打 `/v1/client/{type}?name=...`，但两点都不对：

| 项 | 现状 | 实际（已核对 CIMS-backend 源码） |
|---|---|---|
| 端口 | 走 `clientHost`，嵌入时指向 `/api/console/cims`（→ management 8097） | `/api/v1/client/*` 挂在 **client 端口**（`CLIENT_PORT`，部署为 8098） |
| 路径 | `/v1/client/...` | client 应用以 `prefix="/api"` 挂载，应为 **`/api/v1/client/...`** |

**为什么不能直接改指向**：client 应用装有 `TenantMiddleware`，从 **Host 头子域名**解析租户
（`extract_slug_from_host`，要求 `<slug>.<BASE_DOMAIN>`），解析不到直接 403「未识别出租户」；
而 management 应用**没有**该中间件，所以现在经代理能通。

要修好必须先明确租户 slug / BASE_DOMAIN，再让代理带上对应 Host 头（或由部署方提供该映射）。
在那之前，课表/配置视图按设计降级为演示数据，**不影响其它功能**。

## 6.5 移动端侧边栏（后台 / 集控面板，本轮新增）

### 后台 `/admin` 移动端三连坑

| 问题 | 根因 | 修复 |
|------|------|------|
| 手机端进入后台**没有侧边栏按钮** | admin 布局直接用了 `Sidebar.Root`，但缺 `Sidebar.Provider`（context 来源）与 `Sidebar.Trigger`（汉堡开关） | 根布局 `src/routes/+layout.svelte` 包一层 `<Sidebar.Provider>`；admin 布局加 `<Sidebar.Trigger>`（顶栏汉堡）+ `<Sidebar.Rail>`（折叠态 hover 展开） |
| 侧边栏**没有展开/收起动画** | `Sidebar.Root` 是 `fixed` 定位，嵌在 flex 列里靠 `gap` 让位失效，内容被盖住 | `Sidebar.Inset` 改用 `md:pl-(--sidebar-width)` 让出空间；收起时 `md:peer-data-[collapsible=offcanvas]:pl-0` 跟随折叠一起收回（两侧同 300ms，动画合拍） |
| 移动端**不自动收起** | 没有在导航后关闭移动抽屉的逻辑 | 新增 `src/lib/components/sidebar-auto-close.svelte`，`afterNavigate` 中 `if (sidebar.isMobile) sidebar.setOpenMobile(false)`；根布局引入该组件 |

> `sidebar-auto-close.svelte` 用的是根 `Provider` 的 context，前台/后台共用一套——只要整站包在 `Sidebar.Provider` 内，任意一侧导航都会自动收起移动抽屉。

### 集控面板（星极控 / xingjikong）移动端抽屉

面板是两处真源码：`static/console/`（站点内嵌用）与 `admin-console/src/`（Tauri 桌面端用），改动需**两处同步**。

| 改动 | 文件 | 说明 |
|------|------|------|
| 切换按钮 | `index.html` 顶栏加 `<button id="btn-nav" class="nav-toggle">☰</button>` | `.nav-toggle` 默认 `display:none`，`@media(max-width:760px)` 才显示 |
| 遮罩 | `index.html` 加 `<div id="nav-mask">` | 半透明遮罩，点它收起抽屉 |
| 抽屉样式 | `styles.css` 加 `#sidebar{position:fixed;transform:translateX(-100%);transition:transform .25s}` + `#sidebar.open{transform:translateX(0)}` | 窄屏抽屉滑入动画；`#main{margin-left:0;width:100%}` |
| 开合逻辑 | `app.js` 加 `setNav(open)`：切 `#sidebar.open` 与 `#nav-mask.show`；遮罩点击 + 导航项点击 → `setNav(false)` | 点菜单任一项即收起 |

> 桌面端（Tauri `minWidth:900`）抽屉永不触发，这里改动主要为**源码同步**与窄屏预览；真机验证以站点内嵌版（`static/console/`）为准。

### 验证（CDP 真浏览器，非 curl）

- 桌面 11/11、移动 18/18 全绿：`data-slot="sidebar"` 数量正确、汉堡按钮可见可点、抽屉滑入/滑出、导航后自动收起、内容不被 `fixed` 侧栏遮挡。
- 截图存 `D:/Stellara/shots/`：`desktop-admin.png` / `mobile-admin-open.png` / `mobile-console-open.png` 等。

## 7. Markdown 扩展语法（写作约定）

渲染管线 `src/lib/server/content-store.ts` + `markdown-extensions.ts` 支持：

- 上标 `^x^`、下标 `~x~`、高亮 `==x==`
- 提示块（GitHub/Obsidian 写法）：`> [!TIP]` `> [!NOTE]` `> [!WARNING]` `> [!DANGER]` `> [!SUCCESS]`
  等 13 种，自动渲染为彩色 callout（左边框 + 标题）。
- GFM 表格（表头/分隔行/数据行必须连续，中间不可有空行——已有 `fixTableBlocks` 预处理兜底）。
- 删除线 `~~x~~`、脚注、任务列表、KaTeX 公式。

代码块内的同形字符（`^` `~` `==`）不会被误渲染（扩展只处理 inline token 的 text 子节点）。
