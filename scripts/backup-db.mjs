/**
 * Stelarith 站点备份 —— 一致性快照 → 加密 → 三方分发 → 校验 → GFS 轮转
 * ===========================================================================
 *
 *   node scripts/backup-db.mjs                 完整备份（生产用法）
 *   node scripts/backup-db.mjs --plan          只打印将要做什么，不落任何数据
 *   node scripts/backup-db.mjs --verify <f>    只校验一个密文能解出来且 SQLite 完整
 *   node scripts/backup-db.mjs --restore <f> --to <dir>   恢复演练（默认就写到临时目录）
 *
 * ── 为什么必须 VACUUM INTO，而不是 cp / cp -r ────────────────────────────────
 * 本站的库开着 WAL（`journal_mode=wal`）。WAL 的含义是：最近写入的页还在
 * `-wal` 文件里，`-shm` 是共享内存索引。此时 `cp stelarith.db other.db`
 * 拷到的是一张**残缺的图** —— 缺的恰恰是最近几分钟的事务。
 * 更糟的是 `cp` 拿到的是一个**内容完全不同的文件**：主库文件大小完全没变
 * （SQLite 空间复用），只靠 WAL 里的内容区分新旧。于是你会得到一个"看起来
 * 成功、大小正常、但打开就报 database disk image is malformed"的备份，
 * 而这件事只有在真正要恢复的那一刻才会暴露。
 *
 * `VACUUM INTO 'target'` 是 SQLite 内建的正确做法：它先把 WAL 检查点落盘，
 * 再导出一份**自洽的完整副本**。全程由 SQLite 自己完成，不碰文件字节。
 *
 * ── 备份哪些东西：本站数据是"分裂"的 ────────────────────────────────────────
 *   结构化数据  content/stelarith.db            （用户 / 会话 / 附件 / 动态 / 控制台 …）
 *   文件型数据  content/** 的 JSON 与 Markdown  （nav / changelog / projects / archive/posts …）
 *   上传件      uploads/**                      （媒体库与项目板附件）
 *
 * 只备其中一样，就会恢复出一个"有用户没内容"或"有内容没用户"的残站。
 * 所以三者都备。其中 uploads/ 极易被忘记 —— 它不在 content/ 之下，
 * 而是与 content/ 平级的顶层目录（见 paths.ts）。
 *
 * ── 为什么不把 content 也一起打进一个压缩包 ──────────────────────────────────
 * 打包更整洁，但引入了一种"十年后需要我写的解压器才能读"的格式。
 * 这里选择的做法是按**原样路径**逐件分发：
 *
 *     <prefix>/<ts>/db/<ts>.db.enc
 *     <prefix>/<ts>/content/<相对 content 的路径>
 *     <prefix>/<ts>/uploads/<相对 uploads 的路径>
 *
 * 好处：备份清单不是另写的清单，而是对象存储的键结构本身（`listObjects` 即可枚举）；
 * 恢复时不必"整包解开"，可以直接取回被误删的**那一个** JSON；
 * 少一层自造格式，就少一个未来解不开的单点。
 * 备份的**可恢复性 > 备份的整洁度**。
 *
 * ── 加密范围 ────────────────────────────────────────────────────────────────
 * 只有数据库加密。content 里的 JSON / Markdown 绝大多数是公开可读的站内内容，
 * 加密它们不增加安全性，只让"手工捞回一个文件"变得不可能。
 * 唯一真正不可再生、且含用户凭证哈希的东西是库本体。
 *
 * ── 三份如何算"异地" ────────────────────────────────────────────────────────
 *   份 1 本机  content/backups/local/<ts>/    防误删，不防机器坏
 *   份 2 R2   <R2_PREFIX>sqlite/<ts>/         跨服务商，防本机全毁
 *   份 3 B2   <B2_PREFIX>sqlite/<ts>/         真正的异地：独立账号、独立凭证
 *
 * 份 2 与份 3 由同一台机器发起，防不了"密钥泄漏导致云上备份被一并清掉"。
 * 所以份 3 必须是不同的服务商 + 不同的密钥。缺任一份都算**不完整备份** ——
 * 缺省行为是 exit 2 直接失败，而不是"能传几份传几份"。
 * （想临时跳过，显式设 `BACKUP_ALLOW_PARTIAL=1`，脚本会把它记进 latest.json，
 *   让"我今天其实只备份了 1 份"这件事留下书面证据。）
 *
 * ⚠️ BACKUP_KEY 丢了 = 所有数据库备份都解不开。请离线抄一份。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";

// ── 复用运行时的路径真相，绝不在这里另写一套 "content" / "uploads" ────────────
// 详见 scripts/ts-resolver.mjs：让本文件能直接 import 站内的 .ts 源码，
// 从而复用生产在用的 r2.ts，而不是在此写第二套 S3 签名。
import { register } from "node:module";
register("./ts-resolver.mjs", import.meta.url);

const { DATA_ROOT, CONTENT_DIR, UPLOADS_DIR, DB_FILE } = await import("../src/lib/server/paths.ts");
const { putObject, headObject, resetR2ConfigCache, r2Configured } = await import(
	"../src/lib/server/storage/r2.ts"
);

// ════════════════════════════════════════════════════════════════════════════
// 配置
// ════════════════════════════════════════════════════════════════════════════

const MAGIC = "STLBK1\n";
/** MAGIC 是 7 字节。任何按 8 字节去读头的比较都是 off-by-one（曾因此自验失败）。 */
const MAGIC_LEN = 7;
const PLAIN = "text/plain; charset=utf-8";

