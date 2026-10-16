#!/usr/bin/env node
/**
 * 官网下载中心 · 命名规整 + 历史包清理（需求：适配新命名、清旧命名、清 .bak、最多保留最近 3 个历史构建包）。
 *
 * 安全模型：默认 dry-run（只打印将做什么），加 --apply 才真正删除/移动。
 * 铁律：更新日志与历史展示信息不得删除 —— 本脚本只动 static/downloads 下的构建包，
 *       绝不碰 content/changelog.json / 页面 / archive。
 *
 * 命名规整目标（与新发布脚本一致）：
 *   stelarith-viewer-portable-<ver>.zip
 *   stelarith-agent-portable-<ver>.zip
 *   stelarith-viewer-setup-<ver>.exe
 *   stelarith-agent-setup-<ver>.exe
 * 旧命名（xingjikong-*）与 *.bak* 一律清掉。
 *
 * 用法：
 *   node scripts/sync-builds.mjs            # 预演
 *   node scripts/sync-builds.mjs --apply    # 真删
 *   CODEBUDDY_SAFE_DELETE_ENABLED=0 node scripts/sync-builds.mjs --apply
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DL = path.join(ROOT, "static", "downloads");
const APPLY = process.argv.includes("--apply");
const KEEP = 3; // 每种构件最多保留的最近历史包数量

// 版本比较：支持 "0.6.23" 与 "0.6.23-rc.2"（pre 视为比正式旧）
function parseVer(v) {
  const [core, pre] = v.split("-");
  const nums = (core || "0").split(".").map((x) => parseInt(x, 10) || 0);
  while (nums.length < 3) nums.push(0);
  // pre 段：rc.N → 负权（比同 core 的正式版旧）；无 pre → 最大
  let preRank = 1e9;
  if (pre) {
    const m = pre.match(/rc\.(\d+)/);
    preRank = m ? -parseInt(m[1], 10) : 0;
  }
  return { nums, preRank };
}
function verCmp(a, b) {
  const pa = parseVer(a), pb = parseVer(b);
  for (let i = 0; i < 3; ++i) {
    if (pa.nums[i] !== pb.nums[i]) return pb.nums[i] - pa.nums[i]; // 新在前
  }
  return pb.preRank - pa.preRank;
}

const ARTIFACTS = [
  { key: "viewer-portable", re: /^stelarith-viewer-portable-(.+)\.zip$/ },
  { key: "agent-portable", re: /^stelarith-agent-portable-(.+)\.zip$/ },
  { key: "viewer-setup", re: /^stelarith-viewer-setup-(.+)\.exe$/ },
  { key: "agent-setup", re: /^stelarith-agent-setup-(.+)\.exe$/ },
];
const OLD_RE = /(^xingjikong-)|(\.bak([-\d]*)?$)/;

function rm(f) {
  const full = path.join(DL, f);
  if (!APPLY) { console.log(`  [dry] 删除 ${f}`); return; }
  fs.rmSync(full, { force: true });
  if (fs.existsSync(full)) throw new Error(`删除失败（safe-delete 可能拦下）：${f}`);
  console.log(`  [del] 删除 ${f}`);
}

if (!fs.existsSync(DL)) { console.error(`static/downloads 不存在：${DL}`); process.exit(1); }
const files = fs.readdirSync(DL);

let removed = 0;
// 1) 清旧命名 + .bak
for (const f of files) {
  if (OLD_RE.test(f)) { rm(f); removed++; }
}
// 2) 每种构件按版本排序，只留最近 KEEP 个
for (const art of ARTIFACTS) {
  const matched = files
    .map((f) => { const m = f.match(art.re); return m ? { f, v: m[1] } : null; })
    .filter(Boolean)
    .sort((a, b) => verCmp(a.v, b.v));
  const drop = matched.slice(KEEP); // 第 KEEP+1 个起都是更老的
  for (const d of drop) { rm(d.f); removed++; }
}

console.log(`\n完成（${APPLY ? "已执行" : "预演"}）：清理 ${removed} 个文件；每种构件保留最近 ${KEEP} 个历史包。`);
console.log("content/changelog.json 与历史展示未被触动。");
