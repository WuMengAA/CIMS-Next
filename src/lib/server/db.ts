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
  login_count   INTEGER NOT NULL DEFAULT 0,
  class_name    TEXT NOT NULL DEFAULT '',
  grade_name    TEXT NOT NULL DEFAULT ''
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
-- classes：本次推送的目标班级（逗号分隔；空串 = 不限班级/全校）。
-- channel：来源通道（notice / chat / announcement），用于辨识「同一内容经多条通道」，
--          配合 broadcast.ts 的短时去重，避免设备因多通道各推一次而收到重复通知。
CREATE TABLE IF NOT EXISTS console_notices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  scope      TEXT NOT NULL DEFAULT '本班',
  account    TEXT NOT NULL DEFAULT '',
  author     TEXT NOT NULL DEFAULT '',
  sent       INTEGER NOT NULL DEFAULT 0,
  classes    TEXT NOT NULL DEFAULT '',
  channel    TEXT NOT NULL DEFAULT '',
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
--
-- 🔐 防篡改（2026-09-17 加）：每行带一条**哈希链**。
--    row_hash  = H(prev_hash ‖ id ‖ actor ‖ role ‖ action ‖ target ‖ detail ‖ created_at)
--    prev_hash = 上一行的 row_hash（链首为空串，或审计被裁剪后的「锚点」）。
--    为什么需要：库里直连就能改一行记录，而「班级账号不能越权」这条承诺**只能靠审计自证**；
--    审计本身可被静默改写的话，这条承诺等于不存在。
--    单条 SHA256 只防「随手改」（改完必须重算后续所有行）—— 所以支持 CONSOLE_AUDIT_KEY 时
--    改用 **HMAC-SHA256**：没有密钥就算把整张表重写一遍也造不出自洽的链。
--    旧库（本次迁移前）的行没有哈希，verify 会跳过它们并如实报告「从第 N 行起可校验」。
CREATE TABLE IF NOT EXISTS console_audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor      TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL DEFAULT '',
  action     TEXT NOT NULL,
  target     TEXT NOT NULL DEFAULT '',
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  prev_hash  TEXT NOT NULL DEFAULT '',
  row_hash   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_console_audit_created ON console_audit(created_at);

