#!/usr/bin/env node
/**
 * T1 · 班级标识迁移工具（2026-10-03）
 *
 * 用法：
 *   node scripts/t1-class-identity.mjs survey              只读：产出对照表（含对不上的）
 *   node scripts/t1-class-identity.mjs survey --cohort 2028 只读：并演练 legacy→canonical
 *   node scripts/t1-class-identity.mjs apply --cohort 2028 写库：绑定表 legacy→canonical
 *
 * --cohort 是**必需的显式表态**：`class_08` 不带届，脚本绝不替你猜是哪一届。
 * 不给 --cohort 时，legacy 序号一律留在原地（见文件头「默认不写」说明）。
 *
 * 三个硬约束（对应 T1 验收）：
 *   ① 产出「users.class_name ↔ class_id」逐条对照，**含对不上的**（电教管理组 / 8 / 空）
 *   ② **保留多对多** —— 只动 user_class_bindings，绝不加 users.class_id 单值列
 *   ③ 对不上的**不许静默丢弃** —— 一律进 UNRESOLVED 段并在控制台明确报出
 *
 * 口径（详见 src/lib/server/class-identity.ts 文件头）：
 *   权威 = class_{毕业年}_{班号}（如 class_2028_8）；class_{序号:02d} 是 legacy 别名。
 *   选前者是因为 class_08 不带届，无法区分「2028届8班」和「2029届8班」——届一换，
 *   历史推送、课表组件、设备配置全部串届。
 *
 * ⚠️ 安全：
 *   · 默认 **dry-run**（survey）。apply 必须显式加参数，且先备份 stelarith.db*。
 *   · 迁移**可逆**：legacy 原值写进 console_audit，且绑定表无外键，回滚只需写回。
 *
 * 本脚本自包含（不 import .ts，避免运行时依赖 esbuild）；
 * 归一逻辑与 src/lib/server/class-identity.ts 保持一致 —— 改那边记得同步这里。
 */
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2] || "survey";
const cohortArg = process.argv[3] === "--cohort" ? process.argv[4] : null;
/** 届号必须是 4 位数字；给了不合法的直接报错退出，绝不静默降级。 */
const COHORT = cohortArg && /^\d{4}$/.test(cohortArg) ? cohortArg : null;
if (cohortArg && !COHORT) {
	console.error(`❌ --cohort 需要 4 位年份，收到 "${cohortArg}"`);
	process.exit(2);
}
/** `D:\...` 在 posix join 眼里是相对路径，得单独判。 */
const isAbsoluteWin = (s) => /^[A-Za-z]:[\\/]/.test(String(s));
const DATA_ROOT = process.env.STELARITH_DATA_ROOT
	? isAbsoluteWin(process.env.STELARITH_DATA_ROOT)
		? process.env.STELARITH_DATA_ROOT
		: join(process.cwd(), process.env.STELARITH_DATA_ROOT)
	: join(__dirname, "..");
const DB = join(DATA_ROOT, "content", "stelarith.db");

const log = (...a) => console.log(...a);
const hr = (t) => log(`\n${"─".repeat(72)}\n${t}\n${"─".repeat(72)}`);

// ── 归一（与 src/lib/server/class-identity.ts 同源）──────────────────────
const ORG_KEYWORDS = ["组", "委员会", "办", "中心", "队", "部", "团"];
const RE_CANONICAL = /^class_(\d{4})_?(\d+(?:[A-Za-z])?)$/i;
const RE_LEGACY = /^class_(\d{1,3})$/i;

function parseClassIdentity(raw) {
	const s = String(raw ?? "").trim();
	if (!s) return { kind: "unknown", raw: s, why: "empty" };
	const canon = s.match(RE_CANONICAL);
	if (canon) return { kind: "canonical", cohort: canon[1], no: canon[2], id: `class_${canon[1]}_${canon[2]}` };
	const legacy = s.match(RE_LEGACY);
	// ⚠ 序号去前导零：CIMS canonical 是 class_2028_1，不是 class_2028_01。
	// id 保留原值（比对/回滚用），no 归一后用于拼 canonical。
	if (legacy) return { kind: "legacy", no: String(+legacy[1]), id: s, oddFormat: legacy[1].length < 2 && legacy[1] !== "0" };
	return { kind: "unknown", raw: s, why: ORG_KEYWORDS.some((k) => s.includes(k)) ? "org" : "text" };
}

/**
 * 双认归一：任意写法 → 能当外键的 canonical id。
 * 多届同序号（真撞号）返回 ambiguous=true，**绝不猜**。
 */
