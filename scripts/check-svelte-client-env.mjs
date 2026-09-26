#!/usr/bin/env node
/**
 * 门禁：`.svelte` 里禁止出现 `process.env`。
 *
 * ── 为什么（2026-09-26 实测，证据在构建产物里）──────────────────────────────
 * SvelteKit 会在**客户端产物**中把 `process.env` 替换成空对象字面量 `({})`。
 * 于是 `process.env.FOO` 在浏览器里恒为 `undefined`。
 *
 * 关键危害在于它**不报错、不告警、不中断构建** —— 类型检查也抓不到：
 *
 *   源码：{#if !process.env.PUBLIC_SITE_URL} <span>未配置…</span> {/if}
 *   产物：a(He, e => { ({}).PUBLIC_SITE_URL || e(Ue) })
 *
 * 后果有两个，都不轻：
 *   ① **hydration 不一致**：服务端有该变量 → 不渲染；客户端恒 undefined → 渲染。
 *   ② **提示与事实相反**：生产明明配了，页面却告诉你「未配置」。
 *      运维照此排查会走进死胡同 —— 这种「静默说谎」比直接报错昂贵得多。
 *
 * ── 正确做法 ──────────────────────────────────────────────────────────────
 * 让 `+page.server.ts` 的 `load` 把**结论**算好，页面只读 `data.*`。
 * 该线上的真实修复就是这么做的，顺带把一个错误判据也改对了
 * （原判据只看 PUBLIC_SITE_URL，但 ORIGIN 在生产由启动器显式设置，两者都没配才该告警）。
 *
 * ── 为什么扫源码而不是扫产物 ──────────────────────────────────────────────
 * 扫产物必须在构建之后，且要认得替换后的形态（`({}).X`），脆且晚；
 * 扫源码在 CI 就能拦住，代价近乎为零。
 *
 * ── 例外：没有 ────────────────────────────────────────────────────────────
 * 若确实需要在页面拿到某个「看似环境变量」的开关，正确做法是 server load 传下来。
 * 一旦开口子允许例外，例外就会变成常规做法。
 *
 * 用法：node scripts/check-svelte-client-env.mjs
 * 退出码：0 通过 / 1 发现违规
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

/** 注释行不算 —— 文档里提到 `process.env` 是说明，不是违规。 */
const COMMENT_RE = /^\s*(\/\/|\/\*|\*|<!--)/;

/** 匹配 `process.env`，容忍 `process . env` 这种空格写法。 */
const HIT_RE = /process\s*\.\s*env/;

function walk(dir, out = []) {
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const e of entries) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) {
			if (e.name === "node_modules" || e.name.startsWith(".")) continue;
			walk(full, out);
		} else if (e.name.endsWith(".svelte")) {
			out.push(full);
		}
	}
	return out;
}

const files = walk(SRC);
const hits = [];

for (const file of files) {
	let text;
	try {
		text = fs.readFileSync(file, "utf8");
	} catch {
		continue;
	}
	text.split(/\r?\n/).forEach((line, idx) => {
		if (COMMENT_RE.test(line)) return;
		if (HIT_RE.test(line)) {
			hits.push({ file: path.relative(ROOT, file).replace(/\\/g, "/"), line: idx + 1, text: line.trim() });
		}
	});
}

if (hits.length === 0) {
	console.log(`✅ .svelte 客户端边界检查通过（扫描 ${files.length} 个文件，未发现 process.env 访问）`);
	process.exit(0);
}

console.error(`❌ 发现 ${hits.length} 处在 .svelte 里访问 process.env：\n`);
for (const h of hits) {
	console.error(`  ${h.file}:${h.line}`);
	console.error(`      ${h.text}\n`);
}
console.error(
	[
		"这些访问在浏览器里恒为 undefined ——",
		"SvelteKit 会把客户端产物中的 process.env 替换成空对象字面量 ({})，",
		"不报错、不告警，只让 SSR 与 hydration 结果不一致，并渲染出与事实相反的提示。",
		"",
		"改法：把结论放到 +page.server.ts 的 load 里算，页面只读 data.*。",
		""
	].join("\n")
);
process.exit(1);
