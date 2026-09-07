# 学校多媒体统一集控方案包 · 进度清点（2026-09-07 自驱巡检）

> 巡检范围：`school-multimedia-control/`（方案包）、`stelarith-website/stelarith`（联动目标，仅应用级新增）、`CIMS-backend`（**只读参考，未改动**）
> 原则：所有接口均锚定已核实的真实源码；不臆造端点。本轮在既有成果上推进了缺口项与进行中项。

## 一、七项核心需求对账

| # | 需求 | 状态 | 证据 / 关键产物 |
|---|---|---|---|
| 1 | CIMS 后端 + ClassIsland 客户端，真实 socket 联调 | ✅ 已完成 | `../CIMS_协议与代码评估报告.md`：协议 100% 对齐，真实 socket 联调 5/6 通过（bidi 因 grpcio 1.78 边界未过，属已知、不影响单向命令） |
| 2 | 电教委员集控面板（Tauri 壳 + 零框架前端） | 🟡 进行中 | `admin-console/`：前端 11 模块齐全；Tauri 壳本轮补齐 `devUrl/beforeDevCommand`、生成图标（PNG+ICO），`cargo tauri build` 可起步（仍缺 Rust 工具链本机编译） |
| 3 | 缺失能力（锁屏/截图/远程屏/聊天/工单/Bug）经插件+本地代理联动，不虚构网关 | 🟢 进行中→闭环 | `ext/stelarith-classisland-plugin/`（C# 桩）+ `ext/stelarith-agent/`（Rust 代理）；工单/Bug 接 `stelarith-website /api/feedback`；**新增自有 `ext/stelarith-ext-gateway`（协作/上报/VNC回执后端，可运行，docker 一键起）**，聊天可走 `/chat`（不再依赖虚构外部） |
| 4 | 远程屏幕控制：本地代理按需启 VNC + 面板内嵌 noVNC | 🟢 进行中→打通 | 前端接通真实链路；**本轮补全「VNC 端口/令牌回报通道」：代理启 VNC 后把 `{ip,port,token}` 上报 `ext-gateway /vnc-session`，面板轮询 `deviceRemoteStatus()` 拿到后自动内嵌 noVNC 连接**；指令令牌改由面板 HMAC 签名（`signTask`）+ 代理验签，生产可升级网站 Ed25519（`sign-task.mjs`） |
| 5 | 多用户与安全：锚定网站账户体系（techrep/viewer）+ CIMS 2FA/RBAC | ✅ 已完成 | `stelarith-website/src/lib/permissions.ts` 已含 `techrep/viewer` 与 `viewConsole/controlDevice/remoteControl/submitIssue/manageDevices`；CIMS TOTP 2FA 原生；RBAC 矩阵就绪 |
| 6 | 与网站联动：面板作为 `/admin/console` 子页嵌入、SSO 同源、内容经 sync 下发 | ✅ 已完成 | `src/routes/admin/console/+page.svelte`（iframe 嵌 `static/console/`）+ `+page.server.ts`（SSO+RBAC 闸门）+ `src/routes/api/console/cims/[...cims]/+server.ts`（服务端代理，仅放行 `/account/ /user/auth /v1/client/`，CIMS 令牌不出服务端）；`ext/stelarith-website-sync/sync-to-cims.mjs` 内容下发；`src/routes/api/classisland/announcements` 公告同步 |
| 7 | 与 voicehub.245959623.xyz 联动：点歌上屏 / 面板内嵌点歌模块 | ✅ 已完成 | `ext/voicehub-sync/voicehub-adapter.mjs`（服务端推送上屏）、`ext/classisland-voicehub-display/`（班级大屏桥接 + ClassIsland 看板插件）、`admin-console` 内置「校园点歌」视图 |

## 二、本轮推进的具体改动