/** 备份集内的 Unix 秒时间戳解析结果。 */
function parseArgs(argv) {
	const a = { plan: false, verify: null, restore: null, to: null, pruneRemote: false, allowPartial: false, noEnv: false };
	for (let i = 0; i < argv.length; i++) {
		const k = argv[i];
		switch (k) {
			case "--plan": a.plan = true; break;
			case "--verify": a.verify = argv[++i]; break;
			case "--restore": a.restore = argv[++i]; break;
			case "--to": a.to = argv[++i]; break;
			case "--prune-remote": a.pruneRemote = true; break;
			case "--allow-partial": a.allowPartial = true; break;
			case "--no-env": a.noEnv = true; break;
			default:
				if (k.startsWith("-")) throw new Error("未知参数: " + k);
				if (!a.restore) a.restore = k;
				else if (!a.to) a.to = k;
		}
	}
	return a;
}

/** 加载 .env。优先复用 D:/Stelarith/loadenv.cjs（与生产启动同一个加载器，避免第二套解析）。 */
function loadEnv() {
	let dir = process.cwd();
	for (let i = 0; i < 4; i++) {
		const c = path.join(dir, "loadenv.cjs");
		if (fs.existsSync(c)) {
			try {
				createRequire(import.meta.url)(c);
				return true;
			} catch (e) {
				console.warn(`[env] 加载 ${c} 失败: ${e.message}`);
				return false;
			}
		}
		const up = path.dirname(dir);
		if (up === dir) break;
		dir = up;
	}
	return false;
}

function env(name, dflt = "") {
	const v = (process.env[name] ?? "").trim();
	return v || dflt;
}

// ⚠ 顺序即正确性：.env 必须在这批配置**求值之前**载入。
// 早先这里写的是 main() 内部 `loadEnv()`，而 CFG 在模块顶层求值 ——
// 于是 BACKUP_KEY / BACKUP_R2_PREFIX 一律读到空值，
// 并给出"未配置 BACKUP_KEY"这种看起来像没写配置、其实是加载顺序错了的误导性提示。
if (!process.argv.includes("--no-env")) loadEnv();

const CFG = {
	key: env("BACKUP_KEY"),
	keyFile: env("BACKUP_KEY_FILE"), // 备选：从文件读密钥（放密码管理器挂载点时用）
	prefix: env("BACKUP_R2_PREFIX", "backups/sqlite"),
	keepDaily: Number(env("BACKUP_KEEP_DAILY", "7")),
	keepWeekly: Number(env("BACKUP_KEEP_WEEKLY", "4")),
	keepMonthly: Number(env("BACKUP_KEEP_MONTHLY", "12")),
	localRoot: path.join(CONTENT_DIR, "backups", "local"),
};

/** 保留策略的默认值，允许命令行覆盖（便于演练）。 */
function gfsKeep() {
	return {
		daily: Number(env("BACKUP_KEEP_DAILY", "7")),
		weekly: Number(env("BACKUP_KEEP_WEEKLY", "4")),
		monthly: Number(env("BACKUP_KEEP_MONTHLY", "12")),
	};
}

// ── B2：与 R2 完全相同的 S3 协议，只是 endpoint 与凭证不同 ────────────────────
function b2Ready() {
	return Boolean(
		env("B2_ACCOUNT_ID") && env("B2_BUCKET") && env("B2_ACCESS_KEY_ID") && env("B2_SECRET_ACCESS_KEY")
	);
}
function b2Endpoint() {
	return env("B2_ENDPOINT", `https://s3.${env("B2_REGION", "us-west-001")}.backblazeb2.com`);
}
/** B2 上的备份根。不配 B2_PREFIX 就跟着 BACKUP_R2_PREFIX，落在同一个桶结构下的另一处。 */
function b2Base(ts) {
	return `${env("B2_PREFIX", CFG.prefix)}/sqlite/${ts}`;
}

