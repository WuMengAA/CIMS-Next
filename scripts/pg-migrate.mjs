/**
 * pg-migrate.mjs —— 把「生产 SQLite（content/stelarith.db，只读快照）」的全部表数据，
 * 迁入 parity schema，用于与 PG 后端做数据 parity 验证。
 *
 * 安全约束：
 * - SQLite 以 readOnly:true 打开，绝不写入活生产库。
 * - 只写 parity schema，不碰 public（以及任何其它库）。
 * - 逐表 BEGIN/COMMIT，INSERT ... ON CONFLICT DO NOTHING（幂等，可重跑）。
 * - 为避免 FK 顺序问题：先捕获 parity 的全部外键约束并临时 DROP，灌完数据后用
 *   NOT VALID 重建（schema 仍忠实，未来写入受约束；存量孤儿不阻塞迁移）。
 * - 迁移后重置 identity 序列。
 *
 * 运行：node scripts/pg-migrate.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { Client } from "pg";

const SQLITE_PATH = "content/stelarith.db";
// 从环境变量或 .env 读取 DATABASE_URL（绝不硬编码口令，避免密钥入库）。
function loadDbUrl() {
	if (process.env.PG_URL) return process.env.PG_URL;
	if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
	const m = readFileSync(".env", "utf-8").match(/^DATABASE_URL=(.*)$/m);
	if (m) return m[1].trim().replace(/^["']|["']$/g, "");
	throw new Error("未找到 DATABASE_URL：请设置 PG_URL / DATABASE_URL，或在 .env 配置");
}
const PG_URL = loadDbUrl();
const NS = "parity";

const sq = new DatabaseSync(SQLITE_PATH, { readOnly: true });
const pg = new Client({ connectionString: PG_URL });
await pg.connect();
await pg.query(`SET search_path TO ${NS};`);

// ── 捕获并临时删除 parity 的外键约束（避免导入顺序问题） ──
const fkRows = await pg.query(
	`SELECT tc.constraint_name,
	        tc.table_name AS child,
	        kcu.column_name AS child_col,
	        ccu.table_name AS parent,
	        ccu.column_name AS parent_col
	 FROM information_schema.table_constraints tc
	 JOIN information_schema.key_column_usage kcu
	   ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
	 JOIN information_schema.referential_constraints rc
	   ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
	 JOIN information_schema.key_column_usage ccu
	   ON rc.unique_constraint_name = ccu.constraint_name
	      AND rc.unique_constraint_schema = ccu.table_schema
	      AND kcu.ordinal_position = ccu.ordinal_position
	 WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1
	 ORDER BY tc.table_name, kcu.ordinal_position`,
	[NS]
);
const fks = new Map();
for (const r of fkRows.rows) {
	if (!fks.has(r.constraint_name))
		fks.set(r.constraint_name, { child: r.child, parent: r.parent, childCols: [], parentCols: [] });
	const f = fks.get(r.constraint_name);
	f.childCols.push(r.child_col);
	f.parentCols.push(r.parent_col);
}
for (const [name, f] of fks) {
	await pg.query(`ALTER TABLE "${f.child}" DROP CONSTRAINT "${name}"`);
}
console.log(`[migrate] 已临时删除 ${fks.size} 个外键约束（导入后重建）。`);

// ── 逐表迁移 ──
const tables = sq
	.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
	.all()
	.map((r) => r.name);

function normalize(v) {
	if (v === null || v === undefined) return null;
	if (typeof v === "bigint") return Number(v);
	if (v instanceof Uint8Array) return Buffer.from(v);
	return v;
}

let totalRows = 0;
const report = [];
for (const t of tables) {
	const pgCols = await pg.query(
		`SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`,
		[NS, t]
	);
	const pgColSet = new Set(pgCols.rows.map((r) => r.column_name));
	const rows = sq.prepare(`SELECT * FROM "${t}"`).all();
	if (rows.length === 0) {
		report.push(`${t}\t0`);
		continue;
	}
	const cols = Object.keys(rows[0]).filter((c) => pgColSet.has(c));
	if (cols.length === 0) {
		console.warn(`  [warn] ${t}: SQLite 列与 PG 无交集，跳过`);
		report.push(`${t}\tSKIP(no-cols)`);
		continue;
	}
	const colList = cols.map((c) => `"${c}"`).join(", ");
	const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
	const insert = `INSERT INTO "${t}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
	await pg.query("BEGIN");
	let n = 0;
	for (const row of rows) {
		const vals = cols.map((c) => normalize(row[c]));
		await pg.query(insert, vals);
		n++;
	}
	await pg.query("COMMIT");
	totalRows += n;
	report.push(`${t}\t${n}`);
}

// ── 重建外键（NOT VALID：存量孤儿不阻塞，未来写入受约束） ──
let rebuilt = 0;
for (const [name, f] of fks) {
	const cc = f.childCols.map((c) => `"${c}"`).join(", ");
	const pc = f.parentCols.map((c) => `"${c}"`).join(", ");
	await pg.query(
		`ALTER TABLE "${f.child}" ADD CONSTRAINT "${name}" FOREIGN KEY (${cc}) REFERENCES "${f.parent}" (${pc}) NOT VALID`
	);
	rebuilt++;
}
console.log(`[migrate] 已重建 ${rebuilt} 个外键约束（NOT VALID）。`);

// ── 重置 identity 序列 ──
const identRes = await pg.query(
	`SELECT table_name FROM information_schema.columns WHERE table_schema=$1 AND column_default LIKE 'nextval%' GROUP BY table_name`,
	[NS]
);
for (const r of identRes.rows) {
	const tn = r.table_name;
	try {
		await pg.query(
			`SELECT setval(pg_get_serial_sequence('${NS}.${tn}', 'id'), COALESCE((SELECT MAX(id) FROM "${tn}"), 1))`
		);
	} catch {
		/* 无 id 列等情况忽略 */
	}
}

console.log("[migrate] 每表行数（SQLite→parity）：");
console.log(report.join("\n"));
console.log(`[migrate] 完成：${tables.length} 张表，共迁入 ${totalRows} 行到 ${NS}。`);
await pg.end();
sq.close();
