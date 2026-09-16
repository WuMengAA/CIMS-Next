# 现场部署与编译清单（Field Deploy & Build Runbook）

> 适用：终验交付后，运维/电教委员在真实环境落地本方案包。
> 原则：**不虚构任何网关**。所有「下令」来自 CIMS 真实通知，所有「执行」都在本机；跨服务的协作（聊天/工单/审计/VNC 回执）走自有扩展网关 `ext-gateway`（应用级新增，非 CIMS 源码修改）。
> 本文件所有命令均取自各组件 README，未新增任何接口。

---

## 0. 组件总览与落点

| 组件 | 类型 | 落点 | 编译环境 | 是否本机可验证 |
|---|---|---|---|---|
| CIMS-backend | FastAPI + gRPC（只读，不修改） | Docker 容器 | Docker | 是（docker compose） |
| admin-console 面板 | Tauri 壳 + 零框架前端 | 电教委员 PC（内嵌 `/admin/console`） | 前端无需编译；Tauri 需目标机 | 前端逻辑可 Node 测 |
| stelarith-agent（Rust） | 设备侧常驻代理 | 每台班级 Windows 设备 | 目标机 cargo | 否（本机无 cargo） |
| stelarith-agent-node | Rust 代理的 Node 参考实现 | CI / 冒烟 / 目标机兜底 | Node 20 | **是（npm test）** |
| stelarith-classisland-plugin | ClassIsland 集控插件 | 每台班级 Windows 设备 | 目标机 .NET 8 | 否（本机无 .NET） |
| ext-gateway | 协作/上报/VNC 回执后端 | 服务端（与 CIMS 同机或独立） | Docker / Node | 是（node server.mjs） |
| voicehub-sync | 校园点歌即插即用模块 | 随面板加载 | 无编译 | 是（node --test） |
| stelarith-website-sync | 指令令牌 Ed25519 签名 | 网站侧（签名用私钥） | Node | 是（已实跑） |

---

## 1. 服务端：CIMS + 扩展网关（一键部署）

```bash
cd deploy
# 1) 放入 CIMS-backend 源码（只读，勿改其源码）
cp -r /path/to/CIMS-backend ./cims-src
cp deploy/Dockerfile ./cims-src/Dockerfile

# 2) 环境变量
cp .env.example .env
#   必改：DB_PASSWORD / CIMS_SECRET_KEY / ADMIN_PASSWORD / CIMS_PUBLIC_HOST
#   集控相关：EXT_GATEWAY_PORT=8088 / STELARITH_TASK_SECRET（与面板「指令密钥」一致）

# 3) TLS 证书（内网可自签）
mkdir -p certs && cp fullchain.pem privkey.pem certs/

# 4) 启动（含 postgres / redis / cims / nginx / ext-gateway 五服务）
docker compose up -d --build
```

- 扩展网关随 `ext-gateway` 服务起，监听 `${EXT_GATEWAY_PORT}`（默认 8088），经 nginx `location /ext/` 反代。
- 面板「连接设置 → 扩展网关地址」填 `http://<host>:8088`。
- 设备代理回报 VNC 会话：`STELARITH_EXT_URL=http://<host>:8088`。

运维：日志 `docker compose logs -f cims`；备份 `docker compose exec postgres pg_dump -U $DB_USER $DB_NAME > backup.sql`。

---

## 2. 设备侧：本地代理（二选一）

### 2.1 生产推荐 · Rust 版（单二进制约数 MB，零运行时依赖）

> 本机（开发/巡检环境）无 cargo，无法编译；以下在**目标 Windows 设备**执行。

```bash
cd ext/stelarith-agent
cargo build --release          # 含 ed25519-dalek / base64，需联网拉取
# 部署：将 target/release/stelarith-agent.exe 设为开机自启 / 系统服务
```

环境变量（目标机）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `STELARITH_AGENT_PORT` | `17999` | 仅监听 127.0.0.1 |
| `STELARITH_AGENT_SECRET` | `dev-secret-change-me` | HMAC 联调密钥；生产改用公钥 |
| `STELARITH_SITE_PUBKEY` | `""` | 网站 Ed25519 公钥（SPKI PEM），配置即启用非对称验签 |
| `STELARITH_EXT_URL` | `""` | 扩展网关基址，回报 VNC 会话 |
| `STELARITH_DEVICE_UID` | `unknown` | 本机设备标识 |
| `STELARITH_VNC_CMD` | `vncserver` | 真实 VNC 启动命令 |

### 2.2 兜底 / 冒烟 · Node 参考实现（无需 cargo，可直接跑）

```bash
cd ext/stelarith-agent-node
npm test                 # 端到端冒烟：签名↔验签↔VNC↔noVNC，全绿即闭环成立
node agent.mjs                       # 真实模式
MOCK_VNC=1 node agent.mjs            # 模拟 VNC（无真实二进制也可跑）
node agent.mjs --dry-run             # 全动作模拟，不碰系统（CI/安全用）
```