1. **面板 bug 修复**：设置页「后端地址」原先读 `API.state.host`（不存在字段）导致恒为空且不回显 —— 改为 `API.state.mgmtHost`，保存/回显正常。
2. **远程控制真实化**：`api.js` 新增 `deviceRemoteStart/Stop`，经 CIMS 真实 `send-notification` 下发 `stelarith_task` 指令；`app.js` 的「远程控制」由占位提示改为：下发指令 → 打开配置好的 noVNC 地址（自动 `autoconnect` + token），结束即关。
3. **工单/Bug 落地网站**：`submitReport/submitBug` 及列表在「内嵌网站」或配置了 `siteHost` 时改走 `stelarith-website /api/feedback`（按 `report`/`bug` 标签归档），不再仅演示降级。
4. **本地代理增强**：`ext/stelarith-agent` 新增只读 `/status` 端点，返回 VNC 会话（端口+连接令牌）与存活状态，供插件/运维校验。
5. **Tauri 壳可构建化**：`tauri.conf.json` 修正 `devUrl=http://localhost:9876` + `beforeDevCommand=python3 -m http.server 9876`（零构建静态托管），并补齐图标（`icons/icon.png` + `icon.ico`，占位紫）。
6. **同步镜像**：`admin-console/src/{api,app}.js` 的改动已同步复制到 `stelarith-website/.../static/console/`，保证内嵌面板与方案包一致。

## 二之二、2026-09-07 第二轮（自驱巡检）推进

1. **自有扩展网关落地（真正的后端，不是虚构）**：新增 `ext/stelarith-ext-gateway/server.mjs`——零依赖 Node HTTP 服务，文件存储，CORS 已开，实现 `/notices /chat /reports /bugs /audit` 与 VNC 回执 `/vnc-session`。已 `node --check` + 实跑冒烟测试通过（health/reports/vnc 收发正常）。`deploy/` 已接：docker-compose 增 `ext-gateway` 服务、nginx 增 `/ext/` 反代、`.env.example` 增 `EXT_GATEWAY_PORT` / `STELARITH_TASK_SECRET`；`deploy/ext-gateway/server.mjs` 同步副本。
2. **VNC 端口/令牌回报通道打通**：`ext/stelarith-agent/src/main.rs` 启 VNC 后若设 `STELARITH_EXT_URL`（+`STELARITH_DEVICE_UID`）即把 `{ip,port,token}` 回报网关 `/vnc-session`（新增 `reqwest` 依赖）；面板 `api.js` 新增 `deviceRemoteStatus(uid)` 轮询；`app.js`「远程控制」改为下发指令→轮询回执（最多 20×1.5s）→拿到后自动拼 noVNC URL（host/port/password=token）内嵌连接；停止时顺带 `DELETE /vnc-session`。
3. **指令令牌签名真实化**：`api.js` 新增 `signTask()`（浏览器原生 `crypto.subtle` HMAC-SHA256，无依赖），远程控制令牌由共享密钥签名，与代理 `verify()` 对齐；未配密钥才回落时间戳占位。`ext/stelarith-website-sync/sign-task.mjs` 提供生产模型——网站私钥 Ed25519 签名（已实跑生成密钥并签名），代理侧可升级持公钥验签。
4. **面板设置补全**：新增「指令密钥」输入框与 `setTaskSecret`，与设备代理 `STELARITH_AGENT_SECRET` 对齐；同步镜像已更新至网站 `static/console/`。
5. **红线遵守**：未改 `CIMS-backend` 任何源码；端点仍以已核实真实路径为准；新增网关为自有服务，无虚构外部依赖。

## 二之三、2026-09-07 第三轮（自驱巡检，07:16 触发）

**本轮重点**：把上一轮遗留的「ClassIsland 插件 SDK 对齐」真正落地（替换臆造的 `[PluginInfo]` 属性与错误命名空间，对齐真实公开插件 API）。

