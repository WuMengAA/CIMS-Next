#!/usr/bin/env node
/**
 * 星集控面板 · 静态文件同步器
 * ----------------------------------------------------------------------------
 * 把 `static/console/` 的真源码同步到 `build/client/console/`，并**重建**预压缩旁文件。
 *
 * 为什么必须有这个脚本（踩过的坑，写进 skill）：
 *   1. SvelteKit adapter-node 用 `sirv(dir, { gzip: true, brotli: true })` 服务 static。
 *      sirv 会把 `Accept-Encoding` 里的 gzip/br 变成**候选后缀**，且放在**原文件名之前**
 *      → 只要 `app.js.gz` 存在，浏览器（一定发 gzip/br）拿到的就是它。
 *      旁文件若过期，改了 app.js 也**永远看不到效果**。
 *   2. sirv 的 FILES 表（含 size/mtime/ETag）是**服务启动时**用 totalist 扫一次建好的。
 *      之后磁盘文件变长 → `Content-Length` 仍是旧值 → 响应被**静默截断**
 *      （实测：磁盘 96647 字节的文件，客户端只收到 95463 字节，md5 恰好等于前 95463 字节）。
 *      → 所以改完**必须重启网站**，否则拿到的可能是"半截 JS"，面板直接炸。
 *
 * 用法：
 *   node D:/Stelarith/_tools/sync-console.mjs            # 同步 + 重建旁文件
 *   node D:/Stelarith/_tools/sync-console.mjs --check    # 只报告差异不写盘；有问题时退出码 1（可作收尾闸）
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";

// SRC/DST 可用环境变量覆盖 —— 这是为了让 CI 能把本脚本跑进**临时目录**来验证它的
// 遍历完整性（见 scripts/check-console-assets.mjs），而**不必**碰生产正在服务的 build 目录。
// 不设变量时行为与原先完全一致。
const SRC = process.env.CONSOLE_SRC
  ? path.resolve(process.env.CONSOLE_SRC)
  : "D:/Stelarith/Stelarith-website/stelarith/static/console";
const DST = process.env.CONSOLE_DST
  ? path.resolve(process.env.CONSOLE_DST)
  : "D:/Stelarith/Stelarith-website/stelarith/build/client/console";
const CHECK_ONLY = process.argv.includes("--check");

// 只处理真源码文件；忽略备份与已生成的旁文件（旁文件由本脚本产出）。
// ⚠️ 2026-09-20：必须包含 .mjs —— P2P 连接器的协议常量是 protocol.mjs
//    （信令边车与浏览器连接器共用的单一事实源）。此前正则只有 (js|css|html)，
//    protocol.mjs 会**静默漏同步**：真源码在、build 里没有 → 浏览器 404 →
//    `remote-webrtc.js` 因拿不到 ./protocol.mjs 而整页加载失败。
// ⚠️ 2026-09-24：**必须递归子目录** —— 此前用 readdirSync(SRC)（不递归），
//    `vendor/qrcode.min.js` 会被**静默跳过**。该文件是老师页扫码的依赖
//    （src/lib/components/teacher-qr.svelte 动态加载 /console/vendor/qrcode.min.js）：
//      · 全新 build 时它根本不在 build/client/console/ → 老师页报「二维码库加载失败」；
//      · 它发生变更时 --check 恒报「已一致」→ 漂移永远查不出。
//    这与上一条是**同一形态**的 bug（"遍历范围 < 引用范围"），别再犯第三次。
// 过滤策略：**生成物拒绝列表**（2026-09-24 由"扩展名允许列表"改过来）。
//   本文件的遍历曾因**允许列表太窄**连踩两次**同一形态**的 bug（"遍历范围 < 引用范围"）：
//     · 2026-09-20：正则只有 (js|css|html) → `protocol.mjs` 静默漏同步
//                   → remote-webrtc.js 拿不到协议常量、整页加载失败；
//     · 2026-09-24：readdirSync 不递归 → `vendor/qrcode.min.js` 静默跳过
//                   → 老师页扫码报「二维码库加载失败」。
//   允许列表要求"每新增一种文件类型都要记得回来改这里" —— 靠记性的约束必然再犯第三次。
//   改为只排除**本脚本自己产出的旁文件**与编辑器备份/隐藏文件，其余一律同步。
//   安全性依据：`static/` 本来就是公开目录（SvelteKit 原样对外），
//   多同步一个文件不会比现状更暴露，而漏同步一个文件是**静默 404**。
const isGenerated = (rel) => /\.(br|gz)$/i.test(rel);
const isBackup = (rel) => {
  const base = path.basename(rel);
  return base.startsWith(".") || /\.bak-|\.(tmp|orig|rej|swp)$/i.test(base) || /~$/.test(base);
};

function walk(dir, base = dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
      out.push(...walk(abs, base));
    } else if (!isGenerated(ent.name) && !isBackup(ent.name)) {
      out.push(path.relative(base, abs).split(path.sep).join("/"));
    }
  }
  return out;
}
const PLAIN = walk(SRC).sort();

const md5 = (buf) => crypto.createHash("md5").update(buf).digest("hex");
const fmt = (n) => `${(n / 1024).toFixed(1)}KB`;

let copied = 0;
let same = 0;
let problems = 0;
const rows = [];

for (const name of PLAIN) {
  const s = path.join(SRC, name);
  const d = path.join(DST, name);
  const src = fs.readFileSync(s);
  const dstExists = fs.existsSync(d);
  const dst = dstExists ? fs.readFileSync(d) : null;

  const needCopy = !dst || md5(dst) !== md5(src);
  if (needCopy) {
    if (!CHECK_ONLY) {
      // 子目录（如 vendor/）在目标侧可能还不存在，先建出来
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.writeFileSync(d, src);
    }
    copied++;
  } else {
    same++;
  }

  // 旁文件：只要正文变了（或旁文件缺失/不是正文的压缩）就重建。
  // 这里直接全量重建 —— 反正只有 3~4 个文件，几百毫秒，换来的确定性远比省这点时间值。
  const gzPath = d + ".gz";
  const brPath = d + ".br";
  if (!CHECK_ONLY) {
    fs.writeFileSync(gzPath, zlib.gzipSync(src, { level: 9 }));
    fs.writeFileSync(brPath, zlib.brotliCompressSync(src));
  }

  // 自检：解压回来必须与正文逐字节相同，否则旁文件会静默喂坏数据给浏览器。
  // ⚠️ 2026-09-20 修正：此前只检查模式一律报 "-"，**恰恰看不见本工具存在意义所在的那个
  //    bug**（明文一致、但 .br/.gz 是旧内容 → 浏览器永远拿到旧页面）。现在只检查模式
  //    也会解压现存旁文件比对，缺失报「缺」。旁文件问题一律计入 problems 并以退出码 1 收尾。
  const probe = (p, decompress) => {
    if (!fs.existsSync(p)) return "缺";
    try { return md5(decompress(fs.readFileSync(p))) === md5(src) ? "✓" : "✗ 过期"; }
    catch { return "✗ 解压失败"; }
  };
  const gzOk = CHECK_ONLY
    ? probe(gzPath, zlib.gunzipSync)
    : (md5(zlib.gunzipSync(fs.readFileSync(gzPath))) === md5(src) ? "✓" : "✗ 解压不一致");
  const brOk = CHECK_ONLY
    ? probe(brPath, zlib.brotliDecompressSync)
    : (md5(zlib.brotliDecompressSync(fs.readFileSync(brPath))) === md5(src) ? "✓" : "✗ 解压不一致");
  if (gzOk !== "✓") problems++;
  if (brOk !== "✓") problems++;
  if (CHECK_ONLY && needCopy) problems++;

  rows.push({
    name,
    plain: `${fmt(src.length)}/${md5(src).slice(0, 8)}`,
    action: needCopy ? (CHECK_ONLY ? "待复制" : "已复制") : "已一致",
    gz: gzOk,
    br: brOk,
  });
}

console.log(`源: ${SRC}`);
console.log(`目标: ${DST}`);
console.log(CHECK_ONLY ? "模式: 只检查" : "模式: 写入");
console.table(rows);
console.log(
  CHECK_ONLY
    ? `待复制 ${copied} 个 / 已一致 ${same} 个 / 问题 ${problems} 项（未写盘）`
    : `已复制 ${copied} 个 / 未变 ${same} 个；旁文件已全部重建并通过解压自检`
);
if (CHECK_ONLY && problems > 0) {
  console.log(
    `\n✗ 检出 ${problems} 项问题（明文待复制 / 旁文件过期或缺失）。` +
      "\n  直接运行不带 --check 即可修复；改完 static/console 后必须重启 StelarithServer，否则响应会被截断。"
  );
  process.exitCode = 1; // 让 --check 能当 CI/收尾闸用
}
if (!CHECK_ONLY) {
  console.log(
    "\n⚠️ 下一步必须重启网站服务(计划任务 StelarithServer)：sirv 的 size/mtime/ETag 是启动时快照，\n" +
      "   不重启会出现『文件已更新但响应被截断 / 命中旧旁文件』。"
  );
}