-- 键值小表：放「不属于任何业务实体」的运行期元数据。
-- 目前只用于审计链：audit_head（链尾哈希）、audit_anchor（裁剪后剩余链的起点哈希）、
-- audit_pruned_before（裁剪到哪个时间点，便于解释为什么历史少了一段）。
CREATE TABLE IF NOT EXISTS console_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- 班级交流 · 好友关系（2026-09-15）
-- 一对一行，requester 发起、addressee 接收；status: pending / accepted / rejected。
-- 用 user id 作为关系主键（username 改名不会断关系），同时冗余存一份显示名，
-- 免得列表页为了显示名字再回表捞。
-- 唯一约束建在「无向对」上（两端 id 排序后拼接），这样 A→B 和 B→A 不会各存一行。
CREATE TABLE IF NOT EXISTS console_friends (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  pair           TEXT NOT NULL UNIQUE,
  requester_id   INTEGER NOT NULL,
  requester_name TEXT NOT NULL DEFAULT '',
  addressee_id   INTEGER NOT NULL,
  addressee_name TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'pending',
  message        TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_console_friends_addr ON console_friends(addressee_id, status);
CREATE INDEX IF NOT EXISTS idx_console_friends_req  ON console_friends(requester_id, status);

-- 权限晋升申请（#181 · 2026-09-20）
-- 等级轴是「逐级晋升」的：L2 学生想进集控（L3 电教委员）必须提交申请 **并附能力证明**，
-- 由更高等级的人批准。本表是这条链路的落地处。
--
-- 为什么放 DB 而不是 content/*.json：批准动作要**改 users.role**，两者必须同源同事务边界；
-- 分散到文件会出现「申请已批准但角色没改」或反之的中间态。
--
-- from_role 冗余存「提交时的角色」：审批时必须拿它比对用户的**当前**角色，
-- 若中途已被别的管理员升过级，这张申请就是陈旧申请，必须拒绝执行（否则会把人降级）。
CREATE TABLE IF NOT EXISTS role_requests (
  id            TEXT    PRIMARY KEY,
  user_id       INTEGER NOT NULL,
  username      TEXT    NOT NULL,
  from_role     TEXT    NOT NULL,
  from_level    INTEGER NOT NULL DEFAULT 0,
  target_role   TEXT    NOT NULL,
  target_level  INTEGER NOT NULL DEFAULT 0,
  -- ── 能力证明 ──
  real_name     TEXT    NOT NULL DEFAULT '',
  contact       TEXT    NOT NULL DEFAULT '',
  proof_type    TEXT    NOT NULL DEFAULT '',
  proof_ref     TEXT    NOT NULL DEFAULT '',
  class_name    TEXT    NOT NULL DEFAULT '',
  grade_name    TEXT    NOT NULL DEFAULT '',
  reason        TEXT    NOT NULL DEFAULT '',
  evidence      TEXT    NOT NULL DEFAULT '',
  -- ── 审核 ──
  status        TEXT    NOT NULL DEFAULT 'pending',
  reviewer      TEXT    NOT NULL DEFAULT '',
  review_note   TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL,
  reviewed_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_role_requests_status ON role_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_role_requests_user   ON role_requests(user_id, status);

-- 用户称号表（2026-09-21 · 权限重构）：每人可独立追加/撤回称号。
-- 权限的真正载体是「称号」而非「等级」，本表让单个用户的称号集合脱离角色预设，
-- 实现「独立追加/撤回」：某用户有行时，其有效称号 = 本表集合（完整覆盖，可增可减）；
-- 无行时回退到角色预设 ROLE_TITLES（见 permissions.ts）。
-- title_key 取值见 permissions.ts 的 TITLE_KEYS。
CREATE TABLE IF NOT EXISTS user_titles (
  user_id    INTEGER NOT NULL,
  title_key  TEXT    NOT NULL,
  PRIMARY KEY (user_id, title_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_titles_user ON user_titles(user_id);
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
	// 班级绑定（集控面板「新账号引导补充班级身份」字段）：仅面板/管理端可写，用户自填。
	if (!cols.has("class_name")) db.exec("ALTER TABLE users ADD COLUMN class_name TEXT NOT NULL DEFAULT ''");
	if (!cols.has("grade_name")) db.exec("ALTER TABLE users ADD COLUMN grade_name TEXT NOT NULL DEFAULT ''");

	// console_notices 定向广播字段（向后兼容旧库：老行补空串，等价于「不限班级」）。
	// 有了这两列，历史通知才能「分班级、按通道」正确展示，也多通道重复推送有了判据。
	const ncols = new Set(
		(db.prepare("PRAGMA table_info(console_notices)").all() as { name: string }[]).map((c) => c.name)
	);
	if (!ncols.has("classes")) db.exec("ALTER TABLE console_notices ADD COLUMN classes TEXT NOT NULL DEFAULT ''");
	if (!ncols.has("channel")) db.exec("ALTER TABLE console_notices ADD COLUMN channel TEXT NOT NULL DEFAULT ''");

	// console_audit 哈希链字段（向后兼容旧库：老行补空串 = 「本行无链」，
	// verifyAudit 会从第一条有哈希的行开始校验，并如实报告跳过了多少旧行）。
	const acols = new Set(
		(db.prepare("PRAGMA table_info(console_audit)").all() as { name: string }[]).map((c) => c.name)
	);
	if (!acols.has("prev_hash")) db.exec("ALTER TABLE console_audit ADD COLUMN prev_hash TEXT NOT NULL DEFAULT ''");
	if (!acols.has("row_hash")) db.exec("ALTER TABLE console_audit ADD COLUMN row_hash TEXT NOT NULL DEFAULT ''");

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
