# Stelarith 集控扩展网关（stelarith-ext-gateway）

集控方案包里的**自有轻量服务**，承载 CIMS 不存储的协作 / 上报 / 远程控制回执数据。
它不是虚构网关——就是面板 `API.ext()` 实际调用的后端，`docker-compose` 中一键起。

## 为什么需要它

CIMS 是设备配置/指令总线，不存「班级交流、故障工单、Bug、公告留痕、VNC 会话回执」。
这些自有数据由本服务落地，面板经 `extHost` 直连（浏览器 CORS 已开）。

## 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| GET/POST | `/notices` | 公告广播 |
| GET/POST | `/chat` | 班级交流消息 |
| GET/POST | `/reports` | 故障工单 |
| GET/POST | `/bugs` | Bug 上报 |
| GET/POST | `/audit` | 审计记录 |
| POST | `/vnc-session` | **设备/插件回报 VNC 会话** `{uid, ip, port, token}` |
| GET | `/vnc-session?uid=` | 面板轮询取设备会话回执（远程控制返回通道） |
| DELETE | `/vnc-session?uid=` | 结束控制时清除会话 |

存储：JSON 文件（`DATA_FILE`，默认 `./data.json`），重启不丢。

## 运行

```bash
# 直接
node server.mjs
PORT=9000 DATA_FILE=/data/ext.json node server.mjs

# 容器内（docker-compose 已包含）
docker compose up ext-gateway
```

## 与面板/代理对接

- **面板**：在「连接设置」填入 `扩展网关地址`（即本服务 base URL，如 `http://ext.example.edu:8088`）。
  远程控制会经 CIMS 通知 → 设备代理启 VNC → 代理把会话回报到本服务 `/vnc-session` →
  面板轮询并内嵌 noVNC 自动连接。
- **设备代理**：设 `STELARITH_EXT_URL=http://ext.example.edu:8088` 与 `STELARITH_DEVICE_UID=<设备uid>`，
  VNC 启动后自动回报会话。
- **指令密钥**：面板「指令密钥」须与设备代理 `STELARITH_AGENT_SECRET` 一致，远程控制令牌才验签通过。
  生产建议改用网站私钥 Ed25519 签名（见 `../stelarith-website-sync/sign-task.mjs`）。

## 安全说明

默认信任内网，无内置鉴权。生产应在 nginx 层加 Basic Auth 或网络隔离，且仅暴露给集控内网。