/** 把 R2_* 临时替换成 B2_*，让 r2.ts 那份签名实现为 B2 服务，用完原样还原。 */
function withB2(fn) {
	if (!b2Ready()) return fn(true, "unconfigured");
	const orig = {
		R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
		R2_BUCKET: process.env.R2_BUCKET,
		R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
		R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
		R2_ENDPOINT: process.env.R2_ENDPOINT,
		R2_REGION: process.env.R2_REGION,
		R2_PUBLIC_URL: process.env.R2_PUBLIC_URL,
		R2_PREFIX: process.env.R2_PREFIX,
	};
	const set = (k, v) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
	try {
		set("R2_ACCOUNT_ID", env("B2_ACCOUNT_ID"));
		set("R2_BUCKET", env("B2_BUCKET"));
		set("R2_ACCESS_KEY_ID", env("B2_ACCESS_KEY_ID"));
		set("R2_SECRET_ACCESS_KEY", env("B2_SECRET_ACCESS_KEY"));
		set("R2_ENDPOINT", b2Endpoint());
		set("R2_REGION", env("B2_REGION", "us-west-001"));
		set("R2_PUBLIC_URL", env("B2_PUBLIC_URL", "")); // 备份不需要外链，留空避免 publicUrlForKey() 给出不可用的 URL
		set("R2_PREFIX", env("B2_PREFIX", CFG.prefix));
		resetR2ConfigCache();
		return fn(false, "b2");
	} finally {
		for (const k of Object.keys(orig)) set(k, orig[k]);
		resetR2ConfigCache();
	}
}

// ════════════════════════════════════════════════════════════════════════════
// 日志 / 输出
// ════════════════════════════════════════════════════════════════════════════

const t0 = Date.now();
const log = (...m) => console.log(...m);
const ok = (...m) => console.log("  \x1b[32m✓\x1b[0m", ...m);
const warn = (...m) => console.log("  \x1b[33m!\x1b[0m", ...m);
const bad = (...m) => console.log("  \x1b[31m✗\x1b[0m", ...m);
const fatal = (msg, code = 1) => {
	console.error(`\n\x1b[31m备份中止：${msg}\x1b[0m`);
	process.exit(code);
};

function hr(title) {
	log(`\n\x1b[1m── ${title}\x1b[0m`);
}

// ════════════════════════════════════════════════════════════════════════════
// 密钥
// ════════════════════════════════════════════════════════════════════════════

function resolveKey() {
	let raw = CFG.key;
	if (!raw && CFG.keyFile) {
		try {
			raw = fs.readFileSync(path.resolve(CFG.keyFile), "utf8").trim();
			ok(`已从 ${CFG.keyFile} 读入密钥`);
		} catch (e) {
			fatal(`BACKUP_KEY_FILE 读不出来: ${e.message}`);
		}
	}
	if (!raw) {
		fatal(
			"未配置 BACKUP_KEY（数据库备份的解密密钥）。\n" +
				"  生成：  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"\n" +
				"  写入：  工程根目录 .env 的 BACKUP_KEY=<上面那串>\n" +
				"  ⚠ 丢了它，所有历史备份都解不开。请离线抄一份，且不要和 R2/B2 的凭证放在一起。"
		);
	}
	// 容错：本站的 .env 加载器不会剥掉值两侧的引号（loadenv.cjs 的既有行为），
	// 所以 `BACKUP_KEY="…"` 会连引号一起解出来。引号不是 base64 合法字符，
	// Node 会默默忽略它们，于是"碰巧"能解出 32 字节 —— 这种碰巧不该被依赖。
	if (/^".*"$/.test(raw) || /^'.*'$/.test(raw)) {
		raw = raw.slice(1, -1).trim();
		warn("BACKUP_KEY 带引号，已自动剥离（.env 里的值不要加引号）");
	}
	const buf = Buffer.from(raw, "base64");
	if (buf.length !== 32) {
		fatal(
			`BACKUP_KEY 解出来是 ${buf.length} 字节，必须是 32 字节（AES-256）。\n` +
				"  当前值: " + raw.slice(0, 12) + "…\n" +
				"  正确生成：node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
		);
	}
	return buf;
}

// ════════════════════════════════════════════════════════════════════════════
// 加密容器：自描述头，便于十年后还原
//
//   "STLBK1\n" | metaLen:u32 | meta(json utf8) | iv:12 | ciphertext | tag:16
//
// meta 里存明文 sha256 与明文字节数，解密后可以**不依赖信任**地比对，
// 而不是"解密成功就算过"（GCM 校验过的是完整性，但拿不到"是不是原来那个文件"）。
// ════════════════════════════════════════════════════════════════════════════

function encryptBytes(plain, key, meta) {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
	const metaBuf = Buffer.from(
		JSON.stringify({
			alg: "aes-256-gcm",
			kdf: "direct",
			...meta,
			sha256: crypto.createHash("sha256").update(plain).digest("hex"),
			size: plain.length,
		}),
		"utf8"
	);
	const metaLen = Buffer.alloc(4);
	metaLen.writeUInt32BE(metaBuf.length);
	const head = Buffer.concat([Buffer.from(MAGIC, "ascii"), metaLen, metaBuf]);
	const body = Buffer.concat([head, iv, cipher.update(plain), cipher.final()]);
	return Buffer.concat([body, cipher.getAuthTag()]);
}

