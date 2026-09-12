# Stelarith 资源盘点与演进规划（ROADMAP）

> 本文档盘点本项目演进过程中参考过的全部外部资源，评估其契合度与落地进度，规划后续实施顺序。

## 一、资源清单与当前状态

| # | 资源 | 类型 | 当前状态 | 契合度 |
|---|------|------|----------|--------|
| 1 | https://www.acofork.com/ | 目标站点 | ✅ 已复刻（设计、布局、导航） | 100% |
| 2 | DESIGN.md（D:/Stelarith/_misc/md/design-md/claude/） | 设计规范 | ✅ 已落地（layout.css tokens） | 100% |
| 3 | https://github.com/pd4d10/hashmd | Markdown 编辑器 | ⚠️ npm 包为空壳，未采用；已自研分栏实时预览编辑器 | 60% |
| 4 | https://github.com/guillermolg00/morphicons | 图标变形动画 | ✅ 已集成（侧边栏触发器 Menu⇄PanelLeft） | 90% |
| 5 | https://github.com/blessonism/grok-icon-study | 图标风格研究 | 🔲 待评估（图标美感参考） | 40% |
| 6 | https://github.com/martin65536/liquid-glass-webgl | 液态玻璃 WebGL 背景 | 🔲 待评估（背景特效候选） | 50% |
| 7 | https://gitee.com/honbingitee/staratlas | 星图粒子背景 | ✅ 已落地（starfield.svelte，canvas 星点+连线） | 100% |
| 8 | React Bits（动效组件库） | 高级动效参考 | ✅ 部分借鉴（分段加载、背景编辑器、按钮流光） | 75% |

## 二、按主题归类

### A. 设计系统（已完成 ✅）
- `acofork.com` + `DESIGN.md`：深色 #1b1b19 / 强调 #cc785c / 侧边栏 #141413；Inter+Lora；圆角 0.5rem。
- 落地位置：`src/routes/layout.css`（@theme inline 全量映射）。

### B. 背景特效（已完成 ✅）
已有动画背景系统（`src/lib/components/bg-effects.svelte`，后台可配）：
- 极光流动 / 网格光 / 粒子星空 / 彩虹渐变；三色、浓度、速度、粒子开关。
- **staratlas（星图粒子）**：✅ 已落地 —— `src/lib/components/starfield.svelte`（canvas 星点 + 连线，替代原静态 dot），由 `bg-effects.svelte` 调用。
候选增强（来自链接 6）：
- **liquid-glass-webgl**：液态玻璃折射效果 → 适合 hero 卡片/品牌区高级质感；需要 WebGL（three.js 或原生）→ 体积较大，作为高级选项（仍待评估）。

### C. 图标与动效（基本完成 ✅）
- morphicons：已用于侧边栏触发器（Menu⇄PanelLeft）；sun⇄moon / chevron 等更多图标变形 **尚未扩展**（P0-③ 仅部分完成）。
- grok-icon-study：图标风格研究 → 若引入自定义图标集时参考。
- React Bits：滚动动画、背景编辑器、按钮/卡片微互动已借鉴 —— **reveal 系统、text-shimmer、btn-glow、card-hover、`parallax`（`layout.css` 的 `animation-timeline: view()`）、`CountUp` 滚动计数组件均已落地**。

### D. 封面与模板工具（已完成 ✅）
- **封面生成器** `src/routes/tools/cover-generator`：确定性 SVG 模板（深炭黑底 + 陶土橙强调 + lucide 图标 + 星点），实时预览，导出 **SVG（矢量）/ PNG（栅格，浏览器端 canvas 栅格化，含中文）**。
- 全站 10 篇文章封面已用同风格批量生成（`scripts/gen-covers.mjs` → `static/covers/<slug>.svg`），frontmatter 已补 `cover` 字段；详情页 `og:image` 与 hero 图现已启用。

### D. 编辑器（自研替代 ✅）
- hashmd npm 为空壳（仅 package.json 无代码）→ 未采用；改为 Svelte 分栏实时预览编辑器 + 斜杠命令 + 图片/媒体库 + 嵌入 + KaTeX。

## 三、后续实施优先级（P0→P2）

### P0（高价值、低工作量）
1. ✅ **staratlas 星图粒子升级现有 particles**：已完成 —— `starfield.svelte`（canvas 星点 + 连线）替代原静态 dot。
2. ✅ **React Bits 式滚动分节进入**：已完成 —— `parallax`（`animation-timeline: view()`）+ `CountUp` 滚动计数组件已落地。
3. ⚠️ **图标变形扩展**：仅 Menu⇄PanelLeft 落地；sun⇄moon / chevron-down⇄up / arrow 变形 **尚未做**（morphicons 已支持，零新增，待补）。

### P1（中价值、中工作量）
4. **liquid-glass-webgl 液态玻璃**：hero 品牌卡或特性卡增加玻璃折射光斑；需引入 WebGL 渲染器（three.js 或手写）→ 评估体积后可作「高级主题开关」，默认关闭。
5. **grok-icon-study 图标调优**：按研究结果统一图标粗细/圆角（lucide 全局 stroke 微调、图标精选替换）。

### P2（可选/备选）
6. **hashmd 富文本模式**：若坚持 WYSIWYG，再次评估其 Vue 包装或 fork 编译；工作量高，当前编辑器已满足。
7. **动效配置中心**：把 reveal/parallax/卡片互动做成后台「特效开关」（settings.effects），可整体开/关、调强度 —— 统一管理所有动画。

## 四、决策原则
- 性能优先：只用 transform/opacity/background-position 与 canvas；WebGL 类默认关闭。
- 克制优雅：动画不喧宾夺主，与 Claude 编辑设计一致。
- 无障碍：全部动画尊重 prefers-reduced-motion，关闭时内容直显。
- 零/低依赖：能用 CSS 不用 JS，能不引库不引库；WebGL 作为可选增强。
- 可配置：用户可在后台开关与调节，不做死。

## 五、当前开发入口
- 开发预览：http://localhost:5176
- 管理后台：http://localhost:5176/admin（默认密码见 .env.example 说明，登录后请立即修改）

---

**下一步建议**：P0 仅剩「图标变形扩展」（sun⇄moon/chevron），补完即可收口；之后进入 P1 液态玻璃评估（默认关闭的 WebGL 高级选项）。视觉与封面工具线已基本闭环。
