/**
 * 集控面板「身份适配」一致性检查（只读，不改任何东西）
 *
 * 为什么需要它：身份适配把「谁能看到哪个入口」拆成了三处 ——
 *   ① index.html 的 `data-view` / `data-need`（真实导航）
 *   ② app.js 的 `ROLE_PRIMARY`（身份默认清单）
 *   ③ src/lib/permissions.ts 的 `ROLE_DEVICE`（能力底线）
 * 三处任何一处写错，症状都是**静默的**：某个入口凭空消失，或者压根没生效。
 * 屏幕上看不出来，只有在特定账号登录时才暴露。所以用脚本把它们对一遍。
 *
 * 检查项：
 *   A. ROLE_PRIMARY 里引用的视图 id 必须真实存在于导航（防拼写漂移）
 *   B. 网站能产生的每个 role 都要在 ROLE_IDENTITY / ROLE_PRIMARY 里有着落
 *   C. VIEW_NEED 必须覆盖导航里的每一个视图（防"新加了页却没有权限档"）
 *   D. 每个角色的最终结果打印出来，供人一眼核对是否符合预期
 *
 * 用法：node _probe/console-identity-check.mjs
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(resolve(root, "static/console/app.js"), "utf8");
const html = readFileSync(resolve(root, "static/console/index.html"), "utf8");
const perms = readFileSync(resolve(root, "src/lib/permissions.ts"), "utf8");

/** 从 `const NAME = {` 起做花括号配对，取出对象字面量源码并求值。 */
function extractObject(source, name) {
  const anchor = source.indexOf(`const ${name} = {`);
  if (anchor < 0) throw new Error(`未找到 const ${name}`);
  const open = source.indexOf("{", anchor);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return eval(`(${source.slice(open, i + 1)})`);
    }
  }
  throw new Error(`${name} 花括号不配对`);
}

/** 从 permissions.ts 里取 ROLE_DEVICE / ROLE_TITLES 这类 `const NAME: Record<...> = { ... };` */
function extractTsObject(source, name) {
  const anchor = source.indexOf(`const ${name}`);
  if (anchor < 0) throw new Error(`未找到 const ${name}`);
  const open = source.indexOf("{", anchor);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        // TS 里数组用 []，对象用 {}，值全是字符串字面量与标识符，可直接求值
        return eval(`(${source.slice(open, i + 1)})`);
      }
    }
  }
  throw new Error(`${name} 花括号不配对`);
}

const ROLE_IDENTITY = extractObject(app, "ROLE_IDENTITY");
const ROLE_PRIMARY = extractObject(app, "ROLE_PRIMARY");
const VIEW_NEED = extractObject(app, "VIEW_NEED");

const ROLE_DEVICE = extractTsObject(perms, "ROLE_DEVICE");
const ROLE_TITLES = extractTsObject(perms, "ROLE_TITLES");

// ---- 真实导航（index.html 是唯一事实来源）----
const navViews = [];
const navNeed = {};
for (const m of html.matchAll(/data-view="([A-Za-z0-9_-]+)"(?:[^>]*?data-need="([a-z]+)")?/g)) {
  navViews.push(m[1]);
  navNeed[m[1]] = m[2] || null;
}

// ---- 能力解算（与 permissions.ts 同源，不再自己编一套）----
const DEVICE_RANK = { watch: 0, control: 1, remote: 2, manage: 3 };
function canDevice(role, tier) {
  const tiers = ROLE_DEVICE[role] || [];
  return tiers.some((t) => DEVICE_RANK[t] >= DEVICE_RANK[tier]);
}
function hasIssue(role) {
  const titles = ROLE_TITLES[role] || [];
  return titles.includes("participant");
}
function hasBroadcast(role) {
  // 与 +page.server.ts 的 broadcast 位同源：sendBroadcast 称号（内容轴）或 control 设备档任一。
  const titles = ROLE_TITLES[role] || [];
  return titles.includes("broadcaster") || canDevice(role, "control");
}
function permOf(role) {
  return {
    control: canDevice(role, "control"),
    remote: canDevice(role, "remote"),
    manage: canDevice(role, "manage"),
    issue: hasIssue(role),
    broadcast: hasBroadcast(role),
  };
}
/** 与面板 allow() 等价：内嵌态下没有该权限位就不放行。 */
function allow(role, need) {
  if (!need) return true;
  return !!permOf(role)[need];
}

const errors = [];

// ---- A. ROLE_PRIMARY 引用的视图必须真实存在 ----
for (const [role, list] of Object.entries(ROLE_PRIMARY)) {
  if (!list) continue;
  for (const v of list) {
    if (!navViews.includes(v)) errors.push(`A: ROLE_PRIMARY.${role} 引用了不存在的视图「${v}」`);
  }
}

// ---- B. 网站能产生的每个 role 都要有着落 ----
const siteRoles = Object.keys(ROLE_DEVICE);
for (const r of siteRoles) {
  if (!ROLE_IDENTITY[r]) errors.push(`B: 角色「${r}」在 ROLE_IDENTITY 里没有身份定义`);
  if (!(r in ROLE_PRIMARY)) errors.push(`B: 角色「${r}」在 ROLE_PRIMARY 里没有着落（会退回全量）`);
}
for (const r of Object.keys(ROLE_IDENTITY)) {
  if (!siteRoles.includes(r)) errors.push(`B: ROLE_IDENTITY 里的「${r}」不是网站会产生的角色`);
}

// ---- C. VIEW_NEED 覆盖全部导航 ----
for (const v of navViews) {
  if (!(v in VIEW_NEED)) errors.push(`C: 导航项「${v}」不在 VIEW_NEED 里（视图级门控会失效）`);
}

// ---- D. 逐角色打印最终结果 ----
console.log(`导航视图（${navViews.length}）：${navViews.join(", ")}\n`);
for (const role of siteRoles) {
  const ident = ROLE_IDENTITY[role] || {};
  const want = ROLE_PRIMARY[role];
  const wantSet = want ? new Set(want) : null;
  const allowed = navViews.filter((v) => allow(role, navNeed[v]));
  const primary = wantSet ? allowed.filter((v) => wantSet.has(v)) : allowed;
  const extra = wantSet ? allowed.filter((v) => !wantSet.has(v)) : [];
  const blocked = navViews.filter((v) => !allowed.includes(v));
  console.log(
    `${role.padEnd(10)} ${String(ident.panel || "?").padEnd(14)}` +
      `默认[${primary.join(",") || "-"}]  更多[${extra.join(",") || "-"}]  无权限[${blocked.join(",") || "-"}]`
  );
  if (wantSet && primary.length === 0) {
    errors.push(`D: 角色「${role}」的默认清单与能力清单交集为空 → 侧栏会退回全量`);
  }
}

console.log("");
if (errors.length) {
  console.log(`✗ 发现 ${errors.length} 个问题：`);
  for (const e of errors) console.log("  " + e);
  process.exit(1);
}
console.log("✓ 身份适配三处（导航 / 身份清单 / 能力轴）一致。");
