#!/usr/bin/env node
/**
 * 端到端冒烟测试：验证「面板签名 → 代理验签 → VNC 回执 → 面板轮询」整条闭环。
 *
 * 启动顺序：
 *   1. 起 ext-gateway（端口 18088，临时数据文件）
 *   2. 起 agent-node（端口 17999，MOCK_VNC，dry-run，连上面那个网关）
 *   3. 模拟面板：用相同密钥 signTask('remote_control_start', ts) → POST /task
 *   4. 断言：agent 返回 vnc_started + 端口；网关 /vnc-session?uid= 轮询拿到会话；/status 显示 running
 *   5. 模拟面板下发 stop → 断言 vnc_stopped；网关会话被清
 *
 * 运行：node test/end2end.mjs
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import net from "node:net";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const GATEWAY = path.resolve(ROOT, "../stelarith-ext-gateway/server.mjs");

const SECRET = "e2e-secret-2026";
const UID = "uid-e2e-1";
const GATEWAY_PORT = 18088;
const AGENT_PORT = 17999;
const DEVICE_IP = "127.0.0.1";

const tmpData = path.join(os.tmpdir(), `ext-e2e-${Date.now()}.json`);
const log = (...a) => console.log("[e2e]", ...a);
process.on("uncaughtException", (e) => { if (e.code !== "ECONNRESET") { console.error("[e2e] 未捕获:", e); cleanup(1); } });
process.on("unhandledRejection", (e) => { console.error("[e2e] 未处理拒绝:", e); cleanup(1); });
const fail = (msg) => { console.error("[e2e] ✗ FAIL:", msg); cleanup(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitFor(cb, label, tries = 50) {
  return new Promise((resolve, reject) => {
    const tick = async (n) => {
      try { if (await cb()) return resolve(true); } catch {}
      if (n <= 0) return reject(new Error("timeout: " + label));
      setTimeout(() => tick(n - 1), 100);
    };
    tick(tries);
  });
}

function req(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const r = http.request({ method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { "Content-Type": "application/json" } }, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null }));
    });
    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

let gwProc, agProc;
async function main() {
  log("启动扩展网关 @", GATEWAY_PORT);
  gwProc = spawn("node", [GATEWAY], { env: { ...process.env, PORT: String(GATEWAY_PORT), DATA_FILE: tmpData }, stdio: "ignore" });

  log("启动本地代理 @", AGENT_PORT, "(mockVnc + dryRun)");
  agProc = spawn("node", [path.join(ROOT, "agent.mjs"), "--dry-run"], {
    env: { ...process.env, STELARITH_AGENT_PORT: String(AGENT_PORT), STELARITH_AGENT_SECRET: SECRET, STELARITH_EXT_URL: `http://127.0.0.1:${GATEWAY_PORT}`, STELARITH_DEVICE_UID: UID, MOCK_VNC: "1" },
    stdio: "ignore",
  });

  await waitFor(async () => (await req("GET", `http://127.0.0.1:${GATEWAY_PORT}/health`)).status === 200, "gateway up");
  await waitFor(async () => (await req("GET", `http://127.0.0.1:${AGENT_PORT}/status`)).status === 200, "agent up");
  log("两者就绪");

  // —— 模拟面板签名 ——
  const ts = Math.floor(Date.now() / 1000);
  const token = crypto.createHmac("sha256", SECRET).update(`remote_control_start|${ts}`).digest("hex");
  log("面板签名 token =", token.slice(0, 12) + "…");

  const start = await req("POST", `http://127.0.0.1:${AGENT_PORT}/task`, { action: "remote_control_start", token, scope: "class", ts });
  if (start.status !== 200) fail("代理拒绝合法指令 status=" + start.status);
  if (start.body.result !== "vnc_started") fail("未返回 vnc_started: " + JSON.stringify(start.body));
  const port = Number(start.body.vnc_port);
  log("代理已启 VNC port =", port, "token =", start.body.conn_token);
  if (!port || port < 5900) fail("vnc_port 非法: " + port);

  // —— 面板轮询回执 ——
  await waitFor(async () => {
    const r = await req("GET", `http://127.0.0.1:${GATEWAY_PORT}/vnc-session?uid=${UID}`);
    return r.body?.session && r.body.session.port === port;
  }, "网关收到 VNC 回执");
  const sess = (await req("GET", `http://127.0.0.1:${GATEWAY_PORT}/vnc-session?uid=${UID}`)).body.session;
  if (sess.ip !== DEVICE_IP) fail("回执 ip 应为 127.0.0.1，实际 " + sess.ip);
  log("网关回执拿到会话:", JSON.stringify(sess));

  // —— 代理 /status 显示 running ——
  const st = (await req("GET", `http://127.0.0.1:${AGENT_PORT}/status`)).body;
  if (st.vnc !== "running") fail("/status 未显示 running: " + JSON.stringify(st));
  log("/status =", JSON.stringify(st));

  // —— 模拟 noVNC 连接端口可达（mock TCP 监听）——
  const reachable = await new Promise((res) => {
    const s = net.connect(port, DEVICE_IP, () => { res(true); s.destroy(); });
    s.on("error", () => res(false));
    setTimeout(() => res(false), 1500);
  });
  if (!reachable) fail("mock VNC 端口不可达");
  log("noVNC 可连 mock VNC 端口 ✓");

  // —— 验签失败用例：错误密钥应被拒 ——
  const bad = await req("POST", `http://127.0.0.1:${AGENT_PORT}/task`, { action: "lock", token: "deadbeef", ts });
  if (bad.status !== 401) fail("非法令牌未被拒绝 status=" + bad.status);
  log("非法令牌被正确拒绝 (401) ✓");

  // —— 停止控制 ——
  const ts2 = Math.floor(Date.now() / 1000);
  const token2 = crypto.createHmac("sha256", SECRET).update(`remote_control_stop|${ts2}`).digest("hex");
  const stop = await req("POST", `http://127.0.0.1:${AGENT_PORT}/task`, { action: "remote_control_stop", token: token2, scope: "class", ts: ts2 });
  if (stop.body.result !== "vnc_stopped") fail("未停止: " + JSON.stringify(stop.body));
  await req("DELETE", `http://127.0.0.1:${GATEWAY_PORT}/vnc-session?uid=${UID}`);
  const after = (await req("GET", `http://127.0.0.1:${GATEWAY_PORT}/vnc-session?uid=${UID}`)).body.session;
  if (after !== null) fail("停止后网关会话未清除");
  log("停止并清除回执 ✓");

  console.log("\n[e2e] ✅ 全部通过：面板签名→代理验签→VNC回执→noVNC可达→停止清理 闭环验证成功");
  cleanup(0);
}

function cleanup(code) {
  try { gwProc.kill(); } catch {}
  try { agProc.kill(); } catch {}
  try { fs.unlinkSync(tmpData); } catch {}
  process.exit(code);
}
main().catch((e) => { console.error("[e2e] 异常:", e); cleanup(1); });
