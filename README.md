# 学校多媒体统一集控方案 · CIMS-School-Multimedia-Control

> 校园多媒体设备统一集控：电教委员在集控面板一键下发指令到各班 ClassIsland 客户端。
> 算法与小模型驱动，"可停留的空间"体验——不拼资源拼体验（视觉 / 音效 / 交互）。

---

## 1. 定位与边界

- **定位**：校园局域网多媒体设备集控，覆盖广播 / 打铃 / 锁屏 / 截图 / 远程屏幕 / 聊天 / 工单 / Bug 上报。
- **边界（明确不做）**：不做社交评论、不做云端推荐、不以 Hi-Fi 玄学为卖点。
- **红线**：`CIMS-backend/`（参考后端，父目录）**只读**，绝不修改；不碰任何系统敏感文件 / 凭据。

---

## 2. 架构总览

```
电教委员集控面板 (admin-console/, 零框架前端 + Tauri 壳)
      │  REST / gRPC command
      ▼
CIMS 集控后端 (Go, gRPC command + socket)   ← 只读参考 ../CIMS-backend/
      │  command 下发 + 资源写入
      ▼
ClassIsland 客户端插件 (ext/stelarith-classisland-plugin/, C#)
      │  设备操作 / 屏幕回执 / VNC 按需启停
      ▼
班级大屏（锁屏 / 截图 / 远程 VNC / 点歌看板）

联动层：
- stelarith-website：/admin/console 子页面（SSO 同源，内嵌面板）+ 公开 /voicehub 页（SSR 实时点歌榜）
- voicehub 校园点歌：ext/classisland-voicehub-display 桥接（Node 轮询 + 大屏看板）+ ClassIsland 看板插件
```

---

## 3. 目录结构

| 路径 | 说明 |
|------|------|
| `admin-console/` | 电教委员集控面板（前端 `src/` + Tauri 壳）。零框架、轻量、全能、API 友好 |
| `ext/stelarith-classisland-plugin/` | ClassIsland 客户端插件（锁屏 / 截图 / 远程 / VNC / OS 动作） |
| `ext/stelarith-agent/` | 本地代理（Rust，按需启 VNC + 回执通道；生产常驻） |
| `ext/stelarith-agent-node/` | 本地代理 **Node 参考实现**（逻辑 1:1 对齐 Rust 版，可免 cargo 直接跑、含端到端冒烟测试） |
| `ext/classisland-voicehub-display/` | voicehub 点歌大屏桥接（Node 桥接 `bridge/` + ClassIsland 看板插件 `plugin/`） |
| `ext/voicehub-sync/` | voicehub 推送适配器（服务端 / CI 侧写 CIMS 资源，点歌上屏） |
| `ext/stelarith-ext-gateway/` | 自有扩展网关（协作 / 上报 / 指令令牌签名） |
| `ext/stelarith-website-sync/` | 网站联动同步脚本（权限补丁 / 代理 / 推送 CIMS） |

> 缺失功能（锁屏 / 截图 / 远程屏幕 / 聊天 / 工单 / Bug）一律经 **ClassIsland 插件 + 本地代理** 联动，不虚构网关。

---

## 4. 真实接口契约（已核实源码，非臆造）

### 4.1 CIMS 集控后端
- `management` 端口：账户 / 设备 / 组件管理（详见 `../CIMS-backend/` 源码）。
- `client` 端口：班级客户端注册 / 心跳 / 指令回执。
- 联调状态：**真实 socket 5/6 通过**；bidi gRPC 因 `grpcio 1.78` 边界未过（已知，修复在跟进）。

### 4.2 voicehub 校园点歌（已读 `server/api/open/*` 源码核实）
- 鉴权：`x-api-key` 请求头（key 格式 `vhub_...`，对应权限 `songs:read` / `songs:request` / `schedules:read`）。
- `GET /api/open/songs?played=true&sortBy=playedAt&sortOrder=desc&limit=1` → 当前播放。
- `GET /api/open/songs?played=false&sortBy=createdAt&sortOrder=asc&limit=N` → 待播队列。
- `POST /api/open/songs/request`（body: `title` / `artist` / `requester`）→ 点歌。
- `GET /api/open/schedules` → 排期。

