#!/usr/bin/env node
/**
 * 星集控 · 2 小时自检服务
 * ============================================================================
 * 为什么需要它（用户原话：「我们没有网上服务器，一旦本地错误就完蛋」）：
 *   这套系统全部跑在**一台本地 Windows 机器**上 —— 网站(8090)、CIMS 后端(8096~8100)、
 *   P2P 信令边车(18110)、公网隧道，全靠计划任务常驻。没有任何云端健康检查兜底，
 *   所以任何一处静默死掉（进程还在但接口 500、压缩旁文件坏掉、任务被停掉、
 *   磁盘写满、日志把盘吃光），都要等到老师上课点不动才发现。
 *   本脚本每 2 小时把这些"看不见的管道"逐个探一遍，能自愈的当场自愈。
 *
 * 设计铁律（都来自本项目踩过的坑，别改）：
 *   1. 【探活一律用 HTTP，不用 TCP 探端口】
 *      netsh portproxy 会在 ::1 上放一个转发桩，TCP 连得上但背后什么都没有 →
 *      "端口通=服务活"是假象。只有拿到 HTTP 响应才算活。
 *      （唯一的例外是 gRPC 8100，它本来就不是 HTTP，只能 TCP 探。）
 *   2. 【只打确定存在的路径】
 *      CCProtect 对 404 计数，打一个不存在的资源就是给整校 IP 攒封禁额度。
 *   3. 【不依赖会话令牌】
 *      令牌有 TTL，自检要能长期无人值守跑。所以用"无令牌直连 8097 → 期望 401"来判断
 *      "服务活着且鉴权层在工作"：401=正常，429=被限流，5xx=内部异常，000=进程死。
 *   4. 【区分"错误"与"待同步"】
 *      源目录比构建产物新是**开发中的正常状态**，报警告即可；
 *      构建产物自身的 明文/gz/br 三路不一致才是**真错误**（线上会发出坏文件）。
 *   5. 【自检脚本自己绝不能把机器拖垮】
 *      全程无阻塞长任务、每个探针 6s 超时、异常一律吞掉并记为"未知"。
 *
 * 用法：
 *   node selfcheck-2h.mjs          只体检，不改动任何东西
 *   node selfcheck-2h.mjs --fix    体检 + 自动修复（拉起挂掉的服务、重建压缩旁文件）
 *
 * 退出码：0=全绿  1=有警告  2=有严重问题（供计划任务/看门狗识别）
 * 产物：_logs/selfcheck-2h.jsonl（逐次追加）、_logs/selfcheck-latest.json（最新一次）
 * ============================================================================
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

const ROOT = "D:\\Stelarith";
const SITE = path.join(ROOT, "Stelarith-website", "stelarith");
const CONSOLE_SRC = path.join(SITE, "static", "console");
const CONSOLE_DST = path.join(SITE, "build", "client", "console");
const LOG_DIR = path.join(ROOT, "_logs");
// ⚠️ CIMS 的日志不在根 _logs（那是自检报告的地盘），而在后端工程自己的 _logs 下。
// 曾经这里写成同一个目录 → 日志膨胀检查恒为「0B」，等于没查。
const CIMS_LOG_DIR = path.join(ROOT, "Stelarith-cims-eval", "_logs");
const REPORT_JSONL = path.join(LOG_DIR, "selfcheck-2h.jsonl");
const LATEST_JSON = path.join(LOG_DIR, "selfcheck-latest.json");
const SYNC_SCRIPT = path.join(ROOT, "_tools", "sync-console.mjs");

const FIX = process.argv.includes("--fix");
const TIMEOUT_MS = 6000;
const PROBE_BYTES = 400;

// 计划任务以 SYSTEM/服务账户运行时，PATH 里不一定有 powershell → 一律用绝对路径。
const PS_EXE = fs.existsSync("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
  ? "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
  : "powershell.exe";

// 需要常驻的计划任务（自检发现"没在跑"就尝试拉起）
const SERVICES = [
  { task: "StelarithServer", desc: "网站 + 集控面板", critical: true },
  { task: "CIMS-Backend-AutoStart", desc: "CIMS 后端", critical: true },
  { task: "Stelarith-P2P-Signaling", desc: "P2P 信令边车", critical: false },
  { task: "Cloudflared-Stelarith-Tunnel", desc: "公网隧道", critical: false },
  { task: "Stelarith-Agent-AutoStart", desc: "教室 Agent 计划任务", critical: false },
];

// ---------------------------------------------------------------------------
// 基础设施
// ---------------------------------------------------------------------------

/** HTTP 探针：唯一可靠的"服务还活着吗"判据。可自定义 Host 头（CIMS 靠 Host 认租户）与任意头。 */
function httpProbe({ port, path: p = "/", method = "GET", hostHeader, headers = {}, timeoutMs = TIMEOUT_MS, maxBytes = PROBE_BYTES }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const h = { ...headers };
    if (hostHeader) h.Host = hostHeader;
    const req = http.request(
      { host: "127.0.0.1", port, path: p, method, headers: h, timeout: timeoutMs },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { if (body.length < maxBytes) body += c; });
        res.on("end", () =>
          resolve({ alive: true, status: res.statusCode, body: body.slice(0, maxBytes), ms: Date.now() - started })
        );
      }
    );
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
    req.on("error", (e) => resolve({ alive: false, status: 0, error: e.message, ms: Date.now() - started }));
    req.end();
  });
}

