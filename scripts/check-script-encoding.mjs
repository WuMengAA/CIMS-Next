#!/usr/bin/env node
/**
 * 门禁：Windows 启动器脚本的编码硬规矩。
 *
 * 每条规则都对应一次真实事故，不是风格洁癖：
 *
 *  1) .ps1 含非 ASCII（本项目脚本注释与 Write-Output 普遍是中文）
 *     → **必须**以 UTF-8 BOM（EF BB BF）开头。
 *     Windows PowerShell 5.1 读取无 BOM 的文件时按 ANSI（本机 CP936）解码：
 *       · 轻则中文输出乱码；
 *       · 重则中文字节被误解码成控制字符/引号，**解析期直接失败**，
 *         计划任务里的表现是 LastTaskResult=4294967295 且日志零行 —— 极难定位。
 *     （Node 写的 .mjs 不受此影响，故本仓库大量运维脚本用 .mjs 正是为了绕开它。）
 *
 *  2) .bat / .cmd 必须**纯 ASCII**。
 *     批处理没有声明编码的手段，cmd 一律按当前 OEM 代码页读取；
 *     非 ASCII 在 GBK/UTF-8 之间漂移必然导致乱码或误解析。
 *     需要中文注释/输出请写成 .ps1（并遵守规则 1）。
 *
 * 关于行尾（CRLF）为何**不在**本门禁内：
 *   本仓库 core.autocrlf=true，git 在索引侧把 CRLF 归一化为 LF 存储、
 *   检出时再按平台还原。因此仓库里"存 LF"并非缺陷，任何 CRLF 检查在 CI(Linux)
 *   上都会误报。要固化行尾需先加 .gitattributes（`*.bat text eol=crlf`），
 *   那属于独立改动，未纳入本门禁。
 *
 * 用法：node scripts/check-script-encoding.mjs
 * 退出码：0 = 全部合规；1 = 存在违规
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 整目录跳过：依赖、git 内部、构建产物、上传物 */
const SKIP_DIRS = new Set([
	'node_modules',
	'.git',
	'.svelte-kit',
	'.pnpm-store',
	'.cache',
	'build',
	'dist',
	'out',
	'uploads',
	'vendor'
]);
/** 前缀跳过：历史构建快照等一次性产物 */
const SKIP_PREFIX = ['build_prev_', '_build-stale', '.vercel', '.netlify'];

const BOM = [0xef, 0xbb, 0xbf];
const hasBom = (b) => b.length >= 3 && b[0] === BOM[0] && b[1] === BOM[1] && b[2] === BOM[2];
const isAscii = (b) => {
	for (let i = 0; i < b.length; i++) if (b[i] > 0x7f) return false;
	return true;
};
const nonAsciiLines = (b) => {
	const text = b.toString('utf8');
	const out = [];
	text.split(/\r?\n/).forEach((l, i) => {
		if (/[^\x00-\x7f]/.test(l)) out.push({ n: i + 1, t: l.trim().slice(0, 70) });
	});
	return out;
};

const problems = [];
const stats = { scanned: 0, ps1: 0, ps1Bom: 0, ps1Ascii: 0, bat: 0 };

function rel(p) {
	return path.relative(ROOT, p).replace(/\\/g, '/');
}

function walk(dir) {
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const e of entries) {
		if (e.isDirectory()) {
			if (SKIP_DIRS.has(e.name) || SKIP_PREFIX.some((p) => e.name.startsWith(p))) continue;
			walk(path.join(dir, e.name));
			continue;
		}
		const ext = path.extname(e.name).toLowerCase();
		if (ext !== '.ps1' && ext !== '.bat' && ext !== '.cmd') continue;
		const full = path.join(dir, e.name);
		const b = fs.readFileSync(full);
		stats.scanned++;

		if (ext === '.ps1') {
			stats.ps1++;
			if (!isAscii(b)) {
				if (hasBom(b)) stats.ps1Bom++;
				else {
					problems.push({
						file: rel(full),
						rule: '.ps1 含非 ASCII 但无 UTF-8 BOM',
						why: 'PS5.1 会按 ANSI 解码 → 乱码，严重时解析期崩（计划任务 LastTaskResult=4294967295、日志零行）',
						detail: nonAsciiLines(b)
							.slice(0, 3)
							.map((x) => `第 ${x.n} 行: ${x.t}`)
					});
				}
			} else stats.ps1Ascii++;
		} else {
			stats.bat++;
			if (!isAscii(b)) {
				problems.push({
					file: rel(full),
					rule: '.bat/.cmd 含非 ASCII',
					why: '批处理无编码声明、按 OEM 代码页读取，非 ASCII 必然在不同 locale 下漂移',
					detail: nonAsciiLines(b)
						.slice(0, 3)
						.map((x) => `第 ${x.n} 行: ${x.t}`)
				});
			}
		}
	}
}

walk(ROOT);

const hr = '─'.repeat(64);
if (problems.length === 0) {
	console.log('✅ 脚本编码门禁通过');
	console.log(hr);
	console.log(
		`扫描 ${stats.scanned} 个脚本：.ps1 ${stats.ps1} 个（含非ASCII且有BOM ${stats.ps1Bom}、纯ASCII ${stats.ps1Ascii}）、.bat/.cmd ${stats.bat} 个`
	);
	console.log('规则：.ps1 含非 ASCII ⟹ 必须 UTF-8 BOM；.bat/.cmd ⟹ 必须纯 ASCII');
	process.exit(0);
}

console.error(`❌ 脚本编码门禁未通过：${problems.length} 个文件违规`);
console.error(hr);
for (const p of problems) {
	console.error(`\n  ${p.file}`);
	console.error(`    规则: ${p.rule}`);
	console.error(`    原因: ${p.why}`);
	for (const d of p.detail) console.error(`    位置: ${d}`);
	if (p.rule.startsWith('.ps1')) {
		console.error('    修法: 给文件补 UTF-8 BOM ——');
		console.error(
			`      node -e "const f=require('fs'),p='${p.file}';const s=f.readFileSync(p,'utf8');if(s.charCodeAt(0)!==0xfeff)f.writeFileSync(p,'\\uFEFF'+s,'utf8')"`
		);
		console.error('      （或用编辑器「另存为 UTF-8 with BOM」；VS Code 右下角编码处选择 "UTF-8 with BOM"）');
	} else {
		console.error('    修法: 批处理内改用 ASCII 注释与输出；需要中文请改写为 .ps1（并补 UTF-8 BOM）');
	}
}
console.error(`\n${hr}`);
console.error(`扫描 ${stats.scanned} 个脚本，其中 ${problems.length} 个违规。`);
process.exit(1);
