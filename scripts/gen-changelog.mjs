#!/usr/bin/env node
/**
 * 官网更新日志生成（需求：展示版本更新历史；以发布归档为准，只追加、不覆写）。
 *
 * 数据来源：
 *   - ota.json（发布归档唯一真源，--ota 指定，默认 ../Stelarith-cloud-ws/ota.json）：拿 current 版本与发布说明。
 *   - content/changelog.json（现有历史，绝不删除其中任何条目）。
 *
 * 行为：
 *   - 若 ota.json 的 current 版本已在 changelog.json 中存在 → 不重复追加，仅提示。
 *   - 否则在最前插入一条新记录（version/date/title/highlight/items 取自 ota.json 的 notes）。
 *   - 输出回写 content/changelog.json（默认 dry-run，加 --apply 才写）。
 *
 * 用法：
 *   node scripts/gen-changelog.mjs
 *   node scripts/gen-changelog.mjs --apply
 *   node scripts/gen-changelog.mjs --ota ../Stelarith-cloud-ws/ota.json --apply
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");
const otaArg = (() => {
  const i = process.argv.indexOf("--ota");
  return i >= 0 ? process.argv[i + 1] : path.resolve(ROOT, "..", "..", "Stelarith-cloud-ws", "ota.json");
})();
const CHANGELOG = path.join(ROOT, "content", "changelog.json");

function load(j) {
  try { return JSON.parse(fs.readFileSync(j, "utf8")); } catch (e) { return null; }
}

const ota = load(otaArg);
const products = ota && ota.products ? ota.products : {};
const viewer = products.viewer || {};
const agent = products.agent || {};
// ota.json 真源结构：products.{viewer,agent}.version / .notes（notes 是字符串）。
// 早期骨架假设顶层 ota.current / ota.notes，这里两路都兼容。
const cur = viewer.version || agent.version || (ota && ota.current);
if (!cur) { console.error(`读不到 ota.json 的当前版本（${otaArg}）。先发版再跑本脚本。`); process.exit(1); }
const rawNotes = viewer.notes || agent.notes || (ota && ota.notes) || {};
let title, highlight, items;
if (typeof rawNotes === "string") {
  // 真实 ota.json 的 notes 是一段人话说明
  title = `星集控 ${cur}`;
  highlight = rawNotes;
  items = [{ kind: "feat", text: rawNotes }];
} else {
  title = rawNotes.title || `星集控 ${cur}`;
  highlight = rawNotes.highlight || (rawNotes.items && rawNotes.items.length ? rawNotes.items[0] : "");
  items = (rawNotes.items || []).map((t) =>
    typeof t === "string" ? { kind: "feat", text: t } : t
  );
}

let log = load(CHANGELOG) || [];
if (!Array.isArray(log)) log = [];
if (log.some((e) => e.version === cur)) {
  console.log(`版本 ${cur} 已存在于 changelog.json，跳过追加（历史不被覆写）。`);
  process.exit(0);
}

const entry = {
  version: cur,
  date: new Date().toISOString().slice(0, 10),
  title,
  highlight,
  published: true,
  items,
};
log.unshift(entry); // 插到最前（最新在上）

const out = JSON.stringify(log, null, 2) + "\n";
if (!APPLY) {
  console.log(`[dry] 将向 content/changelog.json 顶部追加版本 ${cur}（共 ${log.length} 条，历史完整保留）。加 --apply 写入。`);
  process.exit(0);
}
fs.writeFileSync(CHANGELOG, out, "utf8");
console.log(`已写入 content/changelog.json：新增版本 ${cur}，现共 ${log.length} 条。历史条目未删除。`);