/** TCP 探针：仅用于 gRPC 8100（它不是 HTTP，没有别的办法）。 */
function tcpProbe(port, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve) => {
    const started = Date.now();
    const sock = net.connect({ host: "127.0.0.1", port });
    const done = (ok, err) => {
      sock.destroy();
      resolve({ alive: ok, ms: Date.now() - started, error: err });
    };
    sock.setTimeout(timeoutMs);
    sock.on("connect", () => done(true));
    sock.on("timeout", () => done(false, "timeout"));
    sock.on("error", (e) => done(false, e.message));
  });
}

/** 查询计划任务状态（返回 Running / Ready / Disabled / Unknown）。 */
async function taskState(name) {
  try {
    const { stdout } = await pexec(
      PS_EXE,
      ["-NoProfile", "-NonInteractive", "-Command", `(Get-ScheduledTask -TaskName '${name}' -ErrorAction Stop).State`],
      { timeout: 15000, windowsHide: true }
    );
    return String(stdout).trim() || "Unknown";
  } catch (_) {
    return "Unknown";
  }
}

async function startTask(name) {
  try {
    await pexec(
      PS_EXE,
      ["-NoProfile", "-NonInteractive", "-Command", `Start-ScheduledTask -TaskName '${name}'`],
      { timeout: 20000, windowsHide: true }
    );
    return true;
  } catch (_) {
    return false;
  }
}

function md5(buf) {
  return crypto.createHash("md5").update(buf).digest("hex");
}

function human(bytes) {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(i === 0 ? 0 : 1) + u[i];
}

// ---------------------------------------------------------------------------
// 检查项
// ---------------------------------------------------------------------------
const results = [];
function record(id, level, title, detail, fix) {
  results.push({ id, level, title, detail, fix: fix || null });
  const tag = level === "ok" ? "  OK  " : level === "warn" ? " WARN " : " FAIL ";
  console.log(`[${tag}] ${title}${detail ? " — " + detail : ""}${fix ? "  ⟶ " + fix : ""}`);
}

// 1) 网站 + 集控面板
async function checkSite() {
  const r = await httpProbe({ port: 8090, path: "/console/index.html" });
  if (r.alive && r.status === 200) {
    record("site", "ok", "网站/面板 8090", `HTTP 200 · ${r.ms}ms`);
    return true;
  }
  let fix = null;
  if (FIX) {
    await startTask("StelarithServer");
    fix = "已执行 Start-ScheduledTask StelarithServer";
  }
  record("site", "fail", "网站/面板 8090 不可用", r.alive ? `HTTP ${r.status}` : (r.error || "无响应"), fix);
  return false;
}