---

## 5. 运行

### 集控面板（电教委员）
```bash
cd admin-console
# 演示模式：直接浏览器打开 src/index.html
# 或 Tauri 构建（见 admin-console/ 内 Tauri 配置）
```

### voicehub 大屏桥接
```bash
cd ext/classisland-voicehub-display/bridge
VOICEHUB_BASE=https://voicehub.245959623.xyz \
VOICEHUB_KEY=vhub_xxx \
POLL_SEC=30 PORT=8787 \
node bridge.mjs
# 大屏看板： http://localhost:8787/board
# 看板 JSON： http://localhost:8787/api/songboard
```

### 网站联动（stelarith-website）
```bash
git switch feat/multimedia-console
# .env 配置：
#   CIMS_ACCOUNT / CIMS_TOKEN / CIMS_BASE  （集控代理，服务端用）
#   VOICEHUB_BASE / VOICEHUB_KEY            （点歌公开页，服务端用）
```
- `/admin/console` 子页面：需 `viewConsole` 角色（techrep / viewer / admin），SSO 同源。
- 公开 `/voicehub` 页：SSR 渲染实时点歌榜（无 key 时优雅降级为"未接入"提示）。

---

## 6. 多用户与安全

- 账户体系锚定 **stelarith-website**（已扩 `techrep` 电教委员 / `viewer` 只读 + 集控动作）。
- CIMS 2FA / 多租户 / RBAC 矩阵见权限设计（见 `ext/stelarith-website-sync/permissions-patch.ts`）。
- 面板内嵌 `/admin/console` 时复用网站会话，自身登录自动跳过；浏览器不持 CIMS 凭据（经服务端代理转发）。

---

## 7. 已知边界与待办

- [ ] bidi gRPC 边界（`grpcio 1.78`）——已知未过，修复在跟进。
- [ ] **GitHub 推送**：本机两个仓库（网站 / 方案包）当前均未配置 remote，且网站 GitHub 地址无法从本地推断（4 个猜测均 404）。文件已落地，push 待 remote 配置 / 地址确认后执行（经 Cloudflare 加速镜像 `gh.245959623.xyz` + PAT）。
- [ ] 面板 `/admin/console` 内嵌自适应的端到端浏览器验证（已做代码级跳过登录逻辑，未做真机浏览器跑测）。
- [ ] voicehub 联动的"点歌上屏"端到端验证（桥接代理已单测通过，未接真实 voicehub 实例）。
- [x] **ClassIsland 插件 SDK 对齐**：已对齐真实公开插件 API（`[PluginEntrance]` + `PluginBase` + `INotificationHost` 订阅 + `ILogger` 注入，移除原臆造的 `[PluginInfo]`）；因本机无 .NET / ClassIsland SDK / 非 Windows，需在目标 Windows 设备 `dotnet build` 回归（见 `ext/stelarith-classisland-plugin/README.md`）。

---

## 8. 变更记录

- 集控面板：`/admin/console` 子页面嵌入、远程控制（启停 VNC + noVNC 内嵌）、校园点歌模块（真实对接 voicehub 公开 API）、推送上屏。
- 网站：`permissions.ts` 扩 `techrep` / `viewer`；`hooks.server.ts` 放开 `/admin/console` 给 `viewConsole`；`admin/+layout.svelte` 加集控入口；新增 `/admin/console`、`/voicehub`、`/api/console/cims` 代理。
- 联动套件：`ext/classisland-voicehub-display`（桥接 + ClassIsland 插件）、`ext/voicehub-sync`（推送适配器）。


---

## 附录：stelarith-website 内容管理系统（CMS）

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