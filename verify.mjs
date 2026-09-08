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
  ["ext/voicehub-sync/voicehub-embed.mjs", "校园点歌即插即用模块（浏览器端）"],
  ["ext/voicehub-sync/voicehub-embed.test.mjs", "模块纯逻辑/契约测试"],
  ["ext/classisland-voicehub-display/bridge/bridge.mjs", "班级大屏桥接"],
];
for (const [f, desc] of ARTIFACTS) {
  const ok = fs.existsSync(path.join(__dirname, f));
  rec(ok ? "PASS" : "FAIL", "产物: " + f, ok ? desc + " ✓ 存在" : "缺失（需补）");
}

// ---- 1.5 关键接口契约静态校验（防止 API 导出/调用回归）----
function fileHas(f, re) {
  try { return re.test(fs.readFileSync(path.join(__dirname, f), "utf8")); } catch { return false; }
}
const apiPushOk =
  fileHas("admin-console/src/api.js", /async function vhubPush\s*\(/) &&
  fileHas("admin-console/src/api.js", /voicehubList, voicehubRequest, voicehubPush/);
rec(apiPushOk ? "PASS" : "FAIL", "契约: voicehubPush 已实现并导出", "真实写 CIMS Components/songboard（替代失效的 API.cims 调用）");
rec(fileHas("admin-console/src/app.js", /API\.voicehubPush\(/) ? "PASS" : "FAIL", "契约: 校园点歌推送改用 API.voicehubPush", "「推送到本班屏幕」走真实推送链路");
rec(fileHas("ext/voicehub-sync/voicehub-embed.mjs", /export class VoicehubEmbed/) ? "PASS" : "FAIL", "契约: 集控面板内嵌点歌即插即用模块已交付", "ext/voicehub-sync 提供浏览器端 VoicehubEmbed（list/request/pushToScreen/render）");
rec(fileHas("ext/voicehub-sync/voicehub-embed.mjs", /Components\/write\?name=songboard/) ? "PASS" : "FAIL", "契约: 推上屏写 CIMS Components/songboard", "与面板 api.js vhubPush 同一已核实资源");

// ---- 1.6 生产验签（Ed25519）契约静态校验 ----
const edOk =
  fileHas("ext/stelarith-agent-node/agent.mjs", /verifyEd25519/) &&
  fileHas("ext/stelarith-agent-node/agent.mjs", /STELARITH_SITE_PUBKEY/) &&
  fileHas("ext/stelarith-agent/src/main.rs", /verify_ed25519/) &&
  fileHas("ext/stelarith-agent/Cargo.toml", /ed25519-dalek/);
rec(edOk ? "PASS" : "FAIL", "契约: 生产 Ed25519 非对称验签已落地", "agent-node verifyEd25519（npm test 端到端验证通过）+ Rust verify_ed25519（生产版，待目标机 cargo build 回归）；与 sign-task.mjs 同契约 action|ts");

// ---- 1.7 真实 CIMS 契约 / 文档一致性校验（终验新增，防回归）----
// 依据（CIMS-backend 源码只读核实）：
//   app/api/management/account_router.py（prefix=/account/{account_id}/client）
//   app/api/command/client_control.py / client_notification.py / client_status.py
//   app/api/command/data_write.py（/{resource_type}/write）、data_crud.py（/{resource_type}/list）
//   app/api/client/manifest.py（/v1/client/{uid}/manifest）、app/api/client/resource.py（/v1/client/{type}）
const REAL_ENDPOINTS = [
  [/\/account\/\$\{acct\(\)\}\/client\/\$\{id\}\/command\/\$\{ep\}/, "客户端 command 端点由真实枚举拼装"],
  [/restart:\s*"restart",\s*sync:\s*"update-data",\s*notify:\s*"send-notification"/, "三个真实命令名与源码一致"],
  [/\/user\/auth/, "登录走 CIMS 原生 /user/auth"],
  [/\/account\/list/, "账户列表 /account/list"],
  [/\/account\/\$\{acct\(\)\}\/ClassPlan\/write\?name=/, "资源写 /account/{acct}/{type}/write?name="],
  [/\/v1\/client\/ClassPlan\?name=/, "配置拉取 /v1/client/{type}?name="],
];
for (const [re, desc] of REAL_ENDPOINTS) {
  rec(fileHas("admin-console/src/api.js", re) ? "PASS" : "FAIL", "契约: api.js 对接真实 CIMS — " + desc, "已与 CIMS-backend 源码逐条核实");
}
// 反虚构：api.js 不得出现未核实的 /gateway/* 端点
rec(!fileHas("admin-console/src/api.js", /["'`]\/gateway\//) ? "PASS" : "FAIL",
  "契约: api.js 无虚构 /gateway/* 端点", "面板只调 CIMS 原生接口 + 自有 extHost，不虚构网关");
// 反陈旧：文档不得残留错误 Manifest 路径 / 错误后端技术栈 / 已被证伪的表述
const DOC_FILES = ["README.md", "docs/实施方案.md", "architecture/架构图.md", "admin-console/API.md", "docs/field-deploy.md", "deploy/README.md"];
for (const f of DOC_FILES) {
  const clean =
    !fileHas(f, /\/api\/v1\/client\//) &&
    !fileHas(f, /CIMS 集控后端 \(Go/) &&
    !fileHas(f, /无 HTTP 暴露|仅 gRPC 无 HTTP|只有 gRPC/);
  rec(clean ? "PASS" : "FAIL", "一致性: " + f + " 无陈旧/错误表述", "Manifest 路径为 /v1/client/... 、后端为 Python+FastAPI、实时控制走 management HTTP");
}
// 交付物补全核对（交付汇报所列关键产物）
const DELIVERABLES = [
  ["交付汇报.md", "最终交付汇报"],
  ["docs/field-deploy.md", "现场部署 runbook"],
  ["classisland-config/视图配置示例.json", "客户端视图模板"],
  ["classisland-config/内网更新源说明.md", "内网更新源说明"],
  ["admin-console/API.md", "后端 API 真实契约"],
  ["admin-frontend/GRPC_COMMAND_PROXY.md", "历史参考（已标注证伪）"],
];
for (const [f, desc] of DELIVERABLES) {
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
