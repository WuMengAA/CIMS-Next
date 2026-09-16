# StelarithAgent · Rust 生产版（设备侧常驻）

集控本地代理的生产实现（单二进制约数 MB、零运行时依赖、常驻后台）。逻辑与
`ext/stelarith-agent-node`（Node 参考实现）1:1 对齐，后者已 `npm test` 端到端验证通过，
可作为本实现的**回归基准**。

## 职责

- 仅监听 `127.0.0.1`，外部不可直连；
- 接收本机 ClassIsland 插件转发的 `stelarith_task` 指令；
- **双模验签 + 防重放**（见下）；
- 执行 OS 动作：锁屏 / 重启；按需启动 VNC 实现远程屏幕控制，结束即关；
- VNC 会话回执经扩展网关 `/vnc-session` 回报面板（内嵌 noVNC）。

## 双模验签契约

| 模式 | 启用条件 | token 计算 | 说明 |
|---|---|---|---|
| HMAC（联调） | 未配 `STELARITH_SITE_PUBKEY` | `hex(HMAC_SHA256(action\|ts, secret))` | 与面板 `signTask()` 一致 |
| Ed25519（生产） | 配了 `STELARITH_SITE_PUBKEY` | `base64url(Ed25519_sign(action\|ts, 网站私钥))` | 网站私钥签名、代理持公钥验签，杜绝密钥分发泄露 |

两种模式 message 均为 `action|ts`，且均校验 `|now - ts| <= 60s`。
网站签名脚本见 `ext/stelarith-website-sync/sign-task.mjs`（导出 SPKI PEM 公钥，下发到各设备作
`STELARITH_SITE_PUBKEY`）。

## 编译与部署

> 本实现**已在开发机 `cargo build` 实跑通过**（Rust 1.98 / cargo 1.98，依赖经 rsproxy.cn 镜像拉取），
> 含 `ed25519-dalek` 非对称验签 + HMAC 双模、VNC 回执、只读 `/status`。目标设备仅需产出单文件二进制。

```bash
cd ext/stelarith-agent
cargo build --release          # 含 ed25519-dalek / base64 / hex 依赖，需联网拉取
# 部署：将 target/release/stelarith-agent.exe 设为开机自启 / 系统服务
```

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `STELARITH_AGENT_PORT` | `17999` | 监听端口（仅 127.0.0.1） |
| `STELARITH_AGENT_SECRET` | `dev-secret-change-me` | HMAC 联调密钥；生产请改用 `STELARITH_SITE_PUBKEY` |
| `STELARITH_SITE_PUBKEY` | `""` | 网站 Ed25519 公钥（SPKI PEM），配置即启用非对称验签 |
| `STELARITH_EXT_URL` | `""` | 扩展网关基址，用于回报 VNC 会话 |
| `STELARITH_DEVICE_UID` | `unknown` | 本机设备标识 |
| `STELARITH_VNC_CMD` | `vncserver` | 真实 VNC 启动命令 |

## 与 Node 参考实现的关系

- `src/main.rs` 的 `verify()` / `verify_ed25519()` 与 `agent-node/agent.mjs` 的 `verify()` /
  `verifyEd25519()` 同源、契约一致；
- 端到端闭环（签名↔验签↔VNC 回执↔noVNC）由 `agent-node/test/end2end.mjs` 覆盖两种模式；
- 本实现**已在开发机 `cargo build` 实跑通过**，`cargo run` 后 `/status` 返回 up、`/task` 正确/错误/过期令牌分别放行/拒（冒烟测试全绿）；目标设备 `cargo build --release` 即得单文件二进制。
