#!/usr/bin/env node
/**
 * sync-to-cims.mjs —— 把 stelarith-website 的校园内容同步下发到 CIMS 设备。
 *
 * 联动线（docs/扩展能力设计.md §4.2「网站驱动屏幕」）：
 *   网站 CMS（内容源） ──本脚本──▶ CIMS 资源写接口 ──▶ 设备经 Manifest 自动拉取生效
 *
 * 真实接口（已查证 CIMS-backend）：
 *   - 登录：   POST {CIMS_MANAGEMENT_URL}/user/auth        body: {username,password}
 *              → { token } ；后续请求头 Authorization: Bearer <token>
 *   - 资源写： POST {CIMS_MANAGEMENT_URL}/account/{accountId}/{resourceType}/write?name={name}
 *              body: <JSON 对象>（直接存为 record.content）；可选 ?version=
 *              resourceType ∈ ClassPlan|TimeLayout|Subjects|Policy|DefaultSettings|Components|Credentials
 *
 * 用法：node sync-to-cims.mjs --manifest ./push-manifest.json
 * 注意：路径前缀以运行中的 CIMS 为准（本脚本默认 /account/{id} 前缀，已与源码一致）。
 */

import { readFileSync } from "node:fs";

const CIMS = process.env.CIMS_MANAGEMENT_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8081";
const ACCOUNT = process.env.CIMS_ACCOUNT_ID ?? "test-school";
const USER = process.env.CIMS_USER ?? "admin";
const PASS = process.env.CIMS_PASS ?? "";

async function cimsLogin() {
  const r = await fetch(`${CIMS}/user/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: USER, password: PASS }),
  });
  if (!r.ok) throw new Error(`CIMS 登录失败 ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.token ?? j.data?.token;
}

async function writeResource(token, type, name, content) {
  const url = `${CIMS}/account/${ACCOUNT}/${type}/write?name=${encodeURIComponent(name)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(content),
  });
  const ok = r.ok;
  const text = await r.text();
  console.log(`  ${ok ? "✅" : "❌"} ${type}/${name} -> ${r.status} ${text.slice(0, 80)}`);
  if (!ok) throw new Error(`写入 ${type}/${name} 失败`);
}

async function main() {
  const manifestPath = process.argv.find((a) => a.endsWith(".json")) ?? "./push-manifest.json";
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  // manifest 结构示例：
  // {
  //   "ClassPlan": { "高一(3)班": {<ClassIsland ClassPlan JSON>} },
  //   "Policy":    { "default":   {<策略 JSON>} },
  //   "DefaultSettings": { "default": {<设置 JSON>} }
  // }
  console.log(`[sync] 登录 CIMS: ${CIMS}`);
  const token = await cimsLogin();
  for (const [type, entries] of Object.entries(manifest)) {
    for (const [name, content] of Object.entries(entries)) {
      await writeResource(token, type, name, content);
    }
  }
  console.log("[sync] 完成。设备将在下次 Manifest 拉取时生效。");
}

main().catch((e) => {
  console.error("[sync] 失败:", e.message);
  process.exit(1);
});