// 2) CIMS 三个 app + gRPC
async function checkCims() {
  // 8096 客户端口：必须带 Host 才能过租户识别（裸 IP 403 是设计如此，不算故障）
  const client = await httpProbe({ port: 8096, path: "/", hostHeader: "245959623.xyz" });
  if (client.alive) {
    record("cims-client", "ok", "CIMS client 8096", `HTTP ${client.status} · ${client.ms}ms`);
  } else {
    record("cims-client", "fail", "CIMS client 8096 无响应", client.error || "连接失败");
  }

  // 8097 管理口：/class/list 是**面板班级下拉的唯一数据源**，也是今晚出问题的那条链路。
  // 无令牌 → 期望 401（服务活着 + 鉴权层正常）。429/5xx/000 都是异常。
  const mgmt = await httpProbe({ port: 8097, path: "/class/list" });
  if (mgmt.alive && mgmt.status === 401) {
    record("cims-mgmt", "ok", "CIMS management 8097 + 班级接口", "HTTP 401（鉴权层正常）");
  } else if (mgmt.alive && mgmt.status === 429) {
    record("cims-mgmt", "fail", "CIMS 8097 正在限流封禁", "HTTP 429 异常封禁（CCProtect）");
  } else if (mgmt.alive && mgmt.status >= 500) {
    record("cims-mgmt", "fail", "CIMS 8097 班级接口内部异常",
      `HTTP ${mgmt.status} ${(mgmt.body || "").slice(0, 90)}`);
  } else {
    record("cims-mgmt", "fail", "CIMS management 8097 无响应", mgmt.error || "连接失败");
  }

  const admin = await httpProbe({ port: 8098, path: "/" });
  if (admin.alive) {
    record("cims-admin", "ok", "CIMS admin 8098", `HTTP ${admin.status} · ${admin.ms}ms`);
  } else {
    record("cims-admin", "fail", "CIMS admin 8098 无响应", admin.error || "连接失败");
  }

  const grpc = await tcpProbe(8100);
  if (grpc.alive) {
    record("cims-grpc", "ok", "CIMS gRPC 8100", `TCP 已监听 · ${grpc.ms}ms`);
  } else {
    record("cims-grpc", "warn", "CIMS gRPC 8100 未监听", grpc.error || "连接失败");
  }

  return client.alive && mgmt.alive;
}

// 3) 计划任务是否都在跑
async function checkTasks() {
  let allOk = true;
  for (const s of SERVICES) {
    const st = await taskState(s.task);
    if (st === "Running") {
      record("task:" + s.task, "ok", `${s.desc} 计划任务`, `状态 ${st}`);
      continue;
    }
    allOk = false;
    if (st === "Ready" || st === "Disabled") {
      let fix = null;
      if (FIX && st === "Ready") {
        const ok = await startTask(s.task);
        fix = ok ? "已尝试 Start-ScheduledTask 拉起" : "拉起失败（需人工）";
      } else if (st === "Disabled") {
        fix = "任务被禁用，需要人工启用（自检不擅自改配置）";
      }
      record("task:" + s.task, s.critical ? "fail" : "warn",
        `${s.desc} 计划任务未在运行`, `状态 ${st}`, fix);
    } else {
      record("task:" + s.task, s.critical ? "fail" : "warn",
        `${s.desc} 计划任务状态未知`, "查询失败（任务可能不存在）");
    }
  }
  return allOk;
}

// 4) 构建产物自身的压缩旁文件是否自洽（真错误：线上会发出坏文件）
function checkArtifacts() {
  let ok = true;
  let checked = 0;
  let bad = [];
  let entries = [];
  try {
    entries = fs.readdirSync(CONSOLE_DST);
  } catch (e) {
    record("artifacts", "fail", "构建产物目录不可读", CONSOLE_DST);
    return false;
  }
  for (const name of entries) {
    if (!/\.(js|css|html|mjs)$/.test(name)) continue;
    const plainPath = path.join(CONSOLE_DST, name);
    const gzPath = plainPath + ".gz";
    const brPath = plainPath + ".br";
    if (!fs.existsSync(gzPath) && !fs.existsSync(brPath)) continue; // 没有旁文件的不比
    checked++;
    try {
      const plain = fs.readFileSync(plainPath);
      const h = md5(plain);
      if (fs.existsSync(gzPath)) {
        const g = zlib.gunzipSync(fs.readFileSync(gzPath));
        if (md5(g) !== h) { ok = false; bad.push(name + ".gz"); }
      }
      if (fs.existsSync(brPath)) {
        const b = zlib.brotliDecompressSync(fs.readFileSync(brPath));
        if (md5(b) !== h) { ok = false; bad.push(name + ".br"); }
      }
    } catch (e) {
      ok = false;
      bad.push(name + "（解压失败：" + e.message + "）");
    }
  }
  if (!checked) {
    record("artifacts", "warn", "构建产物里没有可比对的压缩旁文件", CONSOLE_DST);
    return true;
  }
  if (ok) {
    record("artifacts", "ok", "面板静态件三路一致", `${checked} 个文件 明文/gz/br md5 全同`);
  } else {
    let fix = null;
    if (FIX && fs.existsSync(SYNC_SCRIPT)) {
      fix = "已重建压缩旁文件，需重启 StelarithServer 才生效";
      try {
        execFileSync(process.execPath, [SYNC_SCRIPT], {
          env: { ...process.env, CODEBUDDY_SAFE_DELETE_ENABLED: "0" },
          timeout: 120000, windowsHide: true,
        });
      } catch (_) { fix = "重建失败，需人工处理"; }
    }
    record("artifacts", "fail", "构建产物压缩旁文件与明文不一致（线上会发坏文件）",
      bad.join(", "), fix);
  }
  return ok;
}

