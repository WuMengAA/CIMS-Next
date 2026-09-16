# 校园点歌 · 班级大屏联动（VoiceHub → 班级屏幕）

把 **voicehub 校园点歌站** 的实时播放与队列，展示到班级大屏 / ClassIsland 上，并支持 **集控面板「推送到本班屏幕」经 CIMS 强制上屏**。

## 架构

```
voicehub.245959623.xyz  ──公开 API──▶  bridge(本地代理，轮询)
                                        │  产出 songboard.json + 本地 HTTP /board
                                        └──▶ 班级大屏浏览器打开 http://localhost:8787/board

集控面板(电教委员)  ──「推送到本班屏幕」──▶ CIMS Components/songboard
                                              │
集控插件 StelarithSongBoard ────────────────┘  优先展示「集控强制推送」内容
                                              └──▶ ClassIsland 上岛组件（正在播放 / 点歌名单 / 集控状态）
```

- **voicehub 侧**：只读公开 API，需 `x-api-key`（权限 `songs:read`）。无需改动 voicehub 源码。
- **bridge 侧**：Node ≥18 零依赖，跑在班级电脑（或校内服务器），把数据落地并对外提供浏览器大屏。
- **ClassIsland 侧**：由集控插件 `stelarith-classisland-plugin` 提供上岛组件，**不经过 bridge**。

## 1. 桥接代理（必装）

```bash
cd ext/classisland-voicehub-display/bridge
# 配置：复制 config.json 改值，或用环境变量
export VOICEHUB_BASE="https://voicehub.245959623.xyz"
export VOICEHUB_KEY="vhub_你的key"      # voicehub 后台生成，权限 songs:read
export POLL_SEC=15                       # 轮询间隔
export PORT=8787                         # 本地看板端口
# 可选：让 bridge 同时读取 CIMS 推送（集控面板「推送到本班屏幕」写入的 Components/songboard）
export CIMS_CLIENT="http://<cims-client-host>:port"
export CIMS_TOKEN="<cims-token>"
node bridge.mjs
```

启动后：
- 全屏看板：班级大屏浏览器打开 `http://localhost:8787/board`（建议用 kiosk / 全屏模式）
- 数据接口：`http://localhost:8787/api/songboard`

## 2. ClassIsland 侧展示

**已由集控插件承担，本目录不再提供 ClassIsland 插件。**

请在 ClassIsland 中安装 `ext/stelarith-classisland-plugin`，它提供三个上岛组件：

- **正在播放**：当前曲目 + 点歌人
- **点歌名单**：待播队列，上下滚动
- **集控状态**：本机班级 / 集控连接状态

数据源为插件的 `StelarithSongBoard.cs`：优先读 CIMS 资源 `Components/songboard`（集控面板「推送到本班屏幕」写入），
回退直连点歌站 `/api/open/songs`。**不依赖本目录的 bridge。**

> 早期的 `plugin/` 脚手架（臆造 API、从未编译通过）已归档至 `_archive/plugin-legacy/`，
> 差异清单与复活方式见该目录下的 `WHY-ARCHIVED.md`。

## 3. 集控面板「推送到本班屏幕」

电教委员在集控面板「校园点歌」视图点 **推送到本班屏幕**，会把当前播放 + 队列写入 CIMS 资源 `Components/songboard`。
bridge 若配置了 `CIMS_CLIENT`，会优先展示该强制内容（6 小时内有效），实现"集控一键上屏"。

## 文件清单

| 文件 | 说明 |
|------|------|
| `bridge/bridge.mjs` | 桥接代理：轮询 voicehub + 写 songboard.json + 本地 HTTP 看板 |
| `bridge/board.html` | 全屏点歌看板页面 |
| `bridge/config.json` | 代理配置（可被环境变量覆盖） |
| `bridge/package.json` | Node 工程（零依赖） |
| `_archive/plugin-legacy/` | 已归档的 ClassIsland 插件脚手架（API 过时，见其中 `WHY-ARCHIVED.md`） |