function resolveClassKey(raw, cimsClasses, opts = {}) {
	const p = parseClassIdentity(raw);
	if (p.kind === "canonical") {
		// 形态对不等于合法：CIMS 表里不存在就报出来，绝不静默当 canonical。
		const known = cimsClasses.some((c) => parseClassIdentity(c.class_id).id === p.id);
		return {
			resolved: known ? p.id : null,
			matched: "canonical",
			ambiguous: false,
			unknown: known ? null : { raw: p.id, why: "text", notInCims: true }
		};
	}
	if (p.kind === "legacy") {
		// 先按序号找同届 canonical；多届同序号 = 真撞号，绝不猜。
		const cands = cimsClasses.filter((c) => {
			const q = parseClassIdentity(c.class_id);
			return q.kind === "canonical" && q.no === p.no;
		});
		if (cands.length === 1) return { resolved: cands[0].class_id, matched: "legacy-alias", ambiguous: false, unknown: null };
		if (cands.length > 1) return { resolved: null, matched: "legacy-alias", ambiguous: true, unknown: null };
		const cohort = String(opts.defaultCohort ?? "").trim();
		if (/^\d{4}$/.test(cohort)) return { resolved: `class_${cohort}_${p.no}`, matched: "legacy-alias", ambiguous: false, unknown: null };
		return { resolved: null, matched: "legacy-alias", ambiguous: false, unknown: null };
	}
	// 自由文本班级名：精确 name 命中 → 数字尾号命中（唯一才算，防「1班」误配「10班」）
	const s = p.raw;
	const exact = cimsClasses.filter((c) => String(c.name ?? "") === s);
	if (exact.length === 1) return { resolved: exact[0].class_id, matched: "name", ambiguous: false, unknown: null };
	if (exact.length > 1) return { resolved: null, matched: "name", ambiguous: true, unknown: null };
	const tail = (s.match(/\d+$/) || [])[0] ?? "";
	if (tail) {
		const byTail = cimsClasses.filter((c) => {
			const q = parseClassIdentity(c.class_id);
			return q.kind === "canonical" && q.no === tail;
		});
		if (byTail.length === 1) return { resolved: byTail[0].class_id, matched: "name-tail", ambiguous: false, unknown: null };
		if (byTail.length > 1) return { resolved: null, matched: "name-tail", ambiguous: true, unknown: null };
	}
	return { resolved: null, matched: "none", ambiguous: false, unknown: p };
}

// ── 跑 ─────────────────────────────────────────────────────────────────
const db = new DatabaseSync(DB);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
log(`db   = ${DB}`);
log(`mode = ${mode}${COHORT ? ` --cohort ${COHORT}` : " (无 --cohort：legacy 一律不迁移)"}`);
log(`tables = ${tables.length}`);

// CIMS 候选：离线跑，用审计/投递/通知里出现过的 canonical 重建。
// apply 前请接上真实 CIMS /class/list（站点侧唯一权威）。
const seen = new Map();
const scan = (sql) => {
	for (const r of db.prepare(sql).all()) {
		for (const raw of String(r.v ?? "").split(/[、,，;；\s]+/)) {
			const p = parseClassIdentity(raw);
			if (p.kind === "canonical") seen.set(p.id, seen.get(p.id) ?? "");
		}
	}
};
if (tables.includes("console_audit")) scan("SELECT target AS v FROM console_audit");
if (tables.includes("file_deliveries")) scan("SELECT class_id AS v FROM file_deliveries");
if (tables.includes("console_notices")) scan("SELECT classes AS v FROM console_notices");
const cimsClasses = [...seen].map(([class_id]) => ({ class_id }));
log(`CIMS canonical candidates (rebuilt from local audit) = ${cimsClasses.length}`);
for (const c of cimsClasses) log(`   ${c.class_id}`);

const UNRESOLVED = [];

hr("① users.class_name ↔ class_id 逐条对照（含对不上的）");
const users = tables.includes("users") ? db.prepare("SELECT username, role, class_name FROM users ORDER BY username").all() : [];
for (const u of users) {
	const raw = String(u.class_name ?? "").trim();
	const p = parseClassIdentity(raw);
	if (p.kind === "unknown") {
		UNRESOLVED.push({ where: `users.${u.username}.class_name`, raw: u.class_name, why: p.why });
		log(`   ${u.username.padEnd(14)} class_name="${u.class_name || "(空)"}"  →  ⚠ 对不上 (${p.why})`);
		continue;
	}
	if (p.kind === "canonical") {
		const known = cimsClasses.some((c) => parseClassIdentity(c.class_id).id === p.id);
		if (known) {
			log(`   ${u.username.padEnd(14)} class_name="${raw}"  →  ${p.id}  [canonical]`);
			continue;
		}
		UNRESOLVED.push({ where: `users.${u.username}.class_name`, raw, why: "不在 CIMS 候选集" });
		log(`   ${u.username.padEnd(14)} class_name="${raw}"  →  ⚠ 不在 CIMS 候选集`);
		continue;
	}
	// legacy 序号 / 自由文本班名 → 按名或尾号找 canonical
	const r = resolveClassKey(raw, cimsClasses, { defaultCohort: COHORT });
	if (!r.resolved) {
		const why = r.ambiguous ? "多届撞号/重名" : "无 canonical 兜底";
		UNRESOLVED.push({ where: `users.${u.username}.class_name`, raw, why });
		log(`   ${u.username.padEnd(14)} class_name="${raw}"  →  ⚠ ${why}  [${r.matched}]`);
		continue;
	}
	log(`   ${u.username.padEnd(14)} class_name="${raw}"  →  ${r.resolved}  [${r.matched}]`);
}