// 5) 源目录 vs 构建产物：新了没同步（开发中的正常状态 → 警告，不是错误）
function checkSrcSync() {
  const stale = [];
  try {
    for (const name of fs.readdirSync(CONSOLE_SRC)) {
      if (!/\.(js|css|html|mjs)$/.test(name)) continue;
      const a = path.join(CONSOLE_SRC, name);
      const b = path.join(CONSOLE_DST, name);
      if (!fs.existsSync(b)) { stale.push(name + "（构建产物缺失）"); continue; }
      const ma = fs.statSync(a).mtimeMs;
      const mb = fs.statSync(b).mtimeMs;
      if (ma > mb + 1000) stale.push(name + "（源较新 " + Math.round((ma - mb) / 60000) + "min）");
    }
  } catch (e) {
    record("srcsync", "warn", "源/产物同步检查失败", e.message);
    return true;
  }
  if (stale.length) {
    record("srcsync", "warn", "面板源码比构建产物新，尚未同步上线", stale.join(", "));
    return false;
  }
  record("srcsync", "ok", "面板源码与构建产物已同步", "无待同步文件");
  return true;
}

// 6) 磁盘剩余空间（C + D 双盘）
// D 盘：日志/数据库所在。C 盘：CIMS 运行时与 uv/Python 缓存所在 ——
// C 盘写临时文件失败也会让 CIMS 硬崩（2026-09-23 T07 实测 C 盘只剩 0.5GB）。
async function checkDisk() {
  const drives = ["C", "D"];
  let allOk = true;
  for (const dv of drives) {
    try {
      const { stdout } = await pexec(
        PS_EXE,
        ["-NoProfile", "-NonInteractive", "-Command",
          `Get-PSDrive -Name ${dv} | Select-Object -ExpandProperty Free`],
        { timeout: 15000, windowsHide: true }
      );
      const free = Number(String(stdout).trim());
      if (!Number.isFinite(free) || free <= 0) throw new Error("解析失败");
      const GB = free / 1024 ** 3;
      if (free < 2 * 1024 ** 3) {
        record("disk-" + dv, "fail", dv + " 盘剩余空间告急", GB.toFixed(1) + "GB（< 2GB，写入会失败）");
        allOk = false;
      } else if (free < 10 * 1024 ** 3) {
        record("disk-" + dv, "warn", dv + " 盘剩余空间偏少", GB.toFixed(1) + "GB");
        allOk = false;
      } else {
        record("disk-" + dv, "ok", dv + " 盘剩余空间", GB.toFixed(1) + "GB");
      }
    } catch (e) {
      record("disk-" + dv, "warn", dv + " 盘空间检查失败", e.message);
    }
  }
  return allOk;
}