/** 解出 { meta, plain }；炸掉时抛出带原因的错误，由调用方决定这是"备份坏了"还是"密钥错了"。 */
function decryptBytes(buf, key) {
	if (buf.length < MAGIC_LEN || buf.subarray(0, MAGIC_LEN).toString("ascii") !== MAGIC) {
		throw new Error("不是本脚本生成的密文（文件头不是 " + MAGIC.trim() + "）");
	}
	// 容器布局（与 encryptBytes 严格对称）：
	//   0      magic 7B
	//   7      metaLen u32 4B
	//   11     meta json      ← 曾把它写成偏移 12（漏了 metaLen 的 4 字节，多读了 1 字节），
	//   11+metaLen  iv 12B      结果解密自验直接报 "non-whitespace after JSON"
	//   …      ciphertext
	//   -16    GCM tag 16B
	const META_OFF = MAGIC_LEN + 4;
	const metaLen = buf.readUInt32BE(MAGIC_LEN);
	const meta = JSON.parse(buf.subarray(META_OFF, META_OFF + metaLen).toString("utf8"));
	const iv = buf.subarray(META_OFF + metaLen, META_OFF + metaLen + 12);
	const tag = buf.subarray(buf.length - 16);
	const body = buf.subarray(META_OFF + metaLen + 12, buf.length - 16);
	try {
		const dec = crypto.createDecipheriv("aes-256-gcm", key, iv);
		dec.setAuthTag(tag);
		const plain = Buffer.concat([dec.update(body), dec.final()]);
		const got = crypto.createHash("sha256").update(plain).digest("hex");
		if (meta.sha256 && got !== meta.sha256) {
			throw new Error(`解密后内容与记录不匹配（期望 ${meta.sha256.slice(0, 12)}… 实得 ${got.slice(0, 12)}…）`);
		}
		return { meta, plain };
	} catch (e) {
		// 判断"这是密钥错还是密文错"本来该用 `e instanceof crypto.CryptoError`，
		// 但那个到处是不可信的（实测抛的是 TypeError:
		// Right-hand side of 'instanceof' is not an object，把真正的结论盖掉了 ——
		// 而"密钥错了 / 备份坏了"正是恢复现场最需要知道的那一句话）。
		const code = e && e.code;
		const looksCrypto =
			code === "ERR_CRYPTO_AUTH_FAILED" ||
			code === "ERR_CRYPTO_OPERATION_FAILED" ||
			/bad decrypt|unable to decrypt|unable to authenticate|wrong tag|invalid tag|auth tag/i.test(
				e && e.message ? String(e.message) : ""
			);
		if (looksCrypto) {
			throw new Error(
				`解不开。若密钥不对请核对 BACKUP_KEY（注意 .env 里的值不要加引号，见本脚本第 3 节）；` +
					`若密钥对得上却仍然失败，说明这份备份在存储端被破坏了或根本不是给这个密钥加密的 —— 这正是回读校验要抓的那种情况。\n` +
					`  原始错误：${e.message}`
			);
		}
		throw e;
	}
}

// ════════════════════════════════════════════════════════════════════════════
// 数据收集
// ════════════════════════════════════════════════════════════════════════════

/** content 里不需要备份的东西，以及它们的理由（写清楚，免得以后有人误删规则）。 */
const SKIP = [
	[/^content[\\/]stelarith\.db(-wal|-shm)?$/, "数据库本体，备份目标是它的 VACUUM 副本"],
	[/^content[\\/]backups[\\/]/, "备份自己，否则每次备份都会把上一次备份一起备份"],
	[/^content[\\/]cache[\\/]/, "可重生成的缓存"],
	[/^content[\\/]docs[\\/].*\.bak$/, "编辑器的 .bak 残留"],
];

function collectFiles() {
	const out = [];
	// ⚠ 顶层文件也必须带上前缀。早先 CONTENT_DIR 那一路传的是 ""，于是 content/ 下的
	// 顶层文件 rel 形如 "README.md"（不含 "content/"），SKIP 规则 `^content[/\\]…`
	// 全部失效 —— 结果是**每次备份都会把上一次备份再备份一遍**，文件数逐次递增，
	// 形如 95 → 96 → 99 → …，直到磁盘被自己的备份塞满。
	const walk = (root, prefix) => {
		if (!fs.existsSync(root)) return;
		for (const e of fs.readdirSync(root, { withFileTypes: true })) {
			const rel = prefix ? `${prefix}/${e.name}` : e.name;
			if (e.isDirectory()) walk(path.join(root, e.name), rel);
			else out.push({ rel, abs: path.join(root, e.name), root });
		}
	};
	walk(CONTENT_DIR, "content");
	walk(UPLOADS_DIR, "uploads");
	return out.filter((f) => !SKIP.some(([re]) => re.test(f.rel)));
}

// ════════════════════════════════════════════════════════════════════════════
// SQLite 快照与校验
// ════════════════════════════════════════════════════════════════════════════

