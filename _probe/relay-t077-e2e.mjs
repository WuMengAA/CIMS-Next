// T07.7 端到端：真实 agent 截屏 → 回传 ext → 面板取图
// 用法: cd D:/Stelarith/Stelarith-website/stelarith && node _probe/relay-t077-e2e.mjs
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";

const AGENT = "http://127.0.0.1:17998";
const AGENT_SECRET = "dev-secret-change-me";
const UID = "t077-e2e-dev";
const BASE = "http://127.0.0.1:8090/api/console/ext";

const hmac = (msg) => crypto.createHmac("sha256", AGENT_SECRET).update(msg).digest("hex");
const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");

let pass = 0, fail = 0;
const check = (n, c, d) => { console.log(`${c ? "✓" : "✗"} ${n}${d ? " · " + d : ""}`); c ? pass++ : fail++; };

// ① 正确签名下发 screenshot
const ts = Math.floor(Date.now() / 1000);
const token = hmac(`screenshot|${ts}`);
let r = await fetch(`${AGENT}/task`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "screenshot", token, ts, scope: "device" })
});
const j = await r.json();
check("agent 执行截图并回执", r.status === 200 && j.result === "captured" && Number(j.bytes) > 10000,
  `HTTP ${r.status} result=${j.result} bytes=${j.bytes} path=${j.path}`);
const agentPng = fs.readFileSync(j.path);
console.log(`   agent 落盘: ${j.path} (${agentPng.length} bytes, md5=${md5(agentPng).slice(0,12)})`);

// ② 等待回传（agent 后台线程 POST 到 ext）
let capture = null;
for (let i = 0; i < 10; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const token2 = execSync(`node D:/Stelarith/_probe/mint-session.mjs mint admin`, { cwd: process.cwd(), encoding: "utf-8" }).trim();
  const rr = await fetch(`${BASE}/captures?uid=${encodeURIComponent(UID)}`, { headers: { Cookie: `admin_token=${token2}` } });
  const jj = await rr.json();
  execSync(`node D:/Stelarith/_probe/mint-session.mjs drop ${token2}`, { cwd: process.cwd(), encoding: "utf-8" });
  if (jj.capture) { capture = jj.capture; break; }
}
check("ext 网关收到 agent 回传的截图", !!capture, capture ? `at=${capture.at} bytes=${capture.bytes}` : "20s 内未收到");

// ③ 回传图片与 agent 落盘一致
const got = capture ? Buffer.from(capture.image_base64, "base64") : null;
check("回传图 = agent 落盘图", got && got.length === agentPng.length && md5(got) === md5(agentPng),
  got ? `md5=${md5(got).slice(0,12)}` : "无图");

// ④ 像素级抽查：解 IDAT 抽样像素亮度 → 非黑图非纯色（真实屏幕画面）
if (got) {
  try {
    const zlib = await import("node:zlib");
    // 解析 PNG：IHDR 宽高 + 拼接 IDAT inflate 后抽样
    let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, idat = [];
    while (pos + 8 <= got.length) {
      const len = got.readUInt32BE(pos);
      const type = got.toString("ascii", pos + 4, pos + 8);
      const data = got.subarray(pos + 8, pos + 8 + len);
      if (type === "IHDR") {
        width = data.readUInt32BE(0); height = data.readUInt32BE(4);
        bitDepth = data[8]; colorType = data[9];
      } else if (type === "IDAT") {
        idat.push(data);
      }
      pos += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    // 每行前 1 字节是 filter，RGB8 每像素 3 字节；行大小 = 1 + width * 3（RGB）或 *4（RGBA）
    const bpp = colorType === 6 ? 4 : 3;
    const stride = 1 + width * bpp;
    const ys = new Set();
    for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 64))) {
      const row = y * stride;
      for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 64))) {
        const o = row + 1 + x * bpp;
        const lum = (raw[o] * 299 + raw[o + 1] * 587 + raw[o + 2] * 114) / 1000;
        ys.add(Math.round(lum / 8));
      }
    }
    const blackish = [...ys].filter((v) => v <= 2).length;
    check("像素级：真实屏幕画面（亮度分布非纯黑）",
      ys.size > 8 && blackish / ys.size < 0.6,
      `${width}x${height} colorType=${colorType} 亮度档=${ys.size} 近黑档=${blackish}`);
  } catch (e) {
    check("像素级：真实屏幕画面", false, "解析失败 " + e.message);
  }
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
