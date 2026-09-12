/**
 * SQLite 数据层 —— 基于 Node 22 内置的 `node:sqlite`（零第三方依赖）。
 *
 * 设计要点：
 * - 单例连接（`getDb()`），进程内复用；WAL 模式兼顾读写并发。
 * - 三张核心表：users（账号与资料）、sessions（登录会话）、activities（多用户活动流）。
 * - 首次启动自动建表；若 content/users.json 存在且 users 表为空，则一次性迁移入库
 *   （保留原有 scrypt 口令哈希与 salt，用户无需重置密码）。
 *
 * 数据库文件：content/stelarith.db（已被 .gitignore 排除，属运行时数据）。
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const CONTENT_DIR = path.resolve("content");
const DB_FILE = path.join(CONTENT_DIR, "stelarith.db");
const USERS_JSON = path.join(CONTENT_DIR, "users.json");

let _db: DatabaseSync | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  display_name  TEXT    NOT NULL DEFAULT '',
  email         TEXT    NOT NULL DEFAULT '',
  avatar        TEXT    NOT NULL DEFAULT '',
  bio           TEXT    NOT NULL DEFAULT '',
  role          TEXT    NOT NULL DEFAULT 'user',
  status        TEXT    NOT NULL DEFAULT 'active',
  password_hash TEXT    NOT NULL,
  salt          TEXT    NOT NULL,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  last_login_at TEXT,
  last_login_ip TEXT,
  login_count   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token        TEXT    PRIMARY KEY,
  user_id      INTEGER NOT NULL,
  created_at   TEXT    NOT NULL,
  last_seen_at TEXT    NOT NULL,
  expires_at   TEXT    NOT NULL,
  ip           TEXT    NOT NULL DEFAULT '',
  user_agent   TEXT    NOT NULL DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user   ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_seen   ON sessions(last_seen_at);

CREATE TABLE IF NOT EXISTS activities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  username   TEXT NOT NULL DEFAULT '',
  action     TEXT NOT NULL,
  target     TEXT NOT NULL DEFAULT '',
  detail     TEXT NOT NULL DEFAULT '',
  ip         TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activities_created ON activities(created_at);
CREATE INDEX IF NOT EXISTS idx_activities_user    ON activities(user_id);
CREATE INDEX IF NOT EXISTS idx_activities_action  ON activities(action);

-- ── 集控面板（/admin/console）协作数据 ────────────────────────────────────────
-- CIMS 后端本身不存储通知历史 / 班级交流 / 操作日志，这些落在站点侧 SQLite，
-- 由 /api/console/ext/* 暴露给集控面板，替代此前的纯前端演示数据。

-- 通知广播历史（发布动作本身仍由 CIMS 下发到设备，这里只留痕）
CREATE TABLE IF NOT EXISTS console_notices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  scope      TEXT NOT NULL DEFAULT '本班',
  account    TEXT NOT NULL DEFAULT '',
  author     TEXT NOT NULL DEFAULT '',
  sent       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_console_notices_created ON console_notices(created_at);

-- 班级交流（按 room 隔离：global 群 + 各班级房间）
CREATE TABLE IF NOT EXISTS console_chat (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  room       TEXT NOT NULL DEFAULT 'techrep-global',
  sender     TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_console_chat_room ON console_chat(room, created_at);

-- 集控操作日志（谁在哪个班对哪台设备做了什么）
CREATE TABLE IF NOT EXISTS console_audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor      TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL DEFAULT '',
  action     TEXT NOT NULL,
  target     TEXT NOT NULL DEFAULT '',
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_console_audit_created ON console_audit(created_at);
`;

export function nowIso(): string {
	return new Date().toISOString();
}

function hashPassword(password: string, salt: string): string {
	return crypto.scryptSync(password, salt, 64).toString("hex");
}

function ensureDb(): DatabaseSync {
	if (_db) return _db;
	fs.mkdirSync(CONTENT_DIR, { recursive: true });
	const db = new DatabaseSync(DB_FILE);
	// WAL：读写并发更友好；busy_timeout 规避偶发锁等待。
	db.exec("PRAGMA journal_mode = WAL;");
	db.exec("PRAGMA foreign_keys = ON;");
	db.exec("PRAGMA busy_timeout = 5000;");
	db.exec(SCHEMA);
	// 注册 / 邮箱验证所需字段（向后兼容旧库：缺失则安全新增）。
	// ⚠️ SQLite 的 ALTER TABLE ADD COLUMN **不支持** IF NOT EXISTS，直接写会抛语法错误；
	//    必须先用 PRAGMA table_info 探测列是否存在，再决定是否 ALTER。
	const cols = new Set(
		(db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name)
	);
	if (!cols.has("verified")) db.exec("ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0");
	if (!cols.has("verify_token")) db.exec("ALTER TABLE users ADD COLUMN verify_token TEXT NOT NULL DEFAULT ''");
	if (!cols.has("verify_token_expires")) db.exec("ALTER TABLE users ADD COLUMN verify_token_expires TEXT NOT NULL DEFAULT ''");
	seed(db);
	// 历史 active 账号（本就不经邮箱验证即可登录，含种子 admin）统一视为已验证；
	// 新注册的 pending 用户不受影响（验证或管理员批准后才会变 active 且 verified=1）。
	db.exec("UPDATE users SET verified = 1 WHERE status = 'active' AND verified = 0");
	// 全部初始化成功后再缓存实例：避免半初始化（迁移失败）的 DB 被后续调用复用。
	_db = db;
	return _db;
}

/** 首次播种：优先从遗留 users.json 迁移，否则创建内置 admin。 */
function seed(db: DatabaseSync) {
	const row = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
	if (row && row.n > 0) return;

	// ① 迁移旧 JSON 用户（保留原哈希与 salt，密码继续有效）
	if (fs.existsSync(USERS_JSON)) {
		try {
			const raw = JSON.parse(fs.readFileSync(USERS_JSON, "utf-8"));
			const list: any[] = Array.isArray(raw) ? raw : raw.users || [];
			const insert = db.prepare(
				`INSERT OR IGNORE INTO users
				 (username, display_name, email, avatar, bio, role, status, password_hash, salt, created_at, updated_at, login_count)
				 VALUES (?, ?, '', '', '', ?, 'active', ?, ?, ?, ?, 0)`
			);
			let n = 0;
			const ts = nowIso();
			for (const u of list) {
				if (!u?.username || !u?.passwordHash || !u?.salt) continue;
				insert.run(
					String(u.username),
					String(u.displayName || u.username),
					String(u.role || "user"),
					String(u.passwordHash),
					String(u.salt),
					String(u.createdAt || ts),
					ts
				);
				n++;
			}
			if (n > 0) {
				console.log(`[db] 已从 users.json 迁移 ${n} 个账号到 SQLite。`);
				return;
			}
		} catch (err) {
			console.warn("[db] users.json 迁移失败，转为初始化默认账号：", err);
		}
	}

	// ② 全新初始化：口令来自 ADMIN_PASSWORD，否则随机生成并仅在日志输出一次
	const generated = !process.env.ADMIN_PASSWORD;
	const seedPassword = process.env.ADMIN_PASSWORD || crypto.randomBytes(18).toString("base64url");
	const salt = crypto.randomBytes(16).toString("hex");
	const ts = nowIso();
	db.prepare(
		`INSERT INTO users (username, display_name, email, avatar, bio, role, status, password_hash, salt, created_at, updated_at, login_count)
		 VALUES ('admin', '管理员', '', '', '', 'admin', 'active', ?, ?, ?, ?, 0)`
	).run(hashPassword(seedPassword, salt), salt, ts, ts);
	if (generated) {
		console.log(`[auth] 已初始化管理员账号 admin，随机生成的初始密码：${seedPassword}`);
		console.log("[auth] 此密码仅显示一次，请登录后立即修改。也可通过环境变量 ADMIN_PASSWORD 预设。");
	}
}

export function getDb(): DatabaseSync {
	return ensureDb();
}

/** 导出供 auth 复用，避免重复实现。 */
export { hashPassword };
