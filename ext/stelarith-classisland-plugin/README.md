# StelarithControlPlugin · ClassIsland 集控控制插件

星璃·集控方案在班级端的接入点：**接收 CIMS 经 ClassIsland 集控通道下发的 `stelarith-task` 指令并执行**，并**后台主动定时同步（cshua）CIMS 已下发的课表/组件配置**，使展示与当前策略保持一致。

> 设计原则：不直连任何虚构网关。所有「下令」都来自 CIMS 真实集控通道，所有「执行」都在本机（插件做轻动作，重动作交给本地代理）。

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

## 2. 编译（已在本机实编验证）

需要 **.NET 8+ SDK**（本机实测 **.NET 10.0.102** 可编译；目标框架为 `net8.0-windows`）。

```bash
cd ext/stelarith-classisland-plugin
dotnet build -c Release
```

- `ClassIsland.PluginSdk` 引用已固定为经 NuGet 解析到的真实发布版 **1.4.3.1**（原 `1.0.0` 占位已被 NuGet 自动解析到该版；如部署目标为其他 ClassIsland 版本，请按该版本对应的 PluginSdk 版本调整 `StelarithControlPlugin.csproj` 中的 `Version`）。
- 编译产物：`bin/Release/net8.0-windows/StelarithControlPlugin.dll`。
- 当前编译结果：**0 错误，仅 1 条 NU1701 警告**（来自 SDK 传递依赖 `unvell.ReoGridWPF.dll` 面向 .NET Framework，与 `net8.0-windows7.0` 不完全兼容，无功能影响）。

---

## 3. 部署

将编译产物 `StelarithControlPlugin.dll`（及依赖 `*.pdb` / `*.deps.json`）放入 ClassIsland 的**数据目录**下的插件目录：

```
<ClassIsland 数据目录>\Plugins\StelarithControlPlugin\
```

> 本机实测数据目录为 `D:\Classlsland\data`，即部署到：
> `D:\Classlsland\data\Plugins\StelarithControlPlugin\`
> （注意不是 `%APPDATA%\ClassIsland\Plugins\`——ClassIsland 2.x 便携/自定义数据目录下，插件随数据目录走。）
> 同目录需放置 `manifest.yml` 与 `stelarith-sync.json`。

重启 ClassIsland 后，带 `[PluginEntrance]` 特性的程序集会被自动扫描加载。

---

## 4. 与 CIMS / 本地代理的契约

### 4.1 命令下发（CIMS → ClassIsland → 插件）

CIMS 经集控服务器下发客户端命令，由 **`IManagementServerConnection.CommandReceived`** 事件投递到插件（这是 ClassIsland 真实 SDK 下"收到集控命令"的唯一钩子，并非通知订阅）。

插件在 `StelarithCommandHost`（`IHostedService`）启动后解析 `IManagementService.Connection`，订阅该事件；事件参数中的载荷字段随 ClassIsland 版本，故用 `dynamic` 安全提取 `Action` / `Payload` / `Type`，解析出 `stelarith_task` 后分发：

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

- `lock` / `screenshot`：插件直接执行；
- 其余：`AgentClient` 转发 `POST http://127.0.0.1:17999/task`（见 `ext/stelarith-agent`）。

> 注：若 `IManagementService.Connection` 在插件启动时尚未建立（设备尚未加入集控或连接延迟），`CommandReceived` 不会订阅成功——此时命令通道不工作，需确保设备已加入集控且连接就绪。后续可改为监听 `Connection` 就绪事件做延迟订阅。

### 4.2 令牌验签（防伪造/重放）

- 面板侧 `signTask()` 用共享密钥 HMAC-SHA256 签名 `action|ts`；
- 本地代理 `verify()` 验签并校验 `ts` 在 60s 内；
- 生产环境升级为网站私钥 Ed25519 签名 + 代理持公钥验签（见 `ext/stelarith-website-sync/sign-task.mjs`）。

---

## 5. 版本适配点（已对齐 SDK 1.4.3.1 实编验证）

本插件已针对 **ClassIsland.PluginSdk 1.4.3.1** 成功编译，以下为实测确认的 API：

- `PluginBase.Initialize(HostBuilderContext, IServiceCollection)`：抽象方法，必须重写；服务注册放此处。
- 命令接收：`IManagementService.Connection`（类型 `IManagementServerConnection`）的 `event EventHandler<ClientCommandEventArgs> CommandReceived`。
- 通知展示：`INotificationHostService.RegisterNotificationProvider(INotificationProvider)`（生产者模型）。
- 生命周期：宿主启动后的逻辑放在 `IHostedService`（本插件为 `StelarithCommandHost`），由其构造函数注入 `IManagementService` / `INotificationHostService`。
- `INotificationProvider` 需实现 `Name` / `Description` / `ProviderGuid` / `SettingsElement` / `IconElement`。

