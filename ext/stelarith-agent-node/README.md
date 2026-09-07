# StelarithAgent · Node 参考实现

`ext/stelarith-agent`（Rust）的**可运行参考实现**。逻辑 1:1 对齐 Rust 版，但用 Node 编写，
因此无需 cargo 就能在本机 / CI 直接跑起来，**真正验证**整条链路：

```
面板 signTask()  --HMAC-SHA256(action|ts, secret)-->  本代理 /task 验签 + 防重放
   └─ remote_control_start：启 VNC → 回报 {ip,port,token} 到扩展网关 /vnc-session
面板 deviceRemoteStatus(uid)  --轮询-->  网关返回会话  --内嵌 noVNC
```

> 生产目标 Windows 设备仍推荐 Rust 版（单二进制约数 MB、常驻、零运行时依赖）。
> 本实现的价值：让「签名↔验签↔回执」闭环可以在开发机直接冒烟，不靠肉眼读代码。

## 快速验证（端到端）

```bash
npm test          # 等价于 node test/end2end.mjs
```

脚本会：起扩展网关（18088）+ 起本代理（17999，--dry-run + MOCK_VNC）→
模拟面板签名并下发 `remote_control_start` → 断言代理回执、网关轮询拿到会话、
noVNC 端口可达、非法令牌被拒（401）、停止并清除回执。全部通过即闭环成立。

## 运行

```bash
node agent.mjs                                  # 真实模式（执行锁屏/重启/启真实 VNC）
MOCK_VNC=1 node agent.mjs                       # 模拟 VNC，不依赖真实 VNC 二进制
node agent.mjs --dry-run                        # 全动作模拟，不碰系统（安全/CI 用）
```

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `STELARITH_AGENT_PORT` | `17999` | 监听端口（仅 127.0.0.1） |
| `STELARITH_AGENT_SECRET` | `dev-secret-change-me` | 验签共享密钥；与面板 `setTaskSecret` / Rust 代理一致 |
| `STELARITH_EXT_URL` | `""` | 扩展网关基址，用于回报 VNC 会话 |
| `STELARITH_DEVICE_UID` | `unknown` | 本机设备标识，回执时带上 |
| `STELARITH_VNC_CMD` | `vncserver` | 真实 VNC 启动命令（`MOCK_VNC` 未设时使用） |

## 安全边界（与 Rust 版一致，绝不退让）

- 仅监听 `127.0.0.1`，外部不可直连；
- 所有写动作都来自本机 ClassIsland 插件转发的指令，必须经 HMAC 验签 + 防重放（±60s）；
- 未配置 `STELARITH_AGENT_SECRET` 时仅允许时间戳占位回落（联调用，不可用于生产）；
- 不暴露任何公网端口。

## 验签契约（务必与面板 / Rust 代理保持一致）

```
token = hex(HMAC_SHA256(action + "|" + ts, secret))
校验：token 匹配 且 |now - ts| <= 60s
```

面板侧见 `admin-console/src/api.js` 的 `signTask()`；Rust 侧见 `stelarith-agent/src/main.rs` 的 `verify()`。
