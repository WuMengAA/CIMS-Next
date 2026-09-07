#!/usr/bin/env node
/**
 * Stelarith 集控扩展网关（协作 / 上报 / VNC 回执）
 * ----------------------------------------------------------------
 * 这是「学校多媒体统一集控方案包」里的自有轻量服务，不是虚构网关。
 * 面板（admin-console / 内嵌 /admin/console）通过 API.ext() 调用下列端点；
 * 本服务自带存储，不依赖任何外部系统，可独立部署或在 docker-compose 中启动。
 *
 * 端点（均为 JSON，启用 CORS 以便浏览器直连）：
 *   GET  /health
 *   GET  /notices           列出公告（按时间倒序）
 *   POST /notices           {title, scope?, body?}           新增公告
 *   GET  /chat?room=xxx    列出某房间（班级/群组）交流消息；默认 techrep-global（全校电教委员群）
 *   POST /chat             {text, from?, room?}             发送消息到房间（跨班互通，room 缺省归全校群）
 *   GET  /reports          列出故障工单
 *   POST /reports          {title, level?, desc?, by?}      提交工单
 *   GET  /bugs             列出 Bug
 *   POST /bugs             {title, steps?, log?, by?}       提交 Bug
 *   GET  /audit            列出审计记录
 *   POST /audit            {who, act, target?}              写审计
 *   POST /vnc-session      {uid, ip, port, token, proto?}   设备/插件回报 VNC 会话（回执通道）
 *   GET  /vnc-session?uid= 取某设备最新 VNC 会话；无 uid 取全部
 *   DELETE /vnc-session?uid= 清除某设备会话（结束控制时调用）
 *
 * 存储：JSON 文件（DATA_FILE，默认 ./data.json），故重启不丢。
 * 鉴权：本服务默认信任内网；如需保护，请在 nginx 层加 Basic/网络隔离。
 *
 * 用法：
 *   node server.mjs                      # 监听 8088
 *   PORT=9000 DATA_FILE=/data/ext.json node server.mjs
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8088);
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");

const COLLECTIONS = ["notices", "chat", "reports", "bugs", "audit", "vnc"];

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    for (const c of COLLECTIONS) if (!Array.isArray(raw[c])) raw[c] = [];
    return raw;
  } catch {
    return { notices: [], chat: [], reports: [], bugs: [], audit: [], vnc: [] };
  }
}
let db = load();
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), (e) => {
      if (e) console.error("[ext] 写入失败:", e.message);
    });
  }, 50);
}

function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function ts() {
  return new Date().toISOString();
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
  });
}
function q(url) {
  const idx = url.indexOf("?");
  return idx < 0 ? {} : Object.fromEntries(new URLSearchParams(url.slice(idx + 1)));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  const url = req.url || "/";
  const pathname = url.split("?")[0];
  const params = q(url);

  try {
    // ---- 健康检查 ----
    if (pathname === "/health" && req.method === "GET") {
      return send(res, 200, { status: "up", collections: COLLECTIONS });
    }

    // ---- VNC 会话回执（远程控制返回通道）----
    if (pathname === "/vnc-session") {
      if (req.method === "POST") {
        const b = await readBody(req);
        if (!b.uid || !b.port) return send(res, 400, { error: "uid 与 port 必填" });
        const entry = {
          id: randomUUID(),
          uid: String(b.uid),
          ip: b.ip || "",
          port: Number(b.port),
          token: b.token || "",
          proto: b.proto || "vnc",
          at: ts(),
        };
        // 同设备只保留最新一条
        db.vnc = db.vnc.filter((x) => x.uid !== entry.uid);
        db.vnc.unshift(entry);
        save();
        return send(res, 200, { ok: true, session: entry });
      }
      if (req.method === "GET") {
        if (params.uid) {
          const found = db.vnc.find((x) => x.uid === params.uid) || null;
          return send(res, 200, { session: found });
        }
        return send(res, 200, { sessions: db.vnc });
      }
      if (req.method === "DELETE") {
        if (params.uid) {
          db.vnc = db.vnc.filter((x) => x.uid !== params.uid);
          save();
        }
        return send(res, 200, { ok: true });
      }
    }

    // ---- 班级交流（chat）：房间/班级隔离，支持跨班互通 ----
    // 默认房间 "techrep-global" = 全校电教委员群；各班级可建独立房间（room=班级标识）。
    // 历史消息无 room 字段时按 "default" 处理，向后兼容。
    if (pathname === "/chat") {
      if (req.method === "GET") {
        const room = params.room || "default";
        const list = db.chat
          .filter((m) => (m.room || "default") === room)
          .sort((a, b) => (b.at || "").localeCompare(a.at || ""));
        return send(res, 200, list);
      }
      if (req.method === "POST") {
        const b = await readBody(req);
        if (!b.text) return send(res, 400, { error: "text 必填" });
        const item = {
          id: randomUUID(), at: ts(),
          room: b.room || "techrep-global",
          from: b.from || "anonymous",
          text: b.text,
        };
        db.chat.unshift(item);
        save();
        return send(res, 200, item);
      }
    }

    // ---- 通用集合：notices/chat/reports/bugs/audit ----
    const coll = pathname.replace(/^\//, "");
    if (COLLECTIONS.includes(coll)) {
      if (req.method === "GET") {
        const list = [...db[coll]].sort((a, b) => (b.at || "").localeCompare(a.at || ""));
        return send(res, 200, list);
      }
      if (req.method === "POST") {
        const b = await readBody(req);
        const item = { id: randomUUID(), at: ts(), ...b };
        db[coll].unshift(item);
        save();
        return send(res, 200, item);
      }
    }

    return send(res, 404, { error: "not found", path: pathname });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`[Stelarith EXT Gateway] listening on :${PORT}  data=${DATA_FILE}`);
});
