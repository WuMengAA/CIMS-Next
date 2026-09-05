# Stelarith CMS —— 项目交接记忆（MEMORY）

> 本文件是当前会话的持久化交接记忆：记录项目位置、技术栈、已完成功能、当前状态、踩坑教训与下一步。后续接手者请先读本文件。

## 一、项目位置与运行
- **目录已改名：`acofork-clone` → `stelarith`**（此记忆同步修正）
- 项目根目录：`D:\Stellara\stelarith-website\stelarith`
- 独立 git 仓库（目录名已统一为 stelarith，与品牌 Stelarith 一致；原 acofork-clone 命名已废弃）
- 开发：`pnpm dev --port 8090`（历史上 5174/5175/5176/5177 可能残留旧进程；认准最新端口或先杀 node 再起）
- 构建：`pnpm build`（须 exit 0 才算通过）
- 默认管理员：`admin` / `<口令由 .env ADMIN_PASSWORD 注入；此处不写明文以免随仓库入 git，需要时查上级备份 MEMORY-Stelarith.md>`（可用 .env ADMIN_PASSWORD 覆盖；后台可改）
- 包管理：pnpm；依赖锁已与 vite.config 的 ssr.noExternal:['morphicons'] 保持一致

## 二、技术栈
SvelteKit 2.x + Svelte 5 runes（强制 runes：vite.config `runes: ({filename}) => !filename.includes('node_modules')`）
Tailwind v4 + @tailwindcss/typography；shadcn-svelte 1.6 + bits-ui + lucide-svelte + morphicons（图标变形，需 ssr.noExternal）
markdown-it + markdown-it-anchor + markdown-it-katex + markdown-it-task-lists + markdown-it-footnote + highlight.js 11.12
gray-matter（frontmatter）；无数据库——文件型存储 content/（posts/projects/docs + settings/nav/links/comments/link-applications/users.json）

## 三、已完成功能清单
1. 复刻 acofork.com 设计：深色 #1b1b19 / 强调 #cc785c / 侧边栏 #141413；Inter+Lora；圆角 0.5rem
2. CMS 化：后台登录（cookie HttpOnly admin_token）、文章/项目/文档 CRUD、媒体上传（校验扩展名+20MB）、友链管理+申请审核、评论管理（审核/删除）、用户管理（多用户+owner 隔离）、导航管理（可排序可编辑）、站点设置（标题/描述/hero/特性/社交/白名单/背景）
3. 编辑器：分栏实时预览、工具栏（B/I/S/H1-H3/引用/有序无序/任务/表格(行列选择)/分隔线/行内码/代码块/链接/图片上传/嵌入(YouTube/B站/URL/iframe)/KaTeX 公式）、斜杠命令菜单（/ 唤起，键盘导航）、媒体库选择器
4. Markdown 渲染：KaTeX、GFM 任务列表/脚注/表格、代码高亮、TOC（anchor）、字数统计；html:true 支持 iframe 嵌入
5. 动效：全局 reveal 分段加载（spring 曲线 + --reveal-delay）、View Transitions 页面跳转、阅读进度条、出站链接提示+白名单（localStorage 记住选择）、MorphIcons 图标变形（侧边栏折叠 chevron-down⇄up）、bg-effects 可配置动画背景（极光/网格光/粒子星空/彩虹，后台可编辑颜色/浓度/速度/粒子开关，实时预览）
6. P0 特效：starfield.svelte（canvas 星点+连线，已集成 bg-effects 的 particles/极光叠加层）、count-up.svelte（IntersectionObserver 数字递增，首页统计条：文章/项目/文档）、视差分层（parallax-slow/mid/hero，scroll-driven animation）
7. 安全：hooks.server.ts 硬保护 /admin（未登录 303→/admin/login）；全部写 API 校验登录（settings/media/links 曾完全无鉴权——已修）；多用户 owner 隔离；备份 AES-256-GCM；弱口令已轮换；.gitignore 忽略 users.json/settings.json/nav.json/links.json/uploads/构建日志/*.mjs
8. 品牌：acofork→stelarith 全量替换（src+content+文档）；+error.svelte 已重建

## 四、关键文件
- src/lib/server/content-store.ts —— 核心存储（listItems/getItem/saveItem/deleteItem/reorderItems/renderMarkdown/uploadFile/getSettings/saveSettings/getLinks/saveLinks/getComments/addComment/deleteComment/toggleCommentApproval/getLinkApplications/setLinkApplicationStatus/getNav/saveNav/getFolders）【注意：曾因偏移窗口 read 后 write 被截断，已完整重建 406 行——别再用偏移+write 组合】
- src/lib/server/auth.ts（scrypt、verifyToken、多用户）、api-auth.ts（getApiUser/canManage）
- src/lib/components/bg-effects.svelte / starfield.svelte / count-up.svelte / content-editor.svelte / app-sidebar.svelte
- src/lib/actions/reveal.ts（分段加载动画）+ replayReveals()
- src/hooks.server.ts
- ROADMAP.md / DEPLOYMENT.md / ANIMATION.md / RUNES.md / SECURITY.md / CONTRIBUTING.md / README.md

## 五、当前内容状态（初始化态）
- content/docs/：01-what-is-api … 07-deepseek-harness（AI 入门 7 篇，folder="AI 入门"）
- content/posts/、content/projects/：空（.gitkeep）
- settings.json 含 outboundWhitelist + background 配置
- 开源版定位：初始空状态，页面文字全部可由后台配置

## 六、踩坑教训（必须遵守）
1. **run_code 里写 Svelte/TS 大文件**：避免 JS 模板字符串转义破坏——用「数组行 join」或「Node 脚本写文件」；写完后立刻 read 确认。
2. **write 工具缓存**：文件被工具包外改动/删除后直接 write 会报 "file no longer exists / file changed"——先 read 或改用全新文件名。
3. **绝不偏移 read 后直接 write 同一文件**（会截断整文件，曾毁 content-store.ts）。
4. **Svelte 5 runes**：$page 用 page（无需 $前缀）；$derived 只能顶层；($derived(()=>..))() 非法用普通 IIFE；函数内不能用 runes；onMount 必须 import；自闭合非 void 标签会报错（用显式闭合）；style/class 别拼错（曾把 style 拼进 class 导致 4 文件构建失败）。
5. **幂等图片/字符串替换**：用 Node replaceAll 精确匹配，别用模糊正则。
6. **端口/内存**：多开 dev 会残留旧进程占端口；内存 <2GB 时 pnpm build 崩溃（0xC0000405）——先杀 node 再构建。
7. **PowerShell 传参**：Node 脚本含模板/引号易崩——用简单数组或直接 pwsh。
8. **验证**：curl 到错误的旧端口得到旧内容——认准当前 dev 端口；grep 不能搜索 C:（用项目内文件）。

## 七、未完成 / 下一步（P1 起）
- P1：液态玻璃 WebGL 背景（作高级主题开关，默认关闭）、动效配置中心（后台统一开关/调强度）、图标风格调优（grok-icon-study）、hashmd 富文本模式再评估、更多图标变形扩展
- 未做：真实部署（DigitalOcean 文档已备）、提交优化（.gitignore 已就绪，可 git init 提交后推 GitHub）
- 已知余额限制：web_search、hindsight（无 token）不可用

## 八、验收标准
pnpm build exit 0；路由 200；后台登录正常；无敏感文件进 git；动画尊重 prefers-reduced-motion。
