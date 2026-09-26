// T07.7 步骤 2 验收：截图回传接口（设备 POST / 面板 GET / 错误密钥拒绝）
// 用法: cd D:/Stelarith/Stelarith-website/stelarith && node _probe/relay-t077-step2-verify.mjs
// 依赖: 网站 8090 已重启（含 captures 端点）、_probe/mint-session.mjs 可用
import { execSync } from "node:child_process";
import fs from "node:fs";
import crypto from "node:crypto";

const BASE = "http://127.0.0.1:8090/api/console/ext";
const SECRET = "564608a2bb712f1cf4d6ea5358fe3724e96d1085db6ad4be";
const UID = "t077-verify-dev";

const png = fs.readFileSync("D:/Stelarith/_probe/home-dark.png");
const b64 = png.toString("base64");
const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " · " + detail : ""}`);
  cond ? pass++ : fail++;
};

// ① 设备密钥 POST 回传截图
let r1 = await fetch(`${BASE}/captures`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-stelarith-device-secret": SECRET },
  body: JSON.stringify({ uid: UID, image_base64: b64 })
});
const j1 = await r1.json();
check("设备 POST 截图（正确密钥）", r1.status === 200 && j1.ok === true && j1.bytes === png.length,
  `HTTP ${r1.status} bytes=${j1.bytes}`);

// ② 错误密钥 POST → 403
let r2 = await fetch(`${BASE}/captures`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-stelarith-device-secret": "wrong-secret-000000000000000000000000000000" },
  body: JSON.stringify({ uid: UID, image_base64: b64 })
});
check("设备 POST 截图（错误密钥）拒绝", r2.status === 403, `HTTP ${r2.status}`);

// ③ 非法 base64 → 400
let r3 = await fetch(`${BASE}/captures`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-stelarith-device-secret": SECRET },
  body: JSON.stringify({ uid: UID, image_base64: "not-a-base64!!!" })
});
check("非法 base64 拒绝", r3.status === 400, `HTTP ${r3.status}`);

// ④ 非 PNG 魔数 → 400（合法 base64 但内容是文本）
const fakeB64 = Buffer.from("hello this is not a png but valid base64 bytes ........").toString("base64");
let r4 = await fetch(`${BASE}/captures`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-stelarith-device-secret": SECRET },
  body: JSON.stringify({ uid: UID, image_base64: fakeB64 })
});
check("非 PNG 魔数拒绝", r4.status === 400, `HTTP ${r4.status}`);

// ⑤ 面板 GET（真实 admin 会话）
const token = execSync(`node D:/Stelarith/_probe/mint-session.mjs mint admin`, { cwd: process.cwd(), encoding: "utf-8" }).trim();
let r5 = await fetch(`${BASE}/captures?uid=${encodeURIComponent(UID)}`, {
  headers: { Cookie: `admin_token=${token}` }
});
const j5 = await r5.json();
const got = j5.capture ? Buffer.from(j5.capture.image_base64, "base64") : null;
check("面板 GET 取到截图（真实会话）", r5.status === 200 && j5.capture && got && got.length === png.length,
  `HTTP ${r5.status} at=${j5.capture?.at} bytes=${j5.capture?.bytes}`);
check("回传图片内容与上传一致", got && md5(got) === md5(png), `md5=${md5(got ?? Buffer.alloc(0)).slice(0, 12)}`);
check("截图元数据含时间戳", j5.capture && Number.isFinite(j5.capture.at), `at=${j5.capture?.at}`);

// ⑥ 未知设备 GET → capture:null（明确区分「没报过」）
let r6 = await fetch(`${BASE}/captures?uid=nobody-device-xyz`, { headers: { Cookie: `admin_token=${token}` } });
const j6 = await r6.json();
check("未报过截图的设备返回 null", r6.status === 200 && j6.capture === null, `reason=${j6.reason}`);

// ⑦ 用户会话 POST → 403（设备端点不接受用户写入）
let r7 = await fetch(`${BASE}/captures`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: `admin_token=${token}` },
  body: JSON.stringify({ uid: UID, image_base64: b64 })
});
check("用户会话 POST 截图被拒", r7.status === 403, `HTTP ${r7.status} code=${(await r7.json()).code}`);

// ⑧ DELETE 清除截图
let r8 = await fetch(`${BASE}/captures?uid=${encodeURIComponent(UID)}`, {
  method: "DELETE", headers: { Cookie: `admin_token=${token}` }
});
let r9 = await fetch(`${BASE}/captures?uid=${encodeURIComponent(UID)}`, { headers: { Cookie: `admin_token=${token}` } });
const j9 = await r9.json();
check("DELETE 清除截图后 GET 为空", r8.status === 200 && j9.capture === null, `reason=${j9.reason}`);

// 清理会话
execSync(`node D:/Stelarith/_probe/mint-session.mjs drop ${token}`, { cwd: process.cwd(), encoding: "utf-8" });
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
