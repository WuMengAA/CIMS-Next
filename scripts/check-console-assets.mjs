#!/usr/bin/env node
/**
 * 门禁：面板静态资源的「引用范围 ⊆ 存在范围 ⊆ 同步范围」。
 *
 * 为什么需要它 —— 本仓库有**两次同形态**的真实事故，文件里还留着"别再犯第三次"的批注：
 *   · 2026-09-20：同步器用扩展名允许列表 (js|css|html) → `protocol.mjs` 静默漏同步
 *                 → `remote-webrtc.js` 拿不到 `./protocol.mjs`，整页加载失败；
 *   · 2026-09-24：同步器用不递归的 readdirSync → `vendor/qrcode.min.js` 静默跳过
 *                 → 老师页扫码报「二维码库加载失败」，且 `--check` 恒报"已一致"永远查不出。
 *   两次都是"**遍历范围 < 引用范围**"，共同点是**静默**：没有报错、没有日志，只有用户端 404。
 *   所以这里不靠"记得改过滤规则"，而是**每次把同步器真跑一遍**再核对集合。
 *
 * 检三件事：
 *   ① 引用 ⊆ 存在：`src/**` 与 `static/console/*.html` 里引用的 `/console/<path>`，
 *      在 `static/console/` 下必须真的存在（防拼错路径 → 404）；
 *   ② 存在 ⊆ 同步：把同步器 `ops-backup/tools/sync-console.mjs` 跑进**临时目录**，
 *      它产出的文件集合必须与 `static/console/` 的完整递归集合**逐项相等**
 *      （这一条正是上述两次事故的直接拦截器；跑临时目录，绝不碰生产在服务的 build 目录）；
 *   ③ 旁文件自检：上一步之后用 `--check` 复跑，确认 `.br/.gz` 解压回来与正文逐字节一致。
 *
 * 用法：node scripts/check-console-assets.mjs
 * 退出码：0 = 通过；1 = 有问题（或工具本身失败）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_REL = 'static/console';
const SRC = path.join(ROOT, SRC_REL);
const TOOL = path.resolve(
	process.env.CONSOLE_SYNC_TOOL || path.join(ROOT, 'ops-backup/tools/sync-console.mjs')
);

const hr = '─'.repeat(64);
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

/** 与同步器保持一致的排除口径：本脚本自己产出的旁文件 + 编辑器备份/隐藏文件 */
const isGenerated = (p) => /\.(br|gz)$/i.test(p);
const isBackup = (p) => {
	const b = path.basename(p);
	return b.startsWith('.') || /\.bak-|\.(tmp|orig|rej|swp)$/i.test(b) || /~$/.test(b);
};

function walkFiles(dir, base = dir) {
	const out = [];
	let ents;
	try {
		ents = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const e of ents) {
		const abs = path.join(dir, e.name);
		if (e.isDirectory()) out.push(...walkFiles(abs, base));
		else out.push(path.relative(base, abs).split(path.sep).join('/'));
	}
	return out;
}

const problems = [];

// ── ① 引用 ⊆ 存在 ────────────────────────────────────────────────────────────
// 只看两处真会发出请求的地方：面板自己的 HTML，与 src/ 下的组件/路由代码。
// （刻意不扫全仓库：ops-backup 的说明注释里就引用过 `/console/vendor/qrcode.min.js`，
//   那是文档不是请求，扫进来只会制造假阳性。）
const ATTR = /(?:src|href)\s*=\s*["']([^"']+)["']/g;
const refs = new Map(); // 解析后的仓库相对路径 -> 来源列表

const addRef = (raw, fromDir, origin) => {
	if (!raw) return;
	const p = raw.split('#')[0].split('?')[0].trim();
	if (!path.extname(p)) return; // 目录/纯锚点不当作资源
	// ⚠️ 站点绝对路径（`/console/x.js`）必须补上 `static/`：static/ 就是服务根。
	//    初版漏了这一步 → 剥掉前导 `/` 得到 `console/x.js`，与 `static/console/` 前缀不匹配
	//    → **被静默跳过**（`teacher-qr.svelte` 的 `/console/vendor/qrcode.min.js` 就是这么漏的）。
	//    发现方式：引用数只有 4，而独立已知至少 5 —— "结果过于整齐"永远是先怀疑工具的信号。
	const resolved = p.startsWith('/')
		? path.posix.normalize(path.posix.join('static', p.replace(/^\/+/, '')))
		: path.posix.normalize(path.posix.join(fromDir, p));
	if (!resolved.startsWith(SRC_REL + '/') && resolved !== SRC_REL) return; // 只管面板目录
	if (!refs.has(resolved)) refs.set(resolved, []);
	refs.get(resolved).push(origin);
};

