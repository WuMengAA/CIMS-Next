#!/usr/bin/env node
/**
 * 门禁：集控面板静态资源的缓存戳（?v=）必须与资源改动**同一次提交**。
 *
 * 背景（2026-09-19 线上事故，约定原文写在 static/console/index.html 顶部注释里）：
 *   Cloudflare 对本域的 .js/.css 走默认边缘缓存（Cache-Control: max-age=14400）。
 *   不带查询串的 URL 会被缓存 4 小时 —— **代码改了、服务重启了，用户端仍是旧版**。
 *   实测带任意查询串的请求为 cf-cache-status: MISS（每次回源），故 query 是可靠的破缓存手段。
 *   所以：改动 static/console 下被 index.html 以 ?v= 引用的资源后，必须同步递增 v 值。
 *   （另有一条同样致命的坑：改完还必须重启 StelarithServer，adapter-node 的 sirv 会
 *     缓存文件 size，文件被替换后仍按旧长度发送 → HTML/JS 被拦腰截断、面板只剩线框。
 *     那条属于部署动作，CI 无法校验，只记在这里。）
 *
 * 本门禁检什么：在给定的提交范围内，凡"被 ?v= 引用的资源"发生改动，
 *   其 ?v= 取值就必须发生变化。反之（只改 v 值不改文件）无害，不报。
 *
 * 判定范围来自环境变量（由 CI 注入 push 的前后 sha）：
 *   V_BASE = 推送前的 sha（github.event.before）
 *   V_HEAD = 推送后的 sha（github.sha），本地可省略，默认 HEAD
 * 无法判定时（非 push 事件 / 新建分支 / 强推导致 base 不在本地历史）**跳过并告警**，
 *   不误判为红 —— 基础设施不可判定 ≠ 代码违规。
 *
 * 用法：node scripts/check-console-asset-version.mjs [base] [head]
 * 退出码：0 = 合规或跳过；1 = 存在违规
 */
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = 'static/console';

// execFileSync 传数组 → 不经 shell。**必须如此**：Windows 下 execSync 走 cmd.exe，
// 而 `^` 是 cmd 的转义符，形如 `git rev-parse <sha>^` 会被静默吃掉 `^` 从而取回自身，
// 导致"父提交 == 自身"、所有比较恒等的假结论。
const git = (...args) =>
	execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

const revExists = (rev) => {
	try {
		// stderr 静音：这是存在性探测，失败时 git 会打 "fatal: Not a valid object name"，
		// 内部消化即可，不该污染 CI 日志。
		execFileSync('git', ['cat-file', '-e', `${rev}^{commit}`], {
			cwd: ROOT,
			stdio: ['ignore', 'ignore', 'ignore']
		});
		return true;
	} catch {
		return false;
	}
};

const htmlFilesAt = (rev) => {
	try {
		return git('ls-tree', '-r', '--name-only', rev, '--', DIR)
			.split('\n')
			.map((s) => s.trim())
			.filter((f) => f.toLowerCase().endsWith('.html'));
	} catch {
		return [];
	}
};

const contentAt = (rev, p) => {
	try {
		return git('show', `${rev}:${p}`);
	} catch {
		return null;
	}
};

/** 去掉 HTML 注释：约定说明本身写在注释里，含 "?v=<版本>" 这类示例，不能当引用解析 */
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

const ATTR = /(?:src|href)\s*=\s*["']([^"']+)["']/g;

/**
 * 收集某版本下「被 ?v= 引用的资源」→ 该资源所用 token 集合
 * @returns {Map<string, Set<string>>} key = 仓库相对路径（如 static/console/app.js）
 */
