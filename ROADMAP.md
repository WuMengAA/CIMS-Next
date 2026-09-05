# Stelarith 资源盘点与演进规划（ROADMAP）

> 本文档盘点本项目演进过程中参考过的全部外部资源，评估其契合度与落地进度，规划后续实施顺序。

## 一、资源清单与当前状态

| # | 资源 | 类型 | 当前状态 | 契合度 |
|---|------|------|----------|--------|
| 1 | https://www.acofork.com/ | 目标站点 | ✅ 已复刻（设计、布局、导航） | 100% |
| 2 | DESIGN.md（D:/Stellara/.md/design-md/claude/） | 设计规范 | ✅ 已落地（layout.css tokens） | 100% |
| 3 | https://github.com/pd4d10/hashmd | Markdown 编辑器 | ⚠️ npm 包为空壳，未采用；已自研分栏实时预览编辑器 | 60% |
| 4 | https://github.com/guillermolg00/morphicons | 图标变形动画 | ✅ 已集成（侧边栏触发器 Menu⇄PanelLeft） | 90% |
| 5 | https://github.com/blessonism/grok-icon-study | 图标风格研究 | 🔲 待评估（图标美感参考） | 40% |
| 6 | https://github.com/martin65536/liquid-glass-webgl | 液态玻璃 WebGL 背景 | 🔲 待评估（背景特效候选） | 50% |
| 7 | https://gitee.com/honbingitee/staratlas | 星图粒子背景 | 🔲 待评估（粒子背景候选） | 55% |
| 8 | React Bits（动效组件库） | 高级动效参考 | ✅ 部分借鉴（分段加载、背景编辑器、按钮流光） | 75% |

## 二、按主题归类

### A. 设计系统（已完成 ✅）
- `acofork.com` + `DESIGN.md`：深色 #1b1b19 / 强调 #cc785c / 侧边栏 #141413；Inter+Lora；圆角 0.5rem。
- 落地位置：`src/routes/layout.css`（@theme inline 全量映射）。

### B. 背景特效（进行中 🔄）
已有动画背景系统（`src/lib/components/bg-effects.svelte`，后台可配）：
- 极光流动 / 网格光 / 粒子星空 / 彩虹渐变；三色、浓度、速度、粒子开关。
候选增强（来自链接 6、7）：
- **liquid-glass-webgl**：液态玻璃折射效果 → 适合 hero 卡片/品牌区高级质感；需要 WebGL（three.js 或原生）→ 体积较大，作为高级选项。
- **staratlas（星图粒子）**：星点连线粒子 → 可增强现有 particles 风格（canvas 实现，轻量）。

### C. 图标与动效（部分完成 ✅）
- morphicons：已用于触发器；可扩展更多图标对（sun⇄moon、chevron⇄down）。
- grok-icon-study：图标风格研究 → 若引入自定义图标集时参考。
- React Bits：滚动动画、背景编辑器、按钮/卡片微互动已借鉴（reveal 系统、text-shimmer、btn-glow、card-hover、parallax）。

### D. 编辑器（自研替代 ✅）
- hashmd npm 为空壳（仅 package.json 无代码）→ 未采用；改为 Svelte 分栏实时预览编辑器 + 斜杠命令 + 图片/媒体库 + 嵌入 + KaTeX。

## 三、后续实施优先级（P0→P2）

### P0（高价值、低工作量）
1. **staratlas 星图粒子升级现有 particles**：把静态 dot 动画升级为 canvas 星点 + 连线（轻量，~80 行，无新依赖）— 替换 `bg-effects.svelte` 的 particles 层。
2. **React Bits 式滚动分节进入**：现有 reveal 已基础，补「视差分层」（hero/卡片不同速度，P0）与「滚动触发计数动画」（数字递增，用于统计栏）。
3. **图标变形扩展**：新增 sun⇄moon、chevron-down⇄up、arrow 变形（morphicons 已支持，零新增）。

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

**下一步建议**：按 P0 顺序实施 ① staratlas 粒子升级 → ② 滚动计数/视差分层 → ③ 图标变形扩展；完成后进入 P1 液态玻璃评估。