// ①-a 面板 HTML
const htmlFiles = walkFiles(SRC).filter((f) => f.toLowerCase().endsWith('.html'));
for (const h of htmlFiles) {
	const htmlPath = path.join(SRC, h);
	// 剥掉 HTML 注释：约定说明里会写示例路径，不该当请求
	const html = fs.readFileSync(htmlPath, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
	const dir = path.posix.dirname(path.posix.join(SRC_REL, h));
	ATTR.lastIndex = 0;
	let m;
	while ((m = ATTR.exec(html))) addRef(m[1], dir, `${SRC_REL}/${h}`);
}

// ①-b src/ 下的代码（含字符串字面量里的绝对路径）
const CODE_EXT = /\.(svelte|ts|js|mjs|tsx|jsx)$/i;
const srcDir = path.join(ROOT, 'src');
for (const f of walkFiles(srcDir)) {
	if (!CODE_EXT.test(f)) continue;
	const text = fs.readFileSync(path.join(srcDir, f), 'utf8');
	for (const m of text.matchAll(/['"`](\/console\/[^'"`\s)]+)['"`]/g)) {
		addRef(m[1], '', `src/${f}`);
	}
}

for (const [ref, origins] of refs) {
	if (!fs.existsSync(path.join(ROOT, ref))) {
		problems.push({
			kind: '引用但不存在',
			detail: `${ref}\n      被引用于: ${[...new Set(origins)].join(', ')}`
		});
	}
}

// ── ② 存在 ⊆ 同步（把同步器真跑进临时目录）──────────────────────────────────
const want = walkFiles(SRC)
	.filter((f) => !isGenerated(f) && !isBackup(f))
	.sort();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'console-sync-'));
let got = [];
let toolLog = '';
try {
	const env = { ...process.env, CONSOLE_SRC: SRC, CONSOLE_DST: tmp };
	const run = (args) =>
		execFileSync(process.execPath, [TOOL, ...args], {
			cwd: ROOT,
			env,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe']
		});

	toolLog = run([]); // 写入模式 → 同步到临时目录并重建旁文件
	got = walkFiles(tmp)
		.filter((f) => !isGenerated(f) && !isBackup(f))
		.sort();

	// ── ③ 旁文件自检：--check 模式必须报 0 问题（否则 .br/.gz 与正文不一致）──
	run(['--check']);
} catch (e) {
	toolLog = (e.stdout || '') + (e.stderr || '');
	problems.push({
		kind: '同步器执行失败',
		detail: `${e.message}\n      ${toolLog.split('\n').slice(-6).join('\n      ')}`
	});
} finally {
	try {
		fs.rmSync(tmp, { recursive: true, force: true });
	} catch {
		/* 沙箱可能拦删除；临时目录残留无害 */
	}
}

const missing = want.filter((f) => !got.includes(f));
const extra = got.filter((f) => !want.includes(f));
for (const f of missing) {
	problems.push({
		kind: '存在但未被同步器纳入（用户端会 404）',
		detail: `${SRC_REL}/${f}\n      这正是"遍历范围 < 引用范围"的形态；检查 ops-backup/tools/sync-console.mjs 的过滤/递归逻辑`
	});
}
for (const f of extra) {
	problems.push({
		kind: '同步器产出了源目录中不存在的文件',
		detail: `临时目标里的 ${f}（源 ${SRC_REL} 下没有）`
	});
}

// ── 报告 ─────────────────────────────────────────────────────────────────────
if (problems.length === 0) {
	console.log('✅ 面板静态资源门禁通过');
	console.log(hr);
	console.log(`① 引用检查：${refs.size} 个被引用资源全部存在（来源：${htmlFiles.length} 个面板 HTML + src/ 代码）`);
	console.log(`② 同步完整性：${want.length} 个源文件，同步器产出 ${got.length} 个，逐项相等`);
	console.log('③ 旁文件自检：--check 复跑通过（.br/.gz 解压与正文逐字节一致）');
	console.log(`   清单：${want.join(', ')}`);
	process.exit(0);
}

console.error(`❌ 面板静态资源门禁未通过：${problems.length} 项`);
console.error(hr);
for (const p of problems) {
	console.error(`\n  【${p.kind}】`);
	console.error(`      ${p.detail}`);
}
console.error(`\n${hr}`);
console.error('背景：本仓库已因"遍历范围 < 引用范围"踩过两次同形态事故（protocol.mjs / qrcode.min.js），');
console.error('      两次都是**静默 404**——没有报错、没有日志，只有用户端白屏。');
console.error('      修完记得：同步 static/console 后**必须重启 StelarithServer**，');
console.error('      否则 sirv 会按启动时快照的 size 发送，响应被拦腰截断。');
process.exit(1);