function vacuumInto(target) {
	if (!fs.existsSync(path.dirname(target))) fs.mkdirSync(path.dirname(target), { recursive: true });
	if (fs.existsSync(target)) fs.rmSync(target);
	// 刻意用**可写**连接：WAL 模式下 SQLite 需要能触碰 -shm/-wal 才能读到一致的视图，
	// 以 readOnly 打开会直接报 "attempt to write a readonly database"。
	// VACUUM INTO 不会改动源库，它只会顺带把 WAL 检查点落盘 —— 对生产库而言这是良性的。
	const db = new DatabaseSync(DB_FILE);
	try {
		db.exec("PRAGMA busy_timeout=5000");
		db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
	} finally {
		db.close();
	}
}

/** 打开一个（可能是刚解出来的）SQLite，报出它的健康状况与关键行数。 */
function inspectSqlite(file) {
	const db = new DatabaseSync(file);
	try {
		const ic = db.prepare("PRAGMA integrity_check").all().map((r) => Object.values(r)[0]);
		const rc = db.prepare("PRAGMA quick_check").all().map((r) => Object.values(r)[0]);
		const tables = db
			.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
			.all()
			.map((r) => Object.values(r)[0]);
		const counts = {};
		for (const t of ["users", "sessions", "attachments", "activities", "posts", "board_issues"]) {
			if (tables.includes(t)) {
				try {
					counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n ?? 0;
				} catch {
					/* 列可能变了，跳过即可 */
				}
			}
		}
		return { integrity: ic, quickCheck: rc, tables, counts };
	} finally {
		db.close();
	}
}

// ════════════════════════════════════════════════════════════════════════════
// 轮转：GFS（祖父-父-子）
// ════════════════════════════════════════════════════════════════════════════

function isoWeekKey(ts) {
	// ISO-8601 周编号（周一为一周之始，含当年第一个周四的那周为第 1 周），形如 "2026-W39"
	const target = new Date(ts);
	const targetUtc = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
	const dayNum = (target.getUTCDay() + 6) % 7; // 周一 = 0
	const thursday = new Date(targetUtc + (3 - dayNum) * 864e5);
	const year = thursday.getUTCFullYear();
	const jan4 = Date.UTC(year, 0, 4);
	const jan4Day = (new Date(jan4).getUTCDay() + 6) % 7;
	const week = Math.round((thursday - (jan4 - (jan4Day - 3) * 864e5)) / 6048e5) + 1;
	return `${year}-W${String(week).padStart(2, "0")}`;
}

function isoOf(tsDirName) {
	// 目录名形如 20260926T124452Z（[^-:] 精确版；曾因要求带横杠而匹配不到，
	// 导致轮转把每一份备份都当陌生目录 —— 保留集恒空，历史快照反而被删光）。
	const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(tsDirName);
	if (!m) return null;
	const y = +m[1], mo = +m[2] - 1, d = +m[3];
	const ts = Date.UTC(y, mo, d, +m[4], +m[5], +m[6]);
	return { day: `${m[1]}-${m[2]}-${m[3]}`, month: `${m[1]}-${m[2]}`, week: isoWeekKey(ts), ts, name: tsDirName };
}

/**
 * GFS 轮转：最近 keep.daily 天的**全部**快照、最近 keep.weekly 个 ISO 周内各留最新一份、
 * 最近 keep.monthly 个月各留最新一份。并集即为保留集。
 *
 * 为什么允许"最近 7 天全部"而不是"每天一份"：备份是按计划的，一天可能跑 1 次也可能 0 次
 * （机器关机、任务失败）。把"最近 7 天"整段保留，就能保证无论当天跑了几次都不会缺，
 * 也不会因为某天没跑就把那天从保留序列里挖掉一个洞。
 * 每周/每月那条线则负责长期留存 —— 否则去年今天的东西一定找不回来。
 */
function rotate(dirSet, keep) {
	const all = [...dirSet]
		.map((d) => isoOf(d))
		.filter(Boolean)
		.sort((a, b) => a.name.localeCompare(b.name));
	/** 每个桶（周 / 月）里只留最新的一份。 */
	const newestIn = (bucketOf) => {
		const m = new Map();
		for (const d of all) {
			const b = bucketOf(d);
			if (!m.has(b) || d.name > m.get(b).name) m.set(b, d);
		}
		return m;
	};
	const keepSet = new Set();
	// ① 最近 N 天：这一整段里的**每一份**都留。
	//    写成"每天留最新一份"会和本段注释冲突，而差别不小 —— 某天跑了两遍
	//    （第一遍失败重跑、或手工补跑），早那一份会被当天的轮转判为多余而删掉。
	for (const d of all) if (d.ts >= Date.now() - keep.daily * 864e5) keepSet.add(d.name);
	for (const d of newestIn((x) => x.week).values()) keepSet.add(d.name);
	for (const d of newestIn((x) => x.month).values()) keepSet.add(d.name);
	return { keep: keepSet, days: new Set(all.map((d) => d.day)) };
}