function tokensAt(rev) {
	const map = new Map();
	for (const htmlPath of htmlFilesAt(rev)) {
		const raw = contentAt(rev, htmlPath);
		if (raw == null) continue;
		const html = stripComments(raw);
		const dir = path.posix.dirname(htmlPath);
		ATTR.lastIndex = 0;
		let m;
		while ((m = ATTR.exec(html))) {
			const url = m[1];
			const qi = url.indexOf('?v=');
			if (qi < 0) continue;
			const filePart = url.slice(0, qi);
			const token = url
				.slice(qi + 3)
				.split(/[&#]/)[0]
				.trim();
			if (!filePart || !token) continue;
			const resolved = filePart.startsWith('/')
				? filePart.replace(/^\/+/, '')
				: path.posix.normalize(path.posix.join(dir, filePart));
			if (!map.has(resolved)) map.set(resolved, new Set());
			map.get(resolved).add(token);
		}
	}
	return map;
}

const hr = '─'.repeat(64);
const skip = (why) => {
	console.log(`➖ 面板缓存戳门禁：跳过（${why}）`);
	console.log(hr);
	console.log('判定需要"推送前 → 推送后"两个 commit；范围不可得时不误判为违规。');
	process.exit(0);
};

const base = (process.argv[2] || process.env.V_BASE || '').trim();
const head = (process.argv[3] || process.env.V_HEAD || 'HEAD').trim();

if (!base) skip('未提供比对范围（非 push 事件，如 pull_request / workflow_dispatch）');
if (/^0+$/.test(base)) skip('推送前 sha 为全零（新建分支的首次推送）');
if (base === head) skip('前后 sha 相同');
if (!revExists(base)) skip(`比对起点 ${base.slice(0, 8)} 不在本地历史（强推或浅克隆）`);
if (!revExists(head)) skip(`比对终点 ${head.slice(0, 8)} 不在本地历史`);

const changed = git('diff', '--name-only', base, head)
	.split('\n')
	.map((s) => s.trim().replace(/\\/g, '/'))
	.filter(Boolean);

const before = tokensAt(base);
const after = tokensAt(head);
const versioned = new Set([...before.keys(), ...after.keys()]);
const versionedChanged = changed.filter((f) => versioned.has(f));

const label = [...new Set([...after.values()].flatMap((s) => [...s]))].join(', ');

if (versionedChanged.length === 0) {
	console.log('✅ 面板缓存戳门禁通过');
	console.log(hr);
	console.log(`本次范围 ${base.slice(0, 8)}..${head.slice(0, 8)} 共 ${changed.length} 个文件改动，`);
	console.log(`其中受 ?v= 约束的资源：0 个（当前 token：${label || '无'}）`);
	console.log(`受约束资源清单（${versioned.size} 个）：${[...versioned].join(', ') || '无'}`);
	process.exit(0);
}

const violations = [];
for (const f of versionedChanged) {
	const tb = before.get(f) || new Set();
	const th = after.get(f) || new Set();
	if (tb.size === 0 && th.size === 0) continue; // 约定未生效（该版本尚未带 ?v=）
	const same = tb.size === th.size && [...tb].every((x) => th.has(x));
	if (same) violations.push({ file: f, before: [...tb].join(',') || '(无)', after: [...th].join(',') || '(无)' });
}

if (violations.length === 0) {
	console.log('✅ 面板缓存戳门禁通过');
	console.log(hr);
	console.log(`受约束资源改动 ${versionedChanged.length} 个，token 均已同步变化：`);
	for (const f of versionedChanged) {
		const tb = [...(before.get(f) || [])].join(',') || '(无)';
		const th = [...(after.get(f) || [])].join(',') || '(无)';
		console.log(`  OK  ${f}   ${tb} -> ${th}`);
	}
	process.exit(0);
}

console.error(`❌ 面板缓存戳门禁未通过：${violations.length} 个资源改了但 ?v= 没变`);
console.error(hr);
for (const v of violations) {
	console.error(`\n  ${v.file}`);
	console.error(`    token: ${v.before} -> ${v.after}  （未变化）`);
}
console.error('\n  为什么必须改：Cloudflare 对本域 .js/.css 缓存 4 小时，token 不变得不到新文件，');
console.error('  用户端会一直加载旧版（2026-09-19 线上事故的根因）。');
console.error(`\n  修法：编辑 ${DIR}/index.html 顶部 <link>/<script> 的 ?v= 取值，`);
console.error('        与本次资源改动**同一次提交**推进（例如 20260924g -> 20260924h），');
console.error('        提交后记得重启 StelarithServer（sirv 会缓存文件 size，不重启会出现产物被截断）。');
console.error(`\n${hr}`);
process.exit(1);
