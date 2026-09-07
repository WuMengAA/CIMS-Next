// voicehub → CIMS 同步适配器（服务端 / CI 侧「推送上屏」）
//
// 作用：拉取 voicehub 公开 API 的当前播放与待播队列，写入 CIMS 资源 Components/songboard。
//      这是集控面板「推送到本班屏幕」的服务端等价实现，适合在没有班级 bridge 的场景下，
//      由校内服务器定时把点歌状态推到 CIMS，供 ClassIsland 拉取上屏。
//
// 契约（已在 voicehub 源码 server/api/open/* 核实）：
//   GET /api/open/songs?played=true&sortBy=playedAt&sortOrder=desc&limit=1   -> 当前播放
//   GET /api/open/songs?played=false&sortBy=createdAt&sortOrder=asc&limit=N  -> 待播队列
//   CIMS 写入：POST /account/{acct}/Components/write?name=songboard  (Bearer token)
//
// 用法：
//   node voicehub-adapter.mjs                 # 单次同步
//   node voicehub-adapter.mjs --watch 30      # 每 30 秒同步一次
//
// 环境变量 / .env：
//   VOICEHUB_BASE, VOICEHUB_KEY  (voicehub 公开 API，需 songs:read)
//   CIMS_MGMT, CIMS_TOKEN, CIMS_ACCOUNT      (CIMS management 端口)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function env(k, d) {
  if (process.env[k] !== undefined) return process.env[k];
  try {
    const dot = JSON.parse(fs.readFileSync(path.join(__dirname, ".env"), "utf8"));
    if (dot[k] !== undefined) return dot[k];
  } catch (_) {}
  return d;
}

const CFG = {
  voicehubBase: (env("VOICEHUB_BASE", "https://voicehub.245959623.xyz") || "").replace(/\/+$/, ""),
  voicehubKey: env("VOICEHUB_KEY", "") || "",
  cimsMgmt: (env("CIMS_MGMT", "") || "").replace(/\/+$/, ""),
  cimsToken: env("CIMS_TOKEN", "") || "",
  cimsAccount: env("CIMS_ACCOUNT", "") || "",
};

async function vhub(apiPath) {
  const r = await fetch(CFG.voicehubBase + apiPath, {
    headers: { "x-api-key": CFG.voicehubKey, "Content-Type": "application/json" },
  });
  if (!r.ok) throw new Error("voicehub HTTP " + r.status);
  return r.json();
}

async function cimsWrite(acct, name, payload) {
  const r = await fetch(`${CFG.cimsMgmt}/account/${acct}/Components/write?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${CFG.cimsToken}` },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error("cims HTTP " + r.status);
  return r.json();
}

async function syncOnce() {
  if (!CFG.cimsMgmt || !CFG.cimsToken || !CFG.cimsAccount) {
    throw new Error("缺少 CIMS 配置（CIMS_MGMT / CIMS_TOKEN / CIMS_ACCOUNT）");
  }
  const [nowR, qR] = await Promise.all([
    vhub("/api/open/songs?played=true&sortBy=playedAt&sortOrder=desc&limit=1"),
    vhub("/api/open/songs?played=false&sortBy=createdAt&sortOrder=asc&limit=20"),
  ]);
  const nowRaw = nowR?.data?.songs?.[0] || null;
  const now = nowRaw
    ? { id: nowRaw.id, title: nowRaw.title, artist: nowRaw.artist, by: nowRaw.requester, at: nowRaw.playedAtFormatted, cover: nowRaw.cover || null }
    : null;
  const queue = (qR?.data?.songs || []).map((s) => ({
    id: s.id, title: s.title, artist: s.artist, by: s.requester, votes: s.voteCount, at: s.requestedAt, cover: s.cover || null,
  }));
  await cimsWrite(CFG.cimsAccount, "songboard", { name: "songboard", now, queue, pushedAt: Date.now() });
  console.log(`[sync] pushed now=${now?.title || "-"} queue=${queue.length} -> CIMS/${CFG.cimsAccount}/Components/songboard`);
}

async function main() {
  const watchIdx = process.argv.indexOf("--watch");
  if (watchIdx >= 0) {
    const sec = Number(process.argv[watchIdx + 1]) || 30;
    console.log(`[sync] watch mode every ${sec}s`);
    // 立即执行一次，再循环
    try { await syncOnce(); } catch (e) { console.error("[sync] error:", e.message); }
    setInterval(async () => {
      try { await syncOnce(); } catch (e) { console.error("[sync] error:", e.message); }
    }, sec * 1000);
  } else {
    await syncOnce();
  }
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