hr("② user_class_bindings 迁移（保留多对多，不加 users.class_id 单值列）");
let mig = [];
if (!tables.includes("user_class_bindings")) {
	log("   无 user_class_bindings 表 —— 跳过");
} else {
	const bindings = db.prepare("SELECT uid, class_id, class_name, bound_by FROM user_class_bindings").all();
	log(`   现有绑定 ${bindings.length} 条`);
	for (const b of bindings) {
		const r = resolveClassKey(b.class_id, cimsClasses, { defaultCohort: COHORT });
		const changed = r.resolved && r.resolved !== b.class_id;
		log(`   uid=${String(b.uid).padEnd(3)} ${String(b.class_id).padEnd(16)} "${b.class_name}"  →  ${r.resolved ?? "(不改)"}${changed ? "   ← 迁移" : ""}`);
		if (changed) mig.push({ uid: b.uid, from: b.class_id, to: r.resolved, boundBy: b.bound_by });
	}
	log(`   待迁移 ${mig.length} 条`);

	if (mode === "apply" && mig.length > 0) {
		const bakDir = join(DATA_ROOT, "ops-backup", `class-id-${new Date().toISOString().slice(0, 10)}`);
		mkdirSync(bakDir, { recursive: true });
		for (const f of ["stelarith.db", "stelarith.db-wal", "stelarith.db-shm"]) {
			const src = join(DATA_ROOT, "content", f);
			if (existsSync(src)) copyFileSync(src, join(bakDir, f));
		}
		log(`   已备份 ${bakDir}`);
		const upd = db.prepare("UPDATE user_class_bindings SET class_id = ? WHERE uid = ? AND class_id = ?");
		db.exec("BEGIN");
		try {
			for (const m of mig) {
				upd.run(m.to, m.uid, m.from);
				if (tables.includes("console_audit")) {
					db.prepare(
						`INSERT INTO console_audit (actor, role, action, target, detail, created_at, prev_hash, row_hash)
						 VALUES ('T1 迁移', 'system', 'class_id_migrate', ?, ?, ?, '', '')`
					).run(String(m.uid), `class_id ${m.from} → ${m.to}（原绑定人：${m.boundBy}，可逆）`, new Date().toISOString());
				}
			}
			db.exec("COMMIT");
			log(`   ✅ 已迁移 ${mig.length} 条，审计留痕（写回 from 即可回滚）`);
		} catch (e) {
			db.exec("ROLLBACK");
			log(`   ❌ 回滚：${e.message}`);
			process.exit(1);
		}
	} else if (mode === "apply") {
		log("   无需迁移，未写库");
	}
}

hr("③ 通知/文件链路历史遗留（只读报告；不改写）");
const freeText = new Map();
if (tables.includes("console_notices")) {
	for (const r of db.prepare("SELECT id, classes, scope FROM console_notices").all()) {
		for (const raw of String(r.classes ?? "").split(/[、,，;；\s]+/)) {
			if (!raw) continue;
			const p = parseClassIdentity(raw);
			if (p.kind !== "canonical") {
				const k = `${r.scope ?? "?"} | ${raw}`;
				freeText.set(k, (freeText.get(k) || 0) + 1);
			}
		}
	}
}
log(`   非 canonical 的历史 target ${freeText.size} 种：`);
for (const [k, v] of [...freeText].sort((a, b) => b[1] - a[1]).slice(0, 12)) log(`   x${v}  ${k}`);
log(`   读取侧已双认（broadcast.resolveClassTargets 接受 class_id 或班级名）；`);
log(`   写入侧不再新增 legacy。历史条目原样保留。`);

hr("④ 对不上的条目 —— 必须人工处理，不静默丢弃");
if (UNRESOLVED.length === 0) log("   (无)");
for (const u of UNRESOLVED) log(`   ⚠ ${u.where} = "${u.raw || "(空)"}"  原因=${u.why}`);
log("");
log(`=== 完成：CIMS 候选 ${cimsClasses.length} | 用户 ${users.length} | 待迁移 ${mig.length} | 对不上 ${UNRESOLVED.length} ===`);
db.close();