// 7) 面板班级数据深检：铸 admin 会话直查代理，确认返回的是**真实班级数组**
//（防止「端点 200 但 listClasses 静默降级成演示班级」的回归，用户 09-22 报过的问题）。
// mint 会话失败时降级为跳过（标 warn 不标 fail），不依赖它判断服务生死。
async function checkClassListReal() {
  const SITE_DIR = path.join(ROOT, "Stelarith-website", "stelarith");
  // ⚠️ mint 脚本本体在 D:\Stelarith\_probe\（不在网站目录）；但它的 cwd 必须是网站工程
  // （内部用相对路径 content/stelarith.db 找库）。
  const MINT_JS = path.join(ROOT, "_probe", "mint-session.mjs");
  try {
    const { stdout } = await pexec(
      process.execPath,
      [MINT_JS, "mint", "admin"],
      { cwd: SITE_DIR, timeout: 20000, windowsHide: true }
    );
    const tok = String(stdout).trim().split(/\r?\n/)[0];
    if (!tok) throw new Error("mint 无输出");
    const r = await httpProbe({
      port: 8090,
      path: "/api/console/cims/class/list",
      headers: { Cookie: "admin_token=" + tok },
      maxBytes: 8000,
    });
    if (r.alive && r.status === 200) {
      let arr = null;
      try { arr = JSON.parse(r.body); } catch (_) {}
      if (Array.isArray(arr) && arr.length > 0) {
        const first = arr[0];
        record("classlist-real", "ok", "面板班级数据为真实班级",
          `代理返回 ${arr.length} 个班级实体（首项 ${first.name || first.class_id || "?"}）`);
      } else {
        record("classlist-real", "fail", "面板班级数据可疑",
          "HTTP 200 但 body 非真实班级数组（可能是静默降级）");
      }
    } else {
      record("classlist-real", "warn", "面板班级数据未验证",
        r.alive ? `HTTP ${r.status}` : (r.error || "无响应"));
    }
  } catch (e) {
    record("classlist-real", "warn", "面板班级数据深检跳过", "mint 会话失败: " + e.message);
  }
}

// 7) 后端日志膨胀（2026-09-22 实测单日 633MB，会把盘慢慢吃光）
function checkLogSize() {
  const LIMIT = 300 * 1024 * 1024;
  let big = [];
  let total = 0;
  try {
    for (const f of fs.readdirSync(CIMS_LOG_DIR)) {
      if (!/^cims-\d{8}\.log$/.test(f)) continue;
      const s = fs.statSync(path.join(CIMS_LOG_DIR, f)).size;
      total += s;
      if (s > LIMIT) big.push(`${f} ${human(s)}`);
    }
  } catch (e) {
    record("logsize", "warn", "日志大小检查失败", e.message);
    return true;
  }
  if (big.length) {
    record("logsize", "warn", "CIMS 日志单文件过大（会持续吃盘）", big.join(", "));
    return false;
  }
  record("logsize", "ok", "CIMS 日志体积正常", "累计 " + human(total));
  return true;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  const started = new Date();
  console.log("=".repeat(72));
  console.log(`星集控 2 小时自检 — ${started.toLocaleString("zh-CN")}${FIX ? "  [自动修复已开启]" : "  [只读体检]"}`);
  console.log("=".repeat(72));

  await checkSite();
  await checkCims();
  await checkClassListReal();
  await checkTasks();
  checkArtifacts();
  checkSrcSync();
  await checkDisk();
  checkLogSize();

  const fails = results.filter((r) => r.level === "fail");
  const warns = results.filter((r) => r.level === "warn");
  // 退出码语义：只有**严重问题**才非零。
  // 警告（例如"源码比产物新、还没同步上线"）是开发中的常态，若也返回非零，
  // 任务计划程序会把每次运行都标成"失败"，真正的故障反而被淹没在噪音里。
  const code = fails.length ? 2 : 0;

  console.log("-".repeat(72));
  console.log(`结果：${results.length - fails.length - warns.length} 正常 / ${warns.length} 警告 / ${fails.length} 严重`);

  const record0 = {
    at: started.toISOString(),
    atLocal: started.toLocaleString("zh-CN"),
    fixMode: FIX,
    exitCode: code,
    summary: { ok: results.length - fails.length - warns.length, warn: warns.length, fail: fails.length },
    results,
  };

  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(REPORT_JSONL, JSON.stringify(record0) + "\n", "utf8");
    fs.writeFileSync(LATEST_JSON, JSON.stringify(record0, null, 2), "utf8");
  } catch (e) {
    console.error("写自检报告失败：" + e.message);
  }

  process.exit(code);
}

main().catch((e) => {
  console.error("自检脚本自身异常：" + (e && e.stack || e));
  process.exit(2);
});
