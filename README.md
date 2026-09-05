# Stelarith CMS

> 基于 SvelteKit + Tailwind CSS v4 + shadcn-svelte 的个人内容管理系统（CMS）
> 灵感来自 stelarith.com 与 Halo 的内容运营方式

![sveltekit](https://img.shields.io/badge/SvelteKit-2.70-FF3E00) ![svelte](https://img.shields.io/badge/Svelte-5.57-FF3E00) ![tailwind](https://img.shields.io/badge/Tailwind-4-38BDF8) ![license](https://img.shields.io/badge/License-MIT-green)

## 特性

- 内容系统：文章 / 项目 / 文档（Wiki 模式），文件即内容，Git 可追踪
- 管理后台：仪表盘、内容 CRUD、拖拽排序、置顶、草稿/发布
- 多用户权限：admin / editor 角色，数据隔离
- 媒体库：拖拽上传、类型/大小校验、预览
- 评论系统：前台提交、后台管理
- 友链申请：前台表单、后台审核、自动上链
- 响应式：侧边栏自适应无滚动条、目录移动端折叠
- 数据备份：JSON 导出，支持 AES-256-GCM 加密
- 编辑器：分栏实时预览 + Markdown 工具栏 + 代码高亮
- 导航管理：侧边栏分组可排序、增删、编辑
- 站点设置：标题/描述/社交链接后台配置
- 动画：MorphIcons 图标变形 + 克制优雅入场动画，尊重 reduced-motion

## 快速开始

```bash
pnpm install
pnpm dev        # http://localhost:5175

# 生产
pnpm build
node .svelte-kit/output/server/index.js   # 需切换 adapter-node
```

默认管理员：admin / stelarith-admin（生产务必修改！见 DEPLOYMENT.md）

## 项目结构

```
content/            # 所有内容（Markdown + JSON）
  posts/            # 博客文章
  docs/             # Wiki 文档
  projects/         # 项目
  users.json        # 用户（加盐哈希）
  settings.json     # 站点设置
  nav.json          # 导航配置
  comments.json     # 评论
  link-applications.json  # 友链申请
uploads/            # 上传的媒体文件
src/routes/admin/   # 管理后台
src/lib/server/     # 存储层与鉴权
```

## 文档

- 部署指南（DEPLOYMENT.md）— Node / Docker / Vercel / CF Pages / Netlify
- 动画方案（ANIMATION.md）— 动画选型与实现
- 开发约定（RUNES.md）— Svelte 5 runes 速查

## 技术栈

- SvelteKit 2 + Svelte 5（runes）
- Tailwind CSS v4 + shadcn-svelte + bits-ui（Radix primitives）
- lucide-svelte + morphicons（图标与变形动画）
- gray-matter + markdown-it + highlight.js（Markdown 渲染）

## 安全说明

- 密码 scrypt 加盐哈希存储
- 管理后台 /admin 全路由鉴权（HttpOnly Cookie）
- 多用户数据隔离：editor 仅可管理自己的内容
- 备份可 AES-256-GCM 加密导出

## 贡献

欢迎提交 Issue 与 PR，见 CONTRIBUTING.md。

## License

MIT