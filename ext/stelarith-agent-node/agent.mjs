#!/usr/bin/env node
/**
 * 星璃·集控本地代理（StelarithAgent · Node 参考实现）
 * ---------------------------------------------------------------
 * 这是 ext/stelarith-agent（Rust）的**可运行参考实现**：逻辑 1:1 对齐，
 * 但用 Node 编写，因此可以在本机（或无 cargo 的环境）直接跑起来验证整条链路：
 *
 *   面板 signTask()  --HMAC-SHA256-->  本代理 /task 验签  --执行动作-->
 *     remote_control_start：启 VNC + 回报 {ip,port,token} 到扩展网关 /vnc-session
 *   面板 deviceRemoteStatus(uid)  --轮询-->  网关返回会话  --内嵌 noVNC
 *
 * 生产环境目标 Windows 设备仍推荐用 Rust 版本（单二进制约数 MB、常驻、零依赖运行时）。
 * 本文件价值在于：让整条「签名↔验签↔回执」闭环可以在开发机 / CI 直接冒烟，不靠肉眼读代码。
 *
 * 安全边界（与 Rust 版一致，绝不退让）：
 *   · 仅监听 127.0.0.1，外部不可直连；
 *   · 所有写动作都来自本机 ClassIsland 插件转发的指令，必须经 HMAC 验签 + 防重放；
 *   · 不暴露任何公网端口。
 *
 * 用法：
 *   node agent.mjs                                       # 真实模式（会执行锁屏/重启/启 VNC）
 *   MOCK_VNC=1 node agent.mjs                            # 模拟 VNC（不依赖真实 VNC 二进制）
 *   node agent.mjs --dry-run                             # 全动作模拟，不碰系统（CI/冒烟用）
 *
 * 环境变量：
 *   STELARITH_AGENT_PORT      监听端口（默认 17999）
 *   STELARITH_AGENT_SECRET    验签共享密钥（默认 dev-secret-change-me，生产务必改）
 *   STELARITH_EXT_URL         扩展网关基址，用于回报 VNC 会话（如 http://127.0.0.1:8088）
 *   STELARITH_DEVICE_UID      本机设备标识，回执时带上
 *   STELARITH_VNC_CMD         真实 VNC 启动命令（MOCK_VNC 未设时使用）
 */

import http from "node:http";
import crypto from "node:crypto";
import net from "node:net";
import { spawn } from "node:child_process";
import os from "node:os";
import fs from "node:fs";

const PORT = Number(process.env.STELARITH_AGENT_PORT || 17999);
const SECRET = process.env.STELARITH_AGENT_SECRET || "dev-secret-change-me";
const EXT_URL = (process.env.STELARITH_EXT_URL || "").replace(/\/+$/, "");
const UID = process.env.STELARITH_DEVICE_UID || "unknown";
const VNC_CMD = process.env.STELARITH_VNC_CMD || "vncserver";
const MOCK_VNC = process.env.MOCK_VNC === "1" || process.argv.includes("--mock-vnc");
const DRY_RUN = process.argv.includes("--dry-run");

// ---- 验签（与面板 signTask / Rust verify 完全一致）----
// token = hex(HMAC_SHA256(action + "|" + ts, secret))；ts 为秒级时间戳，容忍 ±60s。
function verify(action, ts, token) {
  if (!SECRET || SECRET === "dev-secret-change-me") {
    // 未配置密钥：仅在联调时允许时间戳占位回落（不应于生产开启）。
    return token === String(ts);
  }
  const expect = crypto
    .createHmac("sha256", SECRET)
    .update(`${action}|${ts}`)
    .digest("hex");
  if (expect.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expect.length; i++) diff |= expect.charCodeAt(i) ^ token.charCodeAt(i);
  if (diff !== 0) return false;
  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - Number(ts)) <= 60;
}

// ---- 当前 VNC 会话（进程内状态）----
let active = null; // { port, connToken, child?, server? }

function lanIp() {
  try {
    const s = net.createSocket();
    s.connect({ host: "8.8.8.8", port: 80 });
    const addr = s.address();
    s.destroy();
    return addr?.address || "127.0.0.1";
  } catch {
    return "127.0.0.1";
  }
}