> Node 版是 Rust 版的**回归基准**：两者 `verify()` / `verify_ed25519()` 契约一致，message 均为 `action|ts`，均校验 `|now-ts|<=60s`。

---

## 3. 设备侧：ClassIsland 集控插件

> 需要 **.NET 8 SDK** + **ClassIsland.PluginSdk**（NuGet）。本机无 .NET / 非 Windows，需在目标 Windows 设备编译。

```bash
cd ext/stelarith-classisland-plugin
dotnet build -c Release
# 部署产物到：
#   %APPDATA%\ClassIsland\Plugins\StelarithControlPlugin\
# 重启 ClassIsland 自动扫描 [PluginEntrance] 程序集
```

- 插件接收 CIMS 经 `send-notification` 下发的 `stelarith_task`，`lock`/`screenshot` 本机执行；其余转发 `POST http://127.0.0.1:17999/task` 给本地代理。
- 版本适配点（按目标 ClassIsland 版本核对）：`INotificationHost` / `NotificationReceived` / `Notification.MessageContent` / `PluginBase.GetService<T>()` / 设置页入口 —— 见插件 README §5。

---

## 4. 面板：电教委员集控面板

- 前端零框架，无需编译：`admin-console/src/{api,app}.js` 直接用。
- Tauri 壳：目标机 `tauri build`（需 Rust + WebView2）；开发态 `tauri dev`。
- 嵌入网站：镜像已同步至 `stelarith-website/stelarith/static/console/{api,app}.js`，作为 `/admin/console` 子页面（SSO 同源）。
- 自检（开发/CI）：`node verify.mjs`（32 项产物 + 契约 + 网关 `/health` + 聊天房间隔离）。

关键设置项（面板内）：
- 后端地址：CIMS client 端口基址（`CIMS_CLIENT_BASE_URL`）。
- 扩展网关地址：`http://<host>:8088`。
- 指令密钥：与 `STELARITH_TASK_SECRET` / Rust 代理 `STELARITH_AGENT_SECRET` 一致（HMAC 联调）；生产在网站侧启用 Ed25519 后即走非对称验签。

---

## 5. 校园点歌联动（voicehub.245959623.xyz）

- 服务端适配器 `ext/voicehub-sync/voicehub-adapter.mjs`：推送写 CIMS 已核实资源 `Components/write?name=songboard`（与面板 `api.js:voicehubPush` 同一端点）。
- 浏览器端即插即用模块 `ext/voicehub-sync/voicehub-embed.mjs`：导出 `VoicehubEmbed`（list/request/pushToScreen/render），面板内嵌「校园点歌」即此模块。
- 契约测试：`node ext/voicehub-sync/voicehub-embed.test.mjs`（5/5）。

---

## 6. 指令令牌签名（生产安全升级）

```bash
cd ext/stelarith-website-sync
node sign-task.mjs            # 生成 Ed25519 密钥对，导出 SPKI PEM 公钥
# 公钥下发到各设备作 STELARITH_SITE_PUBKEY；私钥留网站侧签名，不下发前端
```

- 代理 `STELARITH_SITE_PUBKEY` 一旦配置即启用 Ed25519 非对称验签，HMAC 模式自动让位。
- message 均为 `action|ts`，`|now-ts|<=60s` 防重放。

---

## 7. 终验前后冒烟清单

| 检查 | 命令 / 路径 | 预期 |
|---|---|---|
| 产物齐全 | `node verify.mjs` | 32/32 PASS |
| 扩展网关存活 | `curl <host>:8088/health` | 含 notices/chat/reports/bugs/audit/vnc |
| 代理验签闭环 | `npm test`（agent-node） | 全绿（含非法令牌 401） |
| 面板远程控制 | 面板「远程控制」下发→轮询→noVNC 内嵌 | 出现屏幕 |
| 点歌上屏 | 面板「推送到本班屏幕」 | CIMS `Components/songboard` 写入 |
| 聊天跨班隔离 | 扩展网关 `/chat?room=class_a1` vs `techrep-global` | 互不可见 |

---

## 8. 已知边界（非阻塞）

- **bidi gRPC**：grpcio 1.78 真实 socket 下 bidi 流有边界，属已知；MVP 用 Manifest 拉取模式，不影响单向指令链路（lock/重启/通知/VNC 回执均 HTTP/单向）。
- **目标机编译**：Rust 代理 `cargo build`、ClassIsland 插件 `dotnet build` 需在目标 Windows 设备回归（本机无 cargo/.NET）。
- **推送**：父仓库领先 `origin/solution-pack` 若干 commit，待授权后 `git push`；inner stelarith 仓库同理。
- **红线**：CIMS-backend 源码、OS 配置、凭据、网站敏感配置均不修改；本方案包全部为应用级新增/修改。