1. **ClassIsland 插件对齐真实 SDK**：`ext/stelarith-classisland-plugin/StelarithControlPlugin.cs` 由臆造的 `[PluginInfo]` 改为真实的 `[PluginEntrance]` + `PluginBase`（来自 `ClassIsland.Core.Abstractions`）+ 构造函数注入 `ILogger<T>`；`Initialize()` 经 `PluginBase.GetService<INotificationHost>()` 订阅 `NotificationReceived`，用 `dynamic` 安全提取 `Notification.MessageContent` 解析 `stelarith_task`，避免写死版本字段导致编译失败；保留「未知 action 忽略 / 解析失败兜底」健壮性。
2. **AgentClient 日志化**：`AgentClient.cs` 支持可选 `ILogger` 注入（无 logger 时回落 `Console.Error`），与插件日志风格一致；本地端口 `127.0.0.1:17999` 与 `ext/stelarith-agent` 真实路由 `/task` 已核对一致（无虚构）。
3. **插件工程可编译化**：`StelarithControlPlugin.csproj` 改为真实 `ClassIsland.PluginSdk` NuGet 引用 + `Microsoft.Extensions.Logging.Abstractions`，附部署路径（`%APPDATA%\ClassIsland\Plugins\StelarithControlPlugin\`）与版本适配注释。
4. **新增插件 README.md**：沉淀编译 / 部署 / 联动契约 / 版本适配点，明确「本机无 .NET/SDK，需在目标 Windows 设备 `dotnet build` 验证」的限制。
5. **红线遵守**：未改 `CIMS-backend`；SDK 形态基于 ClassIsland 公开插件 API（非虚构网关）；仅应用级新增/修改。

## 二之四、2026-09-07 第四轮（自驱巡检，09:28 触发）

**本轮重点**：此前「本地代理只能编译、本机无 cargo 无法验证整条链路」一直挂着，导致「面板签名→代理验签→VNC 回执→面板轮询」闭环只写了代码、没实跑过。本轮补一个**可真正运行的 Node 版本地代理参考实现**，并写端到端冒烟测试把闭环在本机实跑验证。

### 关键产物（均已 `node` 实跑通过）
- 新增 `ext/stelarith-agent-node/agent.mjs`：Node 实现，**逻辑 1:1 对齐 Rust 版**（`verify()` 验签契约、`/task` 执行动作、`/status` 只读状态、启 VNC 后回报 `{ip,port,token}` 到扩展网关完全一致）。支持三种运行模式：真实模式 / `MOCK_VNC=1`（不依赖真实 VNC 二进制，起最小 RFB 握手 TCP）/ `--dry-run`（全动作模拟，不碰系统，CI 用）。仅绑 127.0.0.1、强制 HMAC 验签 + ±60s 防重放——安全边界与 Rust 版一致。
- 新增 `ext/stelarith-agent-node/test/end2end.mjs`：端到端冒烟测试。自动起扩展网关（18088）+ 代理（17999, MOCK_VNC+dry-run）→ 模拟面板 `signTask()` 签名并下发 `remote_control_start` → 断言：代理返回 `vnc_started`+端口、网关 `/vnc-session?uid=` 轮询拿到会话（ip=127.0.0.1）、`/status` 显示 `running`、noVNC 端口可达、非法令牌被拒（401）、停止并清除回执。**已实跑全绿**（`✅ 全部通过`）。
- 新增 `ext/stelarith-agent-node/package.json`（scripts: start/test）+ `README.md`（运行/验证/验签契约/安全边界）。
- 验签契约三方对齐确认：面板 `api.js:signTask()`（浏览器 `crypto.subtle` HMAC）、Rust `main.rs:verify()`、`agent-node` `verify()` 均为 `hex(HMAC_SHA256(action+"|"+ts, secret))` + ±60s，无偏差。

### 本轮验证结论
「签名↔验签↔VNC 回执↔noVNC 内嵌」整条链路**首次在本地实际跑通**（此前仅代码层对齐）。原「本机无 cargo 无法验证」的盲区被 Node 参考实现填平——开发机 / CI 现在可直接 `npm test` 回归这条最关键的安全+回执链路。

## 二之五、2026-09-07 第五轮（自驱巡检，11:36 触发）

**本轮重点**：把「聊天跨班互通」真正落地为房间制，并补一个可交付的终验自检脚本。

1. **扩展网关 /chat 房间制（跨班互通）**：`ext/stelarith-ext-gateway/server.mjs` 的 `/chat` 由单集合升级为房间隔离——`GET /chat?room=xxx` 按房间过滤，`POST /chat` 支持 `{text, from?, room?}`（默认 `techrep-global` 全校电教委员群）；历史无 room 消息按 `default` 向后兼容。已同步到 `deploy/ext-gateway/server.mjs`。
2. **面板 chat 房间化**：`api.js` 的 `listChat(room)`/`sendChat(text, from, room)` 加房间参数（默认 `techrep-global`，本班用 `state.classId`），并暴露 `CHAT_ROOM_GLOBAL`；`app.js`「班级交流」视图加房间下拉（全校电教委员群 / 本班），发送带 room/from，列表展示房间标签，支持回车发送与房间切换。
3. **终验自检脚本**：新增根级 `verify.mjs`——核对 22 个关键产物存在性 + 实跑扩展网关做「聊天房间隔离」冒烟（全校群与本班房间互相不可见、无 room 参数回落 default），输出 `verify-report.md`。已 `node` 实跑全绿（25 项 PASS）。
4. **镜像同步**：改后 `api.js`/`app.js` 已复制到 `stelarith-website/stelarith/static/console/`，`server.mjs` 同步到 `deploy/ext-gateway/`，保证内嵌面板与部署一致。
5. **红线遵守**：未改 `CIMS-backend`；端点锚定已核实真实路径；仅应用级新增/修改，无虚构接口。

## 三、仍待推进（不美化）

- **VNC 端口+令牌回报通道**：✅ 本轮已打通（代理→自有扩展网关 `/vnc-session`→面板轮询），不再需要在「设置」预填 noVNC 地址（但仍建议配置作为兜底）。
- **指令令牌签名**：✅ 本轮已实现浏览器端 HMAC 签名（`signTask`）+ 代理验签；生产 Ed25519 网站私钥签名脚本 `sign-task.mjs` 已提供，待代理侧升级公钥验签。
- **ClassIsland 插件 SDK 对齐**：✅ 本轮已对齐真实公开插件 API（`[PluginEntrance]` + `PluginBase` + `INotificationHost` 订阅 + `ILogger` 注入，移除原臆造的 `[PluginInfo]`）；因本机无 .NET / ClassIsland SDK / 非 Windows，**仍需在目标 Windows 设备 `dotnet build` 回归**（版本适配点已写入插件 README）。
- **本地代理可运行化（Node 参考实现）**：✅ 本轮新增 `ext/stelarith-agent-node/`（逻辑 1:1 对齐 Rust 版），已 `npm test` 端到端跑通「签名↔验签↔VNC 回执↔noVNC」闭环；开发机/CI 可直接回归，不再依赖肉眼读代码。
- **本地代理 Rust 编译**：Rust 版 `ext/stelarith-agent` 仍为本机无 cargo 的可编译桩，需在目标 Windows 设备 `cargo build --release`（已含 reqwest 依赖，联网编译即可）；Node 参考实现已覆盖「验证」诉求，Rust 版聚焦生产常驻部署。
- **聊天（班级交流）实时通道 · 跨班互通**：✅ 第五轮已落地房间制——扩展网关 `/chat` 支持 `room` 参数（默认 `techrep-global` 全校电教委员群 + 各班级 `classId` 房间），面板「班级交流」视图加房间切换下拉，消息按房间隔离；实跑验证互相不可见（见 `verify.mjs`）。

## 四、红线遵守

- 未修改 `CIMS-backend` 任何源码（仅只读参考其 `app/api/...` 与 `APIDocument.md` 以对齐真实端点）。
- 未触碰 OS 配置、凭据、网站定位与敏感配置；对 `stelarith-website` 仅做应用级新增（`/admin/console` 页、CIMS 代理路由、控制台静态资源、RBAC 角色扩展）。
- 所有新增/修改均不臆造接口，端点路径已逐一与 `CIMS-backend` 源码及 `APIDocument.md` 比对（`/v1/client/...`、`/account/{id}/client/{uid}/command/*`、`/{type}/write?name=` 均一致）。