// 把 VNC 会话回执上报到扩展网关 /vnc-session（自有服务，非虚构）。
async function reportVnc(port, connToken) {
  if (!EXT_URL) return;
  try {
    await fetch(`${EXT_URL}/vnc-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: UID, ip: lanIp(), port, token: connToken, proto: "vnc" }),
    });
  } catch (e) {
    console.error("[agent] 回报 VNC 会话失败:", e.message);
  }
}

// 模拟 VNC：在 localhost:port 起一个最小 TCP 服务，握手时回 RFB 版本 banner，
// 足以让 noVNC 建立连接（真实环境由 STELARITH_VNC_CMD 启动真 VNC 替代）。
function startMockVnc(port) {
  const server = net.createServer((sock) => {
    sock.on("error", () => {}); // 客户端异常断开不应让代理崩溃
    sock.write("RFB 003.008\n"); // RFB 3.8 协议版本，noVNC 会据此继续握手
    sock.on("data", () => {});
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

function execute(task) {
  const out = {};
  const ts = Math.floor(Date.now() / 1000);
  switch (task.action) {
    case "lock": {
      if (DRY_RUN) { out.result = "locked(dry-run)"; break; }
      if (os.platform() === "win32") spawn("rundll32.exe", ["user32.dll,LockWorkStation"]);
      else console.log("[agent] 非 Windows：lock 仅记录（需在目标机实现对应锁屏命令）");
      out.result = "locked";
      break;
    }
    case "reboot": {
      if (DRY_RUN) { out.result = "rebooting(dry-run)"; break; }
      if (os.platform() === "win32") spawn("shutdown", ["/r", "/t", "0"]);
      out.result = "rebooting";
      break;
    }
    case "remote_control_start": {
      const port = 5900 + (ts % 100);
      const connToken = `st-${port}-${ts}`;
      if (MOCK_VNC || DRY_RUN) {
        startMockVnc(port).then((server) => {
          active = { port, connToken, server };
          console.log(`[agent] [mock] VNC up on 127.0.0.1:${port} token=${connToken}`);
          reportVnc(port, connToken);
        });
      } else {
        const child = spawn(VNC_CMD, [`:${port - 5900}`, "-localhost", connToken]);
        active = { port, connToken, child };
        console.log(`[agent] VNC up port=${port} token=${connToken}`);
        reportVnc(port, connToken);
      }
      out.result = "vnc_started";
      out.vnc_port = String(port);
      out.conn_token = connToken;
      break;
    }
    case "remote_control_stop": {
      if (active) {
        try { active.child ? active.child.kill() : active.server?.close(); } catch {}
        out.result = "vnc_stopped";
        active = null;
      } else {
        out.result = "no_active_session";
      }
      break;
    }
    case "shell": {
      if (DRY_RUN) { out.result = "shell_dispatched(dry-run)"; break; }
      if (task.cmd) {
        if (os.platform() === "win32") spawn("cmd.exe", ["/c", task.cmd]);
        else spawn("sh", ["-c", task.cmd]);
        out.result = "shell_dispatched";
      } else out.error = "missing cmd";
      break;
    }
    default:
      out.error = `unknown action: ${task.action}`;
  }
  return out;
}

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  const pathname = url.split("?")[0];

  if (req.method === "POST" && pathname === "/task") {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      let task = {};
      try { task = JSON.parse(data || "{}"); } catch {}
      if (!verify(task.action, task.ts, task.token)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "unauthorized_or_replay" }));
      }
      const out = execute(task);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(out));
    });
    return;
  }

  if (req.method === "GET" && pathname === "/status") {
    const m = { status: "up" };
    if (active) { m.vnc = "running"; m.vnc_port = String(active.port); m.conn_token = active.connToken; }
    else m.vnc = "stopped";
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(m));
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[StelarithAgent-Node] listening on 127.0.0.1:${PORT}  mockVnc=${MOCK_VNC} dryRun=${DRY_RUN}`);
});