// ════════════════════════════════════════════════════════════════════════════
// 主流程
// ════════════════════════════════════════════════════════════════════════════

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.verify) return doVerify(args.verify, resolveKey());
	if (args.restore) return doRestore(args.restore, args.to, resolveKey());

	const key = args.plan ? null : resolveKey();
	const keep = gfsKeep();
	const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); // 2026-09-26T031500Z

	log(`\x1b[1mStelarith 备份\x1b[0m  ${ts}`);
	log(`  data-root = ${DATA_ROOT}`);
	log(`  db        = ${DB_FILE}`);

	if (!fs.existsSync(DB_FILE)) fatal("找不到数据库 " + DB_FILE);

	const files = collectFiles();
	let dbSize = fs.statSync(DB_FILE).size;
	let bytes = 0;
	const plan = {
		ts,
		dbEncryptedBytes: dbSize + 60,
		plainFiles: files.length,
		plainBytes: 0,
		sinks: [],
	};
	for (const f of files) {
		try {
			plan.plainBytes += fs.statSync(f.abs).size;
		} catch {
			/* 极小概率的文件删除竞态，忽略 */
		}
	}
	plan.sinks.push("local", r2Configured() ? "r2" : "(r2 未配置)", b2Ready() ? "b2" : "(b2 未配置)");

	if (args.plan) {
		hr("计划（未执行任何写操作）");
		log(`  1. VACUUM INTO  content/backups/staging/${ts}.db`);
		log(`  2. AES-256-GCM 加密数据库 → ${(plan.dbEncryptedBytes / 1024).toFixed(1)} KiB`);
		log(`  3. 逐件分发 ${files.length} 个文件（${(plan.plainBytes / 1024).toFixed(1)} KiB，明文）`);
		log(`  4. 目标：`);
		log(`      本机  content/backups/local/${ts}/`);
		log(`      R2   ${CFG.prefix}/sqlite/${ts}/   ${r2Configured() ? "" : "← R2_* 未配置"}`);
		log(`      B2   ${b2Base(ts)}/   ${b2Ready() ? "" : "← B2_* 未配置，按纪律会直接失败"}`);
		log(`  5. 轮转：日 ${keep.daily} / 周 ${keep.weekly} / 月 ${keep.monthly}（只删本机份）`);
		return 0;
	}

	// ── ① 一致性快照 ────────────────────────────────────────────────────────
	hr("① 一致性快照");
	const staging = path.join(CONTENT_DIR, "backups", "staging");
	const snap = path.join(staging, `${ts}.db`);
	vacuumInto(snap);
	dbSize = fs.statSync(snap).size;
	ok(`VACUUM INTO 完成，${(dbSize / 1024).toFixed(1)} KiB`);
	const snapInspect = inspectSqlite(snap);
	if (snapInspect.integrity.some((r) => r !== "ok")) {
		bad("快照 integrity_check 不通过：" + snapInspect.integrity.join(","));
		throw new Error("快照不健康，中止");
	}
	ok("integrity_check = ok");

	// ── ② 加密 ──────────────────────────────────────────────────────────────
	hr("② 加密");
	const plain = fs.readFileSync(snap);
	const enc = encryptBytes(plain, key, { db: path.basename(DB_FILE), ts, source: "sqlite-vacuum-into" });
	ok(`AES-256-GCM，${(enc.length / 1024).toFixed(1)} KiB（含 ${enc.length - plain.length - 60 - 12 - 28 - 16} 字节头，常规开销）`);

	// ── ③ 分发 ──────────────────────────────────────────────────────────────
	hr("③ 分发 · 份 1 本机");
	const localDir = path.join(CFG.localRoot, ts);
	await fsp.mkdir(localDir, { recursive: true });
	fs.writeFileSync(path.join(localDir, `${ts}.db.enc`), enc);
	// 明文快照也留一份，便于人工直接用 SQLite 浏览器打开核对（不必先解密）。
	// 代价是多占一份磁盘，对本站规模可以忽略。
	fs.copyFileSync(snap, path.join(localDir, `${ts}.db`));
	let copied = 0;
	for (const f of files) {
		const rel = path.relative(f.root, f.abs);
		const dst = path.join(localDir, f.rel);
		await fsp.mkdir(path.dirname(dst), { recursive: true });
		await fsp.copyFile(f.abs, dst);
		copied++;
	}
	ok(`本机 ${localDir}（${copied} 个文件 + 密文 + 明文快照）`);
	bytes += enc.length + plan.plainBytes;

	// ④ R2
	hr("④ 分发 · 份 2 R2");
	const r2Base = `${CFG.prefix}/sqlite/${ts}`;
	const r2Jobs = [[`${r2Base}/db/${ts}.db.enc`, enc, "application/octet-stream"]];
	for (const f of files) r2Jobs.push([`${r2Base}/${f.rel}`, await fsp.readFile(f.abs), PLAIN]);
	if (!r2Configured()) {
		warn("R2_* 未配置，跳过份 2（本机份已落盘，数据没丢，但这一项不完整）");
	} else {
		for (const [k, body, ct] of r2Jobs) {
			const r = await putObject(k, body, ct);
			bytes += r.bytes;
		}
		ok(`R2 上传 ${r2Jobs.length} 个对象 → ${r2Base}/`);
	}

	// ⑤ B2
	hr("⑤ 分发 · 份 3 B2（异地）");
	const b2Root = b2Base(ts);
	const b2Jobs = [[`${b2Root}/db/${ts}.db.enc`, enc, "application/octet-stream"]];
	for (const f of files) b2Jobs.push([`${b2Root}/${f.rel}`, await fsp.readFile(f.abs), PLAIN]);
	let b2Ok = b2Ready();
	let b2Skip = false;
	if (!b2Ready()) {
		const msg =
			"B2 未配置（缺 B2_ACCOUNT_ID / B2_BUCKET / B2_ACCESS_KEY_ID / B2_SECRET_ACCESS_KEY 中的任一项）。\n" +
			"  备份不需要另一个服务商，就不叫异地 —— 份 2 和份 3 都由本机发起，机器一没就没了。\n" +
			"  现在只有本机 + " + (r2Configured() ? "R2" : "无") + " 两份。";
		if (args.allowPartial) {
			b2Skip = true;
			warn(msg);
			warn("已设 --allow-partial，继续。这一点会写进 latest.json。");
		} else {
			fatal(msg + "\n  想跳过请在命令后加 --allow-partial —— 效果是「今天其实没有异地备份」。");
		}
	} else {
		await withB2(async () => {
			for (const [k, body, ct] of b2Jobs) {
				const r = await putObject(k, body, ct);
				bytes += r.bytes;
			}
		});
		ok(`B2 上传 ${b2Jobs.length} 个对象 → ${b2Root}/`);
	}

	// ── ⑥ 回读校验：上传成功不代表存对了 ─────────────────────────────────────
	hr("⑥ 回读校验");
	let verifyFailed = false;
	const verifyOne = async (label, prefix) => {
		try {
			const head = await withB2(async () => headObject(`${prefix}/db/${ts}.db.enc`));
			if (!head) {
				warn(`${label}: 对象不存在`);
				verifyFailed = true;
				return;
			}
			if (head.size !== enc.length) {
				bad(`${label}: 大小不符（远端 ${head.size} ≠ 本地 ${enc.length}）`);
				verifyFailed = true;
				return;
			}
			ok(`${label}: ${head.size} 字节，与本地一致`);
		} catch (e) {
			bad(`${label}: ${e.message}`);
			verifyFailed = true;
		}
	};
	if (r2Configured()) await verifyOne("R2", r2Base);
	if (b2Ok) await verifyOne("B2", b2Root);
	// 解密自验：拿密文重新走一遍 decrypt，确认密钥对了、内容没坏。
	const back = decryptBytes(enc, key);
	if (back.plain.length !== plain.length || !back.plain.equals(plain)) {
		bad("解密自验：内容与快照不一致（这是逻辑 bug，不该发生）");
		verifyFailed = true;
	} else {
		ok("解密自验：密钥正确、内容与快照逐字节一致");
	}
	if (verifyFailed) {
		fatal("回读校验未通过 —— 按纪律不推进轮转，宁可堆旧备份也不删新的。请人工检查后重试。");
	}

	// ⑦ 恢复演练（每次备份顺带做一次"能解出来吗"的最小验证）
	hr("⑦ 恢复演练（最小：这份密文能不能变成可打开的库）");
	const probeDir = await fsp.mkdtemp(path.join(os.tmpdir(), "stelarith-restore-"));
	fs.writeFileSync(path.join(probeDir, `${ts}.db`), back.plain);
	const probe = inspectSqlite(path.join(probeDir, `${ts}.db`));
	const rowInfo = Object.entries(probe.counts)
		.map(([t, n]) => `${t}=${n}`)
		.join(" ");
	if (probe.integrity.some((r) => r !== "ok")) {
		bad("演练库 integrity_check 不通过");
		verifyFailed = true;
	} else {
		ok(`演练库 integrity_check = ok，${probe.tables.length} 张表（${rowInfo}）`);
	}
	await fsp.rm(probeDir, { recursive: true, force: true });

	// ── ⑧ 轮转 ──────────────────────────────────────────────────────────────
	hr("⑧ 轮转（GFS · 只删本机份）");
	const all = fs.existsSync(CFG.localRoot) ? fs.readdirSync(CFG.localRoot) : [];
	const { keep: keepSet, days } = rotate(new Set([...all, ts]), keep);
	let removed = 0;
	for (const d of all) {
		// keepSet 里存的是**目录名**（快照时间戳），这里必须拿名字比。
		// 早先比的是 isoOf(d).key（日历日 "2026-09-26"），两者格式不同，
		// 于是什么都匹配不上 —— 每次轮转都在删本该保住的旧备份。
		if (d === ts || keepSet.has(d)) continue;
		await fsp.rm(path.join(CFG.localRoot, d), { recursive: true, force: true });
		removed++;
	}
	ok(`本机保留 ${keepSet.size} 个快照，删除 ${removed} 个旧份`);
	if (removed > 0) log(`  （被删的：${all.filter((d) => d !== ts && !keepSet.has(d)).join("  ")}）`);
	log("  远端不做清理 —— 云存储按量计费不贵，而误删不可恢复。要清请到控制台手动删。");

	// manifest
	const manifest = {
		ts,
		bytes,
		dbEncrypted: enc.length,
		files: files.length,
		integrity: probe.integrity,
		counts: probe.counts,
		sinks: { local: true, r2: r2Configured(), b2: b2Ok ? "ok" : b2Skip ? "skipped-by-flag" : "unconfigured" },
		rotation: { days: days.size, removed },
		allowPartial: b2Skip,
	};
	await fsp.writeFile(
		path.join(CONTENT_DIR, "backups", "latest.json"),
		JSON.stringify(manifest, null, 2) + "\n"
	);

	hr("完成");
	log(`  用时 ${((Date.now() - t0) / 1000).toFixed(1)}s，共写出 ${(bytes / 1024 / 1024).toFixed(2)} MiB`);
	log(`  备份集 = ${ts}，可在 ${path.join(CFG.localRoot, ts)} 找到本机份`);
	if (b2Skip) warn("本次缺少异地份 3（B2 未配置）。这不是一次完整的 3-2-1。");
	return 0;
}

