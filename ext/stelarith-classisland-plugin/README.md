# StelarithControlPlugin · ClassIsland 集控控制插件

星璃·集控方案在班级端的接入点：**接收 CIMS 经 ClassIsland 通知下发的 `stelarith-task` 指令，在本地执行轻动作或转发给本地代理**。

> 设计原则：不直连任何虚构网关。所有「下令」都来自 CIMS 真实通知（经 ClassIsland 通知通道），所有「执行」都在本机。

---

## 1. 功能

| 动作 action | 执行方 | 说明 |
|---|---|---|
| `lock` | 插件（本机，无需提权） | 调用 `user32.dll LockWorkStation` 锁屏 |
| `screenshot` | 插件（本机） | 截主屏保存到「图片\stelarith_shot.png」，供报修/审计留证 |
| `remote_control_start` | 本地代理 StelarithAgent | 按需启动 VNC，回报端口+令牌到扩展网关 |
| `remote_control_stop` | 本地代理 | 关闭 VNC 会话 |
| `reboot` | 本地代理 | 本机重启（仅限授权角色） |
| `shell` | 本地代理 | 受限命令（RBAC 白名单内），默认不启用 |

插件只做最轻的本地调用；需要网络/提权（启 VNC、控进程、验签）一律交给本地代理。

---

## 2. 编译

需要 **.NET 8 SDK** 与 **ClassIsland.PluginSdk**（NuGet）。

```bash
cd ext/stelarith-classisland-plugin
dotnet build -c Release
```

> 本机（CI/巡检环境）通常没有 .NET 与 ClassIsland SDK，且 ClassIsland 插件只能在 Windows 目标机编译部署——故本项目内的插件代码为**对齐真实 SDK 的结构化桩**，需在目标 Windows 设备 `dotnet build` 后验证。

---

## 3. 部署

将编译产物 `StelarithControlPlugin.dll`（及依赖）放入：

```
%APPDATA%\ClassIsland\Plugins\StelarithControlPlugin\
```

重启 ClassIsland 后，带 `[PluginEntrance]` 特性的程序集会被自动扫描加载。

---

## 4. 与 CIMS / 本地代理的契约

### 4.1 通知负载（CIMS → ClassIsland → 插件）
CIMS 经 `send-notification` 下发，`MessageContent` 内为如下 JSON：

```json
{
  "stelarith_task": {
    "action": "remote_control_start",
    "token": "<HMAC/签名令牌>",
    "scope": "class",
    "ts": 0
  }
}
```

插件捕获 `NotificationReceived`，提取 `Notification.MessageContent`，解析出 `stelarith_task` 后分发。
- `lock` / `screenshot`：插件直接执行；
- 其余：`AgentClient` 转发 `POST http://127.0.0.1:17999/task`（见 `ext/stelarith-agent`）。

### 4.2 令牌验签（防伪造/重放）
- 面板侧 `signTask()` 用共享密钥 HMAC-SHA256 签名 `action|ts`；
- 本地代理 `verify()` 验签并校验 `ts` 在 60s 内；
- 生产环境升级为网站私钥 Ed25519 签名 + 代理持公钥验签（见 `ext/stelarith-website-sync/sign-task.mjs`）。

---

## 5. 版本适配点（按目标 ClassIsland 版本核对）

本桩基于 ClassIsland 公开插件 SDK 形态编写，以下符号随版本可能变化，请以目标机实际 ClassIsland 源码为准：

- `using` 命名空间：`ClassIsland.Core` / `ClassIsland.Core.Abstractions` / `ClassIsland.Core.Attributes`
- `INotificationHost` 服务与 `NotificationReceived` 事件
- `Notification.MessageContent` 字段名与类型
- `PluginBase.GetService<T>()` 服务解析入口
- 设置页 / 组件面板入口（快捷操作按钮挂载方式，随版本）

`StelarithControlPlugin.cs` 中的 `Initialize()` 已用 `dynamic` 提取通知内容，避免写死字段名导致编译失败；如目标版本事件/字段名不同，按上方列表调整即可。

---

## 6. 已知限制

- 本机未编译验证（无 .NET / 无 ClassIsland SDK / 非 Windows），需目标机 `dotnet build` 后回归。
- bidi gRPC 联调边界（grpcio 1.78）与插件无关，不影响单向指令链路。
- 快捷操作 UI 入口（设置页按钮）需按目标 ClassIsland 版本接入 `IComponentProvider` / 设置页提供器。
