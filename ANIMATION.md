# 网站动画评估与方案

## 设计原则

Stelarith 复刻站点采用 **克制优雅** 的动画策略，与 stelarith.com 的极简编辑设计一致。原则：

1. **不喧宾夺主** — 动画只做引导，不做表演
2. **尊重系统偏好** — 关键动画支持 prefers-reduced-motion
3. **性能优先** — 只用 transform/opacity 与 SVG path 变形，避免重排
4. **依赖可控** — tw-animate-css（已装）+ MorphIcons（约 1.4KB，零运行时依赖）+ 原生 CSS

## 评估过的方案

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| **MorphIcons**（已采用） | SVG 图标变形 + spring 物理、Svelte 5 原生、约 1.4KB、zero-dep | 仅适合图标级动画 | ✅ 图标变形 |
| **tw-animate-css + keyframes**（已采用） | 零新依赖、shadcn 原生、reduced-motion | 无滚动触发编排 | ✅ 页面入场 |
| **Motion One** | 高性能、滚动触发、spring | 新依赖约 10KB | ⚠️ 备选 |
| **GSAP** | 功能最全 | 大体积、过度能力 | ❌ 不采用 |

## 已实现

### MorphIcons（图标变形）

- **侧边栏触发器**：Menu ⇄ PanelLeft 变形，spring=snappy，reducedMotion=user
- 数据来自 lucide 包（IconNode），与 @lucide/svelte 组件共存、各自 tree-shake

### 页面级入场动画（layout.css）

- .anim-fade-up（淡入上移 12px）/ .anim-fade-in（纯淡入）
- .anim-delay-1..4 错峰（80ms 步进）
- prefers-reduced-motion: reduce 时全局禁用

### 应用位置

- 首页 Hero → 品牌区 → 特性 → 最新内容 → 社交（错峰入场）
- 博客列表页头 fade-up

### 组件级微交互（shadcn 自带）

- Dropdown/Tooltip/Sheet/Dialog：fade-in zoom-in slide-in
- Skeleton pulse；按钮 hover/active 颜色过渡

## 可选的后续增强

1. **滚动进入动画**：IntersectionObserver 触发（约 40 行）
2. **文章阅读进度条**：顶部 transform 进度条
3. **更多图标变形**：主题切换（sun⇄moon）、菜单箭头（chevron-down⇄up）等

> 需要滚动动画或更丰富 spring 时，推荐 Motion One（8KB，与 Svelte 5 兼容）。