// ── --verify ────────────────────────────────────────────────────────────────
async function doVerify(file, key) {
	const buf = fs.readFileSync(path.resolve(file));
	hr("校验 " + path.resolve(file));
	const { meta, plain } = decryptBytes(buf, key);
	ok(`解密成功：${meta.alg}，明文 ${meta.size} 字节，sha256=${meta.sha256.slice(0, 16)}…`);
	const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "stelarith-verify-"));
	const p = path.join(tmp, "snapshot.db");
	fs.writeFileSync(p, plain);
	const info = inspectSqlite(p);
	if (info.integrity.some((r) => r !== "ok")) bad("integrity_check = " + info.integrity.join(","));
	else ok(`integrity_check = ok，${info.tables.length} 张表`);
	log("  关键行数：", Object.entries(info.counts).map(([t, n]) => `${t}=${n}`).join("  "));
	await fsp.rm(tmp, { recursive: true, force: true });
	return info.integrity.some((r) => r !== "ok") ? 3 : 0;
}

// ── --restore ───────────────────────────────────────────────────────────────
async function doRestore(file, to, key) {
	const src = path.resolve(file);
	if (!fs.existsSync(src)) fatal("文件不存在: " + src);
	const dest = path.resolve(to || path.join(CONTENT_DIR, "backups", "_restore-" + Date.now()));
	await fsp.mkdir(dest, { recursive: true });
	hr(`恢复演练 → ${dest}`);
	const buf = fs.readFileSync(src);
	let plain = null;
	let meta = null;
	if (buf.subarray(0, MAGIC_LEN).toString("ascii") === MAGIC) {
		({ meta, plain } = decryptBytes(buf, key));
		ok(`已解密（${meta.alg}）：${meta.db ?? "?"}`);
		fs.writeFileSync(path.join(dest, meta.db ?? "restore.db"), plain);
		ok(`写出 ${path.join(dest, meta.db ?? "restore.db")}`);
		const info = inspectSqlite(path.join(dest, meta.db ?? "restore.db"));
		if (info.integrity.some((r) => r !== "ok")) bad("integrity_check 不通过");
		else ok(`integrity_check = ok`);
		log("  关键行数：", Object.entries(info.counts).map(([t, n]) => `${t}=${n}`).join("  "));
	} else {
		// 明文内容文件（content / uploads 下的 JSON、MD 等）
		const base = path.basename(src);
		fs.copyFileSync(src, path.join(dest, base));
		ok(`明文文件，原样写出：${base}`);
	}
	log(`\n  ⚠ 演练到此为止 —— 没有覆盖任何生产数据，产物落在 ${dest} 下面。`);
	log(`  真要恢复时，把里面的数据库放到 ${DB_FILE}，其余明文文件按 content/ 与 uploads/ 下的`);
	log(`  相对路径覆盖回去，然后重启站点。顺序：停站 → 覆盖 → 校验 → 起站。`);
	return 0;
}

main()
	.then((code) => process.exit(code ?? 0))
	.catch((e) => {
		console.error("\n\x1b[31m备份异常：\x1b[0m", e.message);
		if (process.env.BACKUP_DEBUG) console.error(e);
		process.exit(1);
	});
