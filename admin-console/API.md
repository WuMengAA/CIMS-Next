# 星集控面板 · 后端 API 契约（对接真实 CIMS）

> 本文档列出的每一个端点都已在 `CIMS-backend` 源码中核实存在（非虚构）。
> 面板 `src/api.js` 的 `cims()` / `cli()` / `ext()` 三类调用分别对应下方 ✅ 原生 / ⚠️ 扩展网关。

## 0. 端口与认证

CIMS 是多端口 uvicorn 服务。面板需要配置两个地址（nginx 反代后可用同一域名的不同前缀）：

| 角色 | 环境变量/配置 | 用途 |
|---|---|---|
| management 端口 | `mgmtHost` | 登录、账户、客户端控制、资源写 |
| client 端口 | `clientHost` | 终端拉取 Manifest / 资源内容 |

认证：`POST {mgmtHost}/user/auth`，请求体 `{ "email": "...", "password": "..." }`，
返回 `{ "token": "..." }`（启用 2FA 时返回 `{ "requires_2fa": true, "temp_token": "..." }`）。
后续所有 management 请求在 `Authorization: Bearer <token>` 头携带。

---

## 1. ✅ CIMS 原生接口（面板直接调用）

### 1.1 登录与账户
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/user/auth` | 登录，返回 token |
| GET | `/account/list` | 当前用户有权账户列表，取 `id` 作为后续 `{acct}` |

### 1.2 客户端（设备）监控与控制
> 前缀：`/account/{acct}/client`

| 方法 | 路径 | 说明 | 真实返回 |
|---|---|---|---|
| GET | `/list` | 客户端 uid 列表 | `["uid-1","uid-2",...]` |
| GET | `/{uid}` | 客户端详情 | `{uid,name,status,registered_at,...}` |
| GET | `/{uid}/status` | 在线状态 | `{client_id, online}` |
| POST | `/{uid}/command/restart` | 远程重启应用 | `{status,message}` |
| POST | `/{uid}/command/update-data` | 触发客户端立即拉取最新配置 | `{status,message}` |
| POST | `/{uid}/command/send-notification` | 向设备下发桌面通知 | `{status,message}` |

`send-notification` 请求体为 `NotificationPayload`：
```json
{ "MessageContent": "通知正文", "MessageMask": "标题(可选)", "IsEmergency": false, "DurationSeconds": 5 }
```

### 1.3 资源写（课表 / 配置 / 组件 / 策略）
> 前缀：`/account/{acct}`，`{type}` ∈ `ClassPlan | TimeLayout | Subjects | Policy | DefaultSettings | Components | Credentials`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/{type}/list` | 列出该类型资源（按 name） |
| POST | `/{type}/write?name={name}` | 覆盖写入该资源 JSON（自动 +1 版本） |
| PATCH | `/{type}/update` | 部分更新 |
| DELETE | `/{type}/delete` | 删除 |

面板映射：
- **课表** → `ClassPlan`（按班级用不同 `name`，如 `default_classplan` / `classplan_702`）
- **视图组件/插件** → `Components`
- **自动隐藏/策略** → `Policy`
- **时间布局** → `TimeLayout`

### 1.4 终端配置拉取（client 端口）
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v1/client/{uid}/manifest` | 该终端完整 Manifest（含七类资源拉取 URL） |
| GET | `/v1/client/{type}?name={name}` | 下载某资源内容 JSON |

> 写入 `ClassPlan`/`Components` 等资源后，客户端会按 Manifest 定时拉取并生效；也可对设备下发
> `command/update-data` 立即强制刷新。**这就是"课表/ClassIsland 配置/插件远程改、统一集控"的真实通道。**

---

## 2. ⚠️ 设备侧能力（插件 + 本地代理，非虚构网关）

CIMS 原生不提供「锁屏 / 截图 / 远程屏幕控制」这类 OS 级动作。**这些全部下沉到设备侧**，经已查证的 `send-notification` 通道触发：

```
面板 ──CIMS POST /account/{acct}/client/{uid}/command/send-notification──▶
   ClassIsland 插件（识别 MessageContent 内的 stelarith_task）──localhost──▶
      本地代理 StelarithAgent（127.0.0.1，验签+防重放）──▶ OS 动作 / 启动 VNC
```

通知负载里约定的指令结构（见 `../docs/扩展能力设计.md` §1.2）：
```json
{ "stelarith_task": { "action": "lock|screenshot|remote_control_start|remote_control_stop|reboot",
                      "token": "<网站签发、代理验签的短期令牌>", "scope": "class", "ts": 1694000000 } }
```

| 能力 | 实现位置 | 落地方式 |
|---|---|---|
| 锁屏 / 截图 | ClassIsland 插件 + 本地代理 | 插件直调 Windows API；或代理执行 |
| 远程屏幕控制 | 本地代理按需启动 VNC + 面板内嵌 noVNC | 会话级端口 + 令牌，结束即关 |
| 重启 / 同步 / 弹窗 | CIMS 原生（§1.2） | 直接调用，无需插件 |

- 插件：`ext/stelarith-classisland-plugin/`（C#）
- 代理：`ext/stelarith-agent/`（Rust，常驻、仅绑 localhost）
- **无后端时这些能力自动降级为演示提示**，不影响面板其余功能。

## 3. 协作类（chat / 工单 / Bug / 审计 → stelarith-website）

「电教委员间交流 / 故障工单 / Bug 提交 / 操作审计」是**人际协作数据**，CIMS 不存储。
按你的要求，这类数据落到 **stelarith-website**（复用其多用户体系与内容存储），而非另建网关：

| 功能 | 承载方 | 说明 |
|---|---|---|
| 班级交流 | stelarith-website 内容/消息模型 | 插件经本地代理上报，同年级各班订阅 |
| 故障上报 / Bug | 网站 `submitFeedback` / 新增 `submitIssue` | 网站后台跟踪状态 |
| 操作审计 | CIMS audit + 网站操作日志 | 谁在何时做了什么 |

面板对网站侧调用通过**网站同源服务端代理**（`ext/stelarith-website-sync/console-route.md`），浏览器不持网站以外的凭据。

---

## 4. 与 stelarith-website 同源 SSO

面板建议作为网站的一个 `/console` 路由部署（同源共享 `admin_token` Cookie）：

- 单点登录：复用网站账户/角色（`admin/editor/moderator/user/techrep/viewer`）；
- RBAC：`can(role, action)` 统一裁决（集控动作 `viewConsole/controlDevice/remoteControl/submitIssue`）；
- 内容联动：网站 CMS 作为校园公告/课表源，`sync-to-cims.mjs` 同步下发到 CIMS 设备。

详见 `../docs/扩展能力设计.md` 与 `../ext/stelarith-website-sync/console-route.md`。

---

## 5. 演示模式

不填 `mgmtHost` 或显式开启「演示模式」时，`api.js` 的所有调用返回 `D.*` 内置演示数据，
面板功能 100% 可操作、可截图汇报，便于评审与教学演示。接入真实后端只需填两个地址 + 账号密码。
