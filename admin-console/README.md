# 星集控 · 电教委员集控面板客户端

> 学校多媒体统一集控方案包的一员。面向**电教委员**的独立桌面客户端：快、占用少、全能、联动、API 友好。

## 设计取舍

| 目标 | 做法 |
|---|---|
| **快** | Tauri 2 壳 + 系统 WebView；前端零框架、零构建（原生 HTML/CSS/JS），启动即开 |
| **占用少** | 无 Electron / Node 运行时，产物约 5MB，内存占用远低于 Electron 方案 |
| **全能** | 11 大模块覆盖电教委员日常全部动作（见下） |
| **联动** | 课表 / ClassIsland 配置 / 插件远程改并下发；设备远程控制（插件+本地代理）；通知、交流、上报、Bug 闭环；**与 stelarith-website 同源 SSO** |
| **API 友好** | 统一 API 层（`src/api.js`），后端地址与令牌可配；无后端时自动降级为演示数据；契约开放，见 `API.md` |

## 功能菜单（电教委员视角）

| 模块 | 能做什么 |
|---|---|
| **总览** | 设备在线/离线、今日课程数、通知数、离线告警，一眼掌握本班状态 |
| **课表** | 直接编辑周课表 → 保存即下发到本班所有设备 |
| **配置下发** | 远程改 ClassIsland 配置（视图/组件/策略 JSON）+ 自动隐藏开关（上课/考试/投影）+ 更新通道 |
| **插件** | 远程启用/禁用/下发插件 |
| **设备控制** | 远程重启、强制同步配置、下发通知（直接走 CIMS management 端口 `/account/{acct}/client/{uid}/command/*`）；锁屏/截图经本机 **ClassIsland 插件 + 本地代理** 执行（见下「远程控制」） |
| **远程控制** | 一键远程观看/操作设备屏幕：面板下令 → CIMS 通知 → 插件 → 本地代理**按需启动 VNC** → 面板内嵌 noVNC 连接（会话级端口 + 令牌，结束即关） |
| **通知广播** | 按本班/本年级/全校发布通知，含历史 |
| **班级交流** | 与同年级各班电教委员快捷消息/广播 |
| **故障上报** | 提交维修工单（等级+描述），跟踪处理状态 |
| **提交 Bug** | 提交问题 + 复现步骤 + 日志，直达维护者 |
| **操作日志** | 审计：谁在何时做了什么 |
| **设置** | 后端地址、令牌、演示模式、班级切换 |

顶部可切换班级，状态栏显示连接/演示模式与当前视图。

## 运行

### 方式 A：浏览器直开（最快验证，零依赖）
直接用浏览器打开 `src/index.html`。选「演示模式」即可体验全部功能。

### 方式 B：打包为独立客户端（Tauri 2）
前置：安装 Rust 工具链与 Tauri 依赖（见 [Tauri 官方指南](https://tauri.app/start/prerequisites/)）。

```bash
cd src-tauri
cargo tauri dev      # 开发运行
cargo tauri build    # 产出安装包（msi / nsis）
```

产物在 `src-tauri/target/release/bundle/`。

> **构建注意（已预置）**
> - 前端为零构建静态资源，`tauri.conf.json` 已设 `devUrl=http://localhost:9876` 与 `beforeDevCommand=python3 -m http.server 9876`（也可用 `npx serve -l 9876` 等任意静态服务器）。
> - `src-tauri/icons/` 已含占位图标（`icon.png` + `icon.ico`，星璃紫）；正式发布前请替换为正式图标（Windows 目标需有效 `.ico`）。
> - 本机需 Rust 工具链（`rustup`）与 Tauri 2 前置依赖；代理（`ext/stelarith-agent`）同样需目标机 `cargo build --release`。

## 目录结构

```
admin-console/
├── src/                前端（零构建，可浏览器直开）
│   ├── index.html      结构 + 菜单
│   ├── styles.css      暗色紧凑样式
│   ├── api.js          统一 API 层 + 演示数据兜底（对接真实 CIMS 接口）
│   └── app.js          视图渲染与交互
├── src-tauri/          Tauri 2 壳（打包成独立客户端）
│   ├── Cargo.toml      体积优化：lto + opt-level="s" + strip
│   ├── tauri.conf.json
│   ├── build.rs
│   └── src/main.rs
├── README.md           本文
└── API.md              后端 API 契约（对接真实 CIMS）
```

## 联动关系

```
电教委员 → 本客户端 → CIMS management/client 端口（真实 HTTP 接口）→ ClassIsland 设备
                         ↑                                        ↑
                  课表/配置/插件资源写                  command/restart|update-data|send-notification
```

后端端点契约见 `API.md`。设备实时控制直接走 CIMS management 端口 `/account/{acct}/client/{uid}/command/*`（HTTP→gRPC 已由 CIMS 原生提供），无需自建网关。

## 缺失能力如何落地（插件 + 本地代理，而非虚构网关）

CIMS 原生不提供锁屏/截图/远程屏幕/聊天/工单/Bug。**这些全部下沉到设备侧**：

- **ClassIsland 控制插件**（`ext/stelarith-classisland-plugin/`）：接收 CIMS 通知里的 `stelarith_task` 指令，执行锁屏/截图，或转发给本地代理。
- **本地代理 StelarithAgent**（`ext/stelarith-agent/`）：常驻 Windows 服务，仅监听 `127.0.0.1`，验签+防重放后执行 OS 动作、按需启动 VNC 实现远程控制。
- **聊天/工单/Bug**：经插件→本地代理→**stelarith-website**（复用其 `submitFeedback` 与内容存储），不污染 CIMS 设备配置域。

## 与 stelarith-website 联动（同源 SSO）

面板作为网站的一个同源模块（新增 `/console` 路由，见 `../ext/stelarith-website-sync/console-route.md`）：

- 复用网站 `admin_token` Cookie 单点登录，一套账户/角色全站通用；
- 面板对 CIMS 的调用由**网站服务端代理**（浏览器不持有 CIMS 凭据）；
- 网站 CMS 作为校园公告/课表内容源，`sync-to-cims.mjs` 同步下发到设备。

详细设计见 `../docs/扩展能力设计.md`。
