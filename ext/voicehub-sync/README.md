# voicehub · 校园点歌联动

> voicehub（voicehub.245959623.xyz）是校园点歌网站：学生提交点歌请求，Vercel 自动部署、改完即上线。
> 本目录把它纳入「学校多媒体统一集控」：点歌数据既能作为校园文化内容上教室屏幕，也能在集控面板里实时查看与一键推送。

## 一、voicehub 是什么

- **定位**：校园点歌 / 歌曲请求平台，面向全校学生（Nuxt 4 + Nitro + PostgreSQL/Drizzle）。
- **部署**：Vercel，提交即自动部署（约 3 分钟），无需手动运维。
- **代码**：GitHub fork `wumengaa/voicehub`（已通过 Cloudflare 加速镜像 `gh.245959623.xyz` 克隆到本地 `D:\Stellara\voicehub-fork` 备查）。
- **公开 API**（已核实源码 `server/api/open/*`）：需 `x-api-key` 头，权限见下。

## 二、已核实的 voicehub 公开 API（真实契约）

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/open/songs?played=true\|false&sortBy=playedAt\|createdAt&sortOrder=desc\|asc&limit=N` | `songs:read` | 歌曲列表；`played=true&sortBy=playedAt&sortOrder=desc&limit=1` 即「当前播放」，`played=false` 即待播队列。返回 `{success,data:{songs:[...],pagination}}` |
| POST | `/api/open/songs/request` | `songs:request` | 提交点歌，body `{title,artist,...}` |
| GET | `/api/open/schedules` | `schedules:read` | 排期播放列表 |

每首歌字段：`id,title,artist,requester,requesterId,voteCount,played,playedAt,playedAtFormatted,cover,musicPlatform,playUrl,requestedAt,...`

> API Key 在 voicehub 后台「ApiKey 管理」生成，格式 `vhub_...`，按权限勾选 `songs:read` / `songs:request`。

## 三、与集控的联动方式

```
┌────────────┐  公开API(x-api-key)  ┌──────────────────────┐  资源写(Bearer)  ┌──────────────┐  Manifest/Client  ┌─────────────────┐
│  voicehub  │ ──────────────────▶ │ 集控面板 / bridge     │ ───────────────▶ │  CIMS        │ ───────────────▶ │ ClassIsland 设备 │
│ (点歌站)   │                     │ (push 到屏幕)         │                  │ Components/  │                  │ 点歌看板组件    │
└────────────┘                     └──────────────────────┘                  │  songboard   │                  └─────────────────┘
      ▲                                   │ 集控面板「校园点歌」模块                 └──────────────┘
      │                                   │ 实时查看队列 + 点歌 + 一键推送
      └───────────────────────────────────┘
```

1. **集控面板内嵌模块**（已完成）：面板「校园点歌」页实时拉取 voicehub 队列/当前播放，可点歌、可一键「推送到本班屏幕」（写入 CIMS `Components/songboard`）。
2. **班级大屏桥接 + 插件**（已完成，见 `../classisland-voicehub-display/`）：本地 `bridge.mjs` 轮询 voicehub → 产出 `songboard.json` + 全屏看板 `http://localhost:8787/board`；ClassIsland 插件拉取展示，并优先显示集控强制推送。
3. **服务端定时推送**（本目录 `voicehub-adapter.mjs`）：由校内服务器/CI 定时把 voicehub 状态写入 CIMS `Components/songboard`，无需班级 bridge 也能上屏。

## 四、文件说明

| 文件 | 作用 |
|---|---|
| `voicehub-adapter.mjs` | 服务端/CI 推送适配器：拉取 voicehub → 写 CIMS `Components/songboard`（真实接口，详见脚本注释） |
| `voicehub-embed.mjs` | **浏览器端即插即用模块**（ESM 零依赖）：导出 `VoicehubEmbed`，封装拉队列 / 点歌 / 推上屏 / 渲染迷你 UI；契约与面板 `api.js` 完全一致，任意页面 `import` 即可内嵌点歌模块 |
| `voicehub-embed.test.mjs` | 模块纯逻辑 / 契约测试（`node --test`，demo 降级 + 真实端点断言） |
| `../classisland-voicehub-display/bridge/bridge.mjs` | 班级本地桥接代理：轮询 voicehub + 全屏看板 + 可选读 CIMS |
| `../classisland-voicehub-display/plugin/*` | ClassIsland 点歌看板组件脚手架（C#/XAML） |
| `../admin-console/src/app.js` 的 `views.voicehub` | 集控面板「校园点歌」模块（已接入真实 API） |

> **即插即用模块已交付**：`voicehub-embed.mjs` 是浏览器端零依赖 ESM，导出 `VoicehubEmbed`，封装 `list()`（当前播放+待播队列）、`request()`（点歌）、`pushToScreen()`（写 CIMS `Components/songboard`）、`render()`（迷你可嵌入 UI）。集控面板 `admin-console` 的内联实现与其契约一致；stelarith-website 侧可直接 `import { VoicehubEmbed } from "ext/voicehub-sync/voicehub-embed.mjs"` 在任意页面内嵌校园点歌模块，无需重复造轮子。模块 `node --test` 已覆盖 demo 降级与真实端点契约。

## 五、接入步骤（落地）

1. 在 voicehub 后台生成 API Key（权限 `songs:read` + `songs:request`），记录 `vhub_...`。
2. **面板侧**：集控面板「连接设置」填入点歌站地址与 Key → 「校园点歌」页即实时联动；点「推送到本班屏幕」写 CIMS。
3. **大屏侧**：班级电脑运行 `bridge/bridge.mjs`（配 `VOICEHUB_KEY`），大屏浏览器开 `http://localhost:8787/board`；或装 ClassIsland 插件。
4. **服务端推送**（可选）：配置 `CIMS_MGMT/CIMS_TOKEN/CIMS_ACCOUNT` 后 `node voicehub-adapter.mjs --watch 30`。

> 未配置 voicehub 时，面板与 bridge 均自动降级为演示数据，流程可完整体验。