事件参数 `ClientCommandEventArgs` 的具体载荷属性名随版本可能变化；本插件用 `dynamic` 提取，避免写死字段名导致编译失败。

---

## 6. 已知限制

- `IManagementService.Connection` 订阅时机依赖集控连接就绪；设备未加入集控时命令通道不可用（已记录 warning，不影响插件加载）。
- 快捷操作 UI 入口（设置页按钮）需按目标 ClassIsland 版本接入 `IComponentProvider` / 设置页提供器（当前 `QuickLock` / `QuickScreenshot` / `RequestRemoteControl` 已声明行为，UI 绑定待目标版本接入）。
- bidi gRPC 联调边界（grpcio 1.78）与插件无关，不影响单向指令链路。

---

## 7. 主动同步（cshua）

过去插件只**被动**接收命令，无法主动感知 CIMS 已下发的课表/组件配置变化。本版本新增后台 `StelarithSyncService`（`IHostedService`），按固定间隔主动拉取并刷新展示快照。

**对齐 ClassIsland 官方集控逻辑（manifest 驱动）**：

- **第 1 步 · 取清单**：`GET /api/v1/client/{ClientUid}/manifest`，得到各资源的 `*Source.Value`（形如 `http://<host>/api/v1/client/ClassPlan?name=default_classplan`）与版本；
- **第 2 步 · 按清单取资源**：遍历清单中所有 `*Source`，逐个取用（`ClassPlan` / `TimeLayout` / `Subjects` / `DefaultSettings` / `Policy` / `Components` / `Credentials`）——**资源集合由清单决定，插件不写死资源名/路径**，服务端增删资源无需改插件；
- **租户识别**：客户端应用 `TenantMiddleware` 按 `Host: <Slug>.<BaseDomain>` 识别租户，故每跳都显式带 `Host` 头；资源接口会 302 到 `/get?token=...`，同步服务**手动跟随重定向并逐跳保持 Host**（HttpClient 自动重定向会改回 `Host: 127.0.0.1:8096`，`curl -L` 同样会丢 Host，导致假 404）；
- **容错**：`resources refreshed X/Y ok` 诊断行会写明本轮成功项数；单项失败不影响其余项，下个周期重试；
- **结果**：最新快照存于线程安全的 `StelarithSyncState.Current`（含 `ManifestJson` / `ClassPlanJson` / `ComponentsJson` / `At` / `Ok`），供通知提供方或后续 UI 读取展示；
- **配置**：参数经插件目录下的 `stelarith-sync.json` 覆盖（不存在则用默认值）。本机实测部署为 `Slug=demo-class`、`ClientUid=lab-pc-001`、`BaseDomain=localhost`。

> 部署时务必把真实环境的 `Slug`、`ClientUid` 写入 `stelarith-sync.json`（与 DLL 同目录），否则拉取会因租户/设备不匹配而失败（日志可见 warning）。

### 7.1 关键坑：资源缺失 → 后端 IP 自封 → 轮询 429

CIMS 客户端/管理/Admin 三个 app 均挂载 `CCProtectMiddleware`：同一 IP 在 60s 窗口内产生 **≥5 次 ≥400 响应**即被封禁（返回 429，`code=100429`），封禁期间**所有**该 IP 请求（含命令轮询）一并被拒。

因此**不能让同步去请求不存在的资源**——每轮 2 个 404 就足以在 60s 内触发封禁，把命令通道一起拖死。正确做法是保证租户资源齐备（见 `CIMS-backend/rebuild_min_tenant.py` 的官方 7 类资源初始化），让 manifest 声明的资源全部返回 200。

### 7.2 兜底：宿主启动异常下的守护线程

ClassIsland 宿主在逐个启动插件的 `IHostedService` 时，若某个第三方插件（本机为 AIIsland）在 `StartAsync` 抛异常（如跨线程访问 Avalonia 属性 "Call from invalid thread"），宿主对 `IHostedService` 的启动序列会被中断，导致本插件的 `BackgroundService` **可能不被启动**。

为此 `StelarithSyncService` / `StelarithCommandPollerService` / `StelarithPanelService` 均采用**静态构造函数拉起后台守护线程**的范式，不依赖宿主 `StartAsync`：

- 静态构造函数开线程 + 静态服务定位器（构造时把 `opt`/`logger` 存入静态字段）；
- 与宿主路径（`ExecuteAsync`）用静态锁互斥，保证同一时刻只有一条循环在跑；
- 诊断走**文件**（`AppContext.BaseDirectory` 下 `ste-sync-diag.log` / `ste-poller-diag.log` / `ste-panel-diag.log`），不依赖宿主 logger（宿主启动异常时 logger 可能被 Dispose）。

