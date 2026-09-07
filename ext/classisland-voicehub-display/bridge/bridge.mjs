// VoiceHub → 班级大屏 桥接代理（Node ≥18，零依赖）
//
// 职责：
//   1. 轮询 voicehub 公开 API（需 x-api-key 头，权限 songs:read），产出 songboard.json
//   2. 可选：读取 CIMS client 端口的 Components/songboard 资源，叠加「集控面板推送」的强制内容
//   3. 本地 HTTP 提供全屏看板（/board）与 JSON（/api/songboard），供班级大屏 / ClassIsland 插件消费
//
// 运行：node bridge.mjs   （配置优先读环境变量，其次 config.json）

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadConfig() {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8")); } catch (_) {}
  const env = (k, d) => (process.env[k] !== undefined ? process.env[k] : (file[k] !== undefined ? file[k] : d));
  return {
    voicehubBase: (env("VOICEHUB_BASE", "https://voicehub.245959623.xyz") || "").replace(/\/+$/, ""),
    voicehubKey: env("VOICEHUB_KEY", "") || "",
    pollSec: Number(env("POLL_SEC", 15)) || 15,
    port: Number(env("PORT", 8787)) || 8787,
    out: path.isAbsolute(env("OUT", "songboard.json")) ? env("OUT", "songboard.json") : path.join(__dirname, env("OUT", "songboard.json")),
    cimsClient: (env("CIMS_CLIENT", "") || "").replace(/\/+$/, ""),
    cimsToken: env("CIMS_TOKEN", "") || "",
    cimsAccount: env("CIMS_ACCOUNT", "") || "",
  };
}
const C = loadConfig();

async function vhub(apiPath) {
  const r = await fetch(C.voicehubBase + apiPath, {
    headers: { "x-api-key": C.voicehubKey, "Content-Type": "application/json" },
  });
  if (!r.ok) throw new Error("voicehub HTTP " + r.status);
  return r.json();
}

// 可选：读取 CIMS client 端口的 Components/songboard（集控面板「推送到本班屏幕」写入）
async function readCims() {
  if (!C.cimsClient) return null;
  try {
    const r = await fetch(`${C.cimsClient}/v1/client/Components?name=songboard`, {
      headers: C.cimsToken ? { Authorization: `Bearer ${C.cimsToken}` } : {},
    });
    if (!r.ok) return null;
    const j = await r.json();
    // 仅当推送时间在 6 小时内才视为有效强制内容
    if (j && j.pushedAt && Date.now() - j.pushedAt < 6 * 3600 * 1000) return j;
  } catch (_) {}
  return null;
}

async function tick() {
  const board = { updatedAt: Date.now(), source: "voicehub", now: null, queue: [] };
  try {
    const [nowR, qR] = await Promise.all([
      vhub("/api/open/songs?played=true&sortBy=playedAt&sortOrder=desc&limit=1"),
      vhub("/api/open/songs?played=false&sortBy=createdAt&sortOrder=asc&limit=12"),
    ]);
    const nowRaw = nowR?.data?.songs?.[0] || null;
    board.now = nowRaw
      ? { id: nowRaw.id, title: nowRaw.title, artist: nowRaw.artist, by: nowRaw.requester, at: nowRaw.playedAtFormatted, cover: nowRaw.cover || null }
      : null;
    board.queue = (qR?.data?.songs || []).map((s) => ({
      id: s.id, title: s.title, artist: s.artist, by: s.requester, votes: s.voteCount, at: s.requestedAt, cover: s.cover || null,
    }));
  } catch (e) {
    board.error = String(e.message || e);
  }
  const cims = await readCims();
  if (cims && (cims.now || (cims.queue && cims.queue.length))) {
    board.forced = { now: cims.now || null, queue: cims.queue || [], pushedAt: cims.pushedAt };
  }
  fs.writeFileSync(C.out, JSON.stringify(board, null, 2));
  console.log(`[bridge] updated now=${board.now?.title || "-"} queue=${board.queue.length} cims=${cims ? "yes" : "no"}`);
  return board;
}

// ---- 本地 HTTP 服务 ----
let boardHtml = "";
try { boardHtml = fs.readFileSync(path.join(__dirname, "board.html"), "utf8"); } catch (_) { boardHtml = "<h1>board.html missing</h1>"; }

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${C.port}`);
  if (u.pathname === "/api/songboard") {
    try {
      const b = JSON.parse(fs.readFileSync(C.out, "utf8"));
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(b));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ now: null, queue: [], updatedAt: Date.now() }));
    }
  } else if (u.pathname === "/health") {
    res.writeHead(200); res.end("ok");
  } else if (u.pathname === "/board" || u.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(boardHtml);
  } else {
    res.writeHead(404); res.end("not found");
  }
});

server.listen(C.port, () => {
  console.log(`[bridge] VoiceHub 大屏代理已启动`);
  console.log(`[bridge] 看板: http://localhost:${C.port}/board`);
  console.log(`[bridge] JSON: http://localhost:${C.port}/api/songboard`);
  console.log(`[bridge] voicehub=${C.voicehubBase} poll=${C.pollSec}s cims=${C.cimsClient || "未配置"}`);
});

tick();
setInterval(tick, C.pollSec * 1000);
