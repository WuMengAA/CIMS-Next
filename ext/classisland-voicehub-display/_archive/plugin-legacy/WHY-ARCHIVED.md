# 归档说明：VoiceHub 点歌看板插件脚手架（勿直接使用）

归档日期：2026-09-16

## 为什么归档

`plugin/` 是本能力早期的一份 **ClassIsland 组件脚手架**，其 API 系按「常见约定」推测编写，
**与 ClassIsland 2.1.0.1 的真实 API 不符，从未编译通过**。核实后的差异：

| 脚手架写法 | 真实 API（2.1.0.1 实测） |
|-----------|------------------------|
| `[ComponentMetadata(guid, name, desc, author)]` | `[ComponentInfo(guid, name, iconSource, desc)]` —— 无 author 位；**第 3 位是图标**，须为 Segoe Fluent 字形字符串（如 `"\uE8D6"`），不是描述 |
| `using ClassIsland.Core.Abstractions.Controls;` | 基类在 `ClassIsland.Core.Abstractions.Controls`，但注册走 `ClassIsland.Core.Extensions.Registry` 的 `AddComponent<TControl, TSettingsView>()` |
| `System.Windows.Threading.DispatcherTimer` | 宿主是 **Avalonia**，须用 `Avalonia.Threading.DispatcherTimer`；跨线程更新走 `Dispatcher.UIThread.InvokeAsync` |
| 直接在构造函数里 `_timer.Start()` + 拉数据 | 组件生命周期由宿主托管；构造函数里发网络请求会在设计器/序列化阶段触发 |
| XAML 里硬编码前景色 | 一律**不设前景色**，继承主题；字号取宿主动态资源 `MainWindowBodyFontSize` / `MainWindowSecondaryFontSize` |
| `manifest.json`（键名 `PluginId`/`RequireApiVersion`） | ClassIsland 插件清单为 **YAML**（`manifest.yml`），字段为 `id` / `name` / `version` / `apiVersion` / `entranceAssembly` 等 |

## 能力已被谁取代

ClassIsland 侧的点歌展示已由集控插件承担：
`ext/stelarith-classisland-plugin/StelarithIslandComponents.cs` 提供三个上岛组件：

- **正在播放**（`8F3A2C41-…`）
- **点歌名单**（`8F3A2C42-…`，上下滚动）
- **集控状态**（`8F3A2C43-…`）

数据源为 `StelarithSongBoard.cs`：优先读 CIMS 资源 `Components/songboard`（集控推送），
回退直连点歌站 `/api/open/songs`（`x-api-key`）。条目契约为 `SongEntry { Title, Artist, By, Class, … }`。
该实现已按官方 API 编译通过并部署，因此本脚手架无保留现役的必要。

## 另一条开发线也迁移过这份代码（合并时未采纳）

网站线（`WuMengAA/CIMS-Next` 的 `origin/main`）在 `db67eb3`（2026-09-08）**独立**做过一次
「迁移到 ClassIsland 2.1.0.1 / Avalonia」，并在 `febc888` 声称编译通过。合并两条开发线时
**未采纳**，理由：

- 它仍写成 `[ComponentInfo(guid, name, desc)]` —— **三参数**；而本仓库实编验证过的真实签名是
  四参数 `[ComponentInfo(guid, name, iconSource, desc)]`（第 3 位是图标字形）。即它仍未对齐真实 API。
- 组件内仍硬编码前景色（`new SolidColorBrush(Color.Parse("#8a6bff"))`），违反上表最后一条。
- 能力与 `StelarithIslandComponents.cs` 的三个组件完全重叠，并入等于同一块屏幕出现两套点歌展示。

其源码仍可从 git 历史取回，例如：

```bash
git show <merge-commit>^2:ext/classisland-voicehub-display/plugin/VoiceHubDisplayComponent.cs
```

如需考察，请按下面「若要复活这份插件」一节的流程重做，而不是直接采用那份三参数写法。

## bridge/ 仍然有效

同级的 `../bridge/`（`bridge.mjs` + `board.html`）**未归档、继续维护**。
它面向的是 **浏览器全屏大屏** 场景（不依赖 ClassIsland），与插件是互补关系，不是替代关系。

## 若要复活这份插件

不要直接改本目录的文件。正确做法是新建插件工程，参考
`ext/stelarith-classisland-plugin` 的 `.csproj`、`StelarithIslandComponents.cs` 与 `manifest.yml`，
按上表逐条替换后再编译。注意避免与集控插件的组件 GUID 冲突。
