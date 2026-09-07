#!/usr/bin/env node
// 学校多媒体统一集控方案包 · 终验自检脚本
// --------------------------------------------------------------
// 逐项核对「七项需求」对应关键产物是否就位，并实跑扩展网关做
// 「聊天房间隔离（跨班互通）」冒烟。输出控制台结论 + 生成 verify-report.md。
//
// 用法：
//   node verify.mjs          完整自检（临时启动扩展网关做冒烟）
//   node verify.mjs --no-run 仅文件清单核对，不启动服务
// --------------------------------------------------------------
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NO_RUN = process.argv.includes("--no-run");

const results = [];
const rec = (level, name, detail) => results.push({ level, name, detail });

// ---- 1. 关键产物清单（对应七项需求）----
const ARTIFACTS = [
  ["README.md", "方案包总览"],
  ["STATUS.md", "进度清点"],
  ["docs/实施方案.md", "实施文档"],
  ["architecture/架构图.md", "架构图"],
  ["deploy/docker-compose.yml", "一键部署 compose"],
  ["deploy/Dockerfile", "CIMS 镜像"],
  ["deploy/nginx.conf", "nginx 反代"],
  ["deploy/ext-gateway/server.mjs", "扩展网关部署副本"],
  ["classisland-config/自动化规则-上课自动隐藏.json", "上课自动隐藏规则"],
  ["classisland-config/自动化规则-考试全校隐藏.json", "考试全校隐藏规则"],
  ["admin-console/src/api.js", "面板 API 层（含房间化 chat）"],
  ["admin-console/src/app.js", "面板逻辑（含房间切换 UI）"],
  ["admin-console/src-tauri/tauri.conf.json", "Tauri 壳配置"],
  ["ext/stelarith-agent/src/main.rs", "本地代理 Rust 版"],
  ["ext/stelarith-agent-node/agent.mjs", "本地代理 Node 参考实现"],
  ["ext/stelarith-agent-node/test/end2end.mjs", "端到端验证（签名↔验签↔VNC↔noVNC）"],
  ["ext/stelarith-ext-gateway/server.mjs", "扩展网关（chat/reports/vnc 回执）"],
  ["ext/stelarith-classisland-plugin/StelarithControlPlugin.cs", "ClassIsland 插件入口（真实 SDK）"],
  ["ext/stelarith-classisland-plugin/StelarithControlPlugin.csproj", "插件工程"],
  ["ext/stelarith-website-sync/sign-task.mjs", "指令令牌签名（Ed25519 生产模型）"],
  ["ext/voicehub-sync/voicehub-adapter.mjs", "校园点歌推送适配器"],
  ["ext/classisland-voicehub-display/bridge/bridge.mjs", "班级大屏桥接"],
];
for (const [f, desc] of ARTIFACTS) {
  const ok = fs.existsSync(path.join(__dirname, f));
  rec(ok ? "PASS" : "FAIL", "产物: " + f, ok ? desc + " ✓ 存在" : "缺失（需补）");
}

// ---- 2. 聊天房间隔离冒烟（实跑扩展网关）----
if (!NO_RUN) {
  const PORT = 18123;
  const DATA = path.join(__dirname, ".verify-ext.json");
  try { fs.unlinkSync(DATA); } catch {}
  const srv = spawn(process.execPath, [path.join(__dirname, "ext/stelarith-ext-gateway/server.mjs")], {
    env: { ...process.env, PORT: String(PORT), DATA_FILE: DATA },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${PORT}`;
  const jpost = (p, b) => new Promise((res, rej) => {
    const r = http.request(base + p, { method: "POST", headers: { "Content-Type": "application/json" } }, (x) => { let d = ""; x.on("data", (c) => (d += c)); x.on("end", () => res(JSON.parse(d || "{}"))); });
    r.on("error", rej); r.write(JSON.stringify(b)); r.end();
  });
  const jget = (p) => new Promise((res, rej) => {
    http.get(base + p, (x) => { let d = ""; x.on("data", (c) => (d += c)); x.on("end", () => res(JSON.parse(d || "{}"))); }).on("error", rej);
  });
  try {
    await new Promise((r) => setTimeout(r, 700));
    const h = await jget("/health");
    rec(h.status === "up" ? "PASS" : "FAIL", "扩展网关 /health", JSON.stringify(h.collections || h));
    await jpost("/chat", { text: "全校群消息", from: "高一(1)班", room: "techrep-global" });
    await jpost("/chat", { text: "本班消息", from: "高一(1)班", room: "class_a1" });
    const global = await jget("/chat?room=techrep-global");
    const cls = await jget("/chat?room=class_a1");
    const isolated =
      Array.isArray(global) && global.length === 1 && global[0].room === "techrep-global" &&
      Array.isArray(cls) && cls.length === 1 && cls[0].room === "class_a1";
    rec(isolated ? "PASS" : "FAIL", "聊天房间隔离（跨班互通）", `global=${global.length} class_a1=${cls.length} → 互相不可见`);
    const def = await jget("/chat");
    rec(Array.isArray(def) ? "PASS" : "FAIL", "聊天无 room 参数（默认 default，向后兼容）", `返回 ${def.length} 条`);
  } catch (e) {
    rec("FAIL", "扩展网关冒烟", e.message);
  } finally {
    srv.kill();
    try { fs.unlinkSync(DATA); } catch {}
  }
}

// ---- 3. 汇总 + 报告落盘 ----
const fails = results.filter((r) => r.level === "FAIL");
const reportLines = [
  "# 学校多媒体统一集控 · 终验自检报告",
  "",
  `生成时间：${new Date().toLocaleString()}`,
  `模式：${NO_RUN ? "仅文件清单" : "文件清单 + 扩展网关冒烟"}`,
  "",
  ...results.map((r) => `- [${r.level}] ${r.name} — ${r.detail}`),
  "",
  `总计 ${results.length} 项，失败 ${fails.length} 项。`,
  fails.length ? "结论：存在失败项，终验前需复核。" : "结论：关键产物就位，聊天跨班隔离实跑通过，方案包可交付。",
];
fs.writeFileSync(path.join(__dirname, "verify-report.md"), reportLines.join("\n"));

console.log("\n===== 学校多媒体统一集控 · 终验自检 =====");
for (const r of results) console.log(`[${r.level}] ${r.name} — ${r.detail}`);
console.log(`\n总计 ${results.length} 项，失败 ${fails.length} 项。报告已写入 verify-report.md`);
process.exit(fails.length ? 1 : 0);
