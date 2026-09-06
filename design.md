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

## 7. Markdown 扩展语法（写作约定）

渲染管线 `src/lib/server/content-store.ts` + `markdown-extensions.ts` 支持：

- 上标 `^x^`、下标 `~x~`、高亮 `==x==`
- 提示块（GitHub/Obsidian 写法）：`> [!TIP]` `> [!NOTE]` `> [!WARNING]` `> [!DANGER]` `> [!SUCCESS]`
  等 13 种，自动渲染为彩色 callout（左边框 + 标题）。
- GFM 表格（表头/分隔行/数据行必须连续，中间不可有空行——已有 `fixTableBlocks` 预处理兜底）。
- 删除线 `~~x~~`、脚注、任务列表、KaTeX 公式。

代码块内的同形字符（`^` `~` `==`）不会被误渲染（扩展只处理 inline token 的 text 子节点）。
