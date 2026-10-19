# Stelarith Website

> Stelarith 站点：博客 / 知识库 / 项目 / 班级站（class8）+ 集控管理台 `/admin/console`。
> SvelteKit 2 + Svelte 5（runes）+ TypeScript + Tailwind CSS v4 + adapter-node。

> **2026-10-19**：CIMS 集控方案包已退出本仓库（原 `deploy/` CIMS 包、`ext/`、`admin-console/` 等
> 顶层集控物已移除）。网站自身的 `/admin/console`（数据存站点本地库）保留；对外部 CIMS 的集成
> 代码按降级兜底运行——无 CIMS 服务器时自动退化，不影响站点核心（博客 / 鉴权 / 班级站 / 看板等）。

## 特性

- 内容系统：文章 / 项目 / 文档（Wiki 模式），文件即内容，Git 可追踪（`content/`）
- 管理后台：仪表盘、内容 CRUD、拖拽排序、置顶、草稿 / 发布
- 多用户权限：admin / editor 等角色，数据隔离
- 媒体库 / 附件库：拖拽上传、类型 / 大小校验、预览（`uploads/`）
- 班级站 class8、项目看板、论坛、友链申请、RSS
- 集控管理台 `/admin/console`：设备 / 广播 / 审计等（站点本地数据）
- 数据层：默认 SQLite；云端可切 PostgreSQL（`DB_BACKEND=pg` + `DATABASE_URL`），方言层对业务透明

## 快速开始

```bash
pnpm install
pnpm dev        # http://localhost:8091

# 生产构建（adapter-node → build/）
pnpm build
node build/index.js   # 监听 PORT（默认 8090）
```

- 数据目录由 `STELARITH_DATA_ROOT` 决定（缺省工程根）：`content/`（Markdown / JSON / 库）与
  `uploads/`（上传）平级于此——一个变量管两个目录，便于环境隔离。
- 数据库：默认 SQLite（`content/stelarith.db`）；设 `DB_BACKEND=pg` + `DATABASE_URL` 即走 PostgreSQL。
- 原子发布：`node scripts/release-site.mjs build|switch|status`（旁路 `build.next` 构建，验收失败自动回滚）。

## 云端部署

- 容器化部署包：[`deploy/site/README.md`](deploy/site/README.md)（网站 + PostgreSQL + Nginx）
- 动静分离 / 边缘缓存 / R2 目标态蓝图：[`docs/CLOUD-DEPLOYMENT.md`](docs/CLOUD-DEPLOYMENT.md)
- SQLite↔PostgreSQL 等价性验证：[`docs/CLOUD-PARITY-REPORT.md`](docs/CLOUD-PARITY-REPORT.md)

## 项目结构

```
content/            # 所有内容（Markdown + JSON）+ SQLite 库
  posts/ docs/ projects/ ...
  users.json / settings.json / nav.json / ...
uploads/            # 上传的媒体 / 项目板文件
src/routes/         # 页面与 API（含 admin 后台、admin/console 集控台、api/console/*）
src/lib/server/     # 数据层（db.ts 统一门面 + Sqlite/Pg 后端）、鉴权、内容存储
static/             # 静态资源
build/              # adapter-node 产物（pnpm build 生成，勿手改）
deploy/site/        # 云端部署包（Dockerfile / compose / nginx）
scripts/            # 发布 / 备份 / parity 等脚本
```

## 技术栈

- SvelteKit 2 + Svelte 5（runes）+ TypeScript
- Tailwind CSS v4 + shadcn-svelte + bits-ui
- lucide-svelte + morphicons（图标与变形动画）
- gray-matter + markdown-it + highlight.js + katex（Markdown / 公式）
- 数据层：`node:sqlite` / `pg`，统一异步门面 `src/lib/server/db.ts`

## 安全说明

- 密码加盐哈希存储；管理后台全路由鉴权（HttpOnly Cookie）
- 多用户数据隔离：editor 仅可管理自己的内容
- 备份可加密导出（`scripts/backup-db.mjs`）；云端周期备份 `scripts/backup-cloud.mjs`
- 公网暴露前务必读 `deploy/site/README.md` 的 CSRF / ORIGIN 注意事项

## License

MIT
