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
  grade_name    TEXT NOT NULL DEFAULT '',
  -- 经验值（#248：经验等级 xp→Lv 的唯一数据源；纯展示，与权限/角色零耦合）
  xp            INTEGER NOT NULL DEFAULT 0
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

-- ── 项目展板 · 站内 Issues（类 GitHub）────────────────────────────────────
-- 为什么放 DB：issue 需要「每个项目内自增编号」（#1、#2…）、状态流转与评论计数，
-- 这些都是关系型语义；放 content/*.json 会退化成全量读写 + 手工算编号，
-- 并发下必然撞号。
--
-- number 是「项目内」编号，用 (project_slug, number) 唯一索引约束；
-- 分配编号时在事务里取 MAX(number)+1，配合 SQLite 的写锁即可保证不重号。
CREATE TABLE IF NOT EXISTS board_issues (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_slug  TEXT    NOT NULL,
  number        INTEGER NOT NULL,
  title         TEXT    NOT NULL,
  body          TEXT    NOT NULL DEFAULT '',
  author        TEXT    NOT NULL DEFAULT '',
  state         TEXT    NOT NULL DEFAULT 'open',   -- open | closed
  labels        TEXT    NOT NULL DEFAULT '[]',     -- JSON 数组，如 ["bug","enhancement"]
  pinned        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  closed_at     TEXT    NOT NULL DEFAULT '',
  closed_by     TEXT    NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_board_issues_num    ON board_issues(project_slug, number);
CREATE INDEX        IF NOT EXISTS idx_board_issues_state  ON board_issues(project_slug, state, created_at);

CREATE TABLE IF NOT EXISTS board_issue_comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id    INTEGER NOT NULL,
  author      TEXT    NOT NULL DEFAULT '',
  body        TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL,
  FOREIGN KEY (issue_id) REFERENCES board_issues(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_board_comments_issue ON board_issue_comments(issue_id, created_at);

-- ── 班级系统 v2：结构化的「用户 ↔ 班级」绑定 ─────────────────────────────────
-- 旧模型 users.class_name 是自由文本（一人一班、写错没人拦），权限层只能靠
-- 「数字启发式」去猜用户说的是哪个班 —— 这正是「班级选择列表没有确切真实获取班级」
-- 的根源。v2 的规矩：
--   · class_id 必须是 **CIMS 真实班级实体**（/class/list 里的 class_id，如 class_3p1），
--     绑定接口在写入前会实时校验存在性，绝不允许自由文本进这张表；
--   · 一人可绑多班（老师带两个班），上限按角色收敛（班主任=1、电教委员=1、老师=2）；
--   · 站长（owner/admin）不需要绑定 —— 他们的范围就是全校。
CREATE TABLE IF NOT EXISTS user_class_bindings (
  uid        INTEGER NOT NULL,
  class_id   TEXT    NOT NULL,
  class_name TEXT    NOT NULL DEFAULT '',
  bound_by   TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL,
  PRIMARY KEY (uid, class_id)
);
CREATE INDEX IF NOT EXISTS idx_ucb_class ON user_class_bindings(class_id);

-- 截图回放索引：设备每回传一张截图，除了进内存 TTL 缓存（面板实时看），
-- 再落一行 SQLite + 磁盘文件（content/captures/），「监控视频回放」= 按设备翻时间线。
-- 不存图片字节进库（PNG 动辄几百 KB，SQLite 存 blob 会让库迅速膨胀），只存索引。
CREATE TABLE IF NOT EXISTS captures (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uid        TEXT    NOT NULL,
  path       TEXT    NOT NULL,
  bytes      INTEGER NOT NULL DEFAULT 0,
  sha256     TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_captures_uid ON captures(uid, created_at);

-- 文件传输 v1 实体表：此前「传文件」只发元数据（name/size/sha256），文件本体从未
-- 离开发送机 —— 设备端自然永远收不到。现在：发送方先把文件上传到这里（磁盘
-- content/files/ + 本表登记），再经 file_push 指令让设备按 id 下载。
CREATE TABLE IF NOT EXISTS file_objects (
  id         TEXT    PRIMARY KEY,
  name       TEXT    NOT NULL,
  size       INTEGER NOT NULL DEFAULT 0,
  sha256     TEXT    NOT NULL DEFAULT '',
  kind       TEXT    NOT NULL DEFAULT 'file',   -- file | voice（语音走同一通道，设备端自动播放）
  path       TEXT    NOT NULL,
  uploader   TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL
);

-- 送达回执：file_push 每指向一台设备就记一行 pending，设备下载/播放后回 ack 更新。
-- 「文件传输后没有消息提示」的发送方那一半修在这里 —— 老师能看到每台设备收没收到。
CREATE TABLE IF NOT EXISTS file_deliveries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id    TEXT    NOT NULL,
  uid        TEXT    NOT NULL,
  class_id   TEXT    NOT NULL DEFAULT '',
  state      TEXT    NOT NULL DEFAULT 'pending',  -- pending | acked | failed
  detail     TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_filedel_file ON file_deliveries(file_id, uid);
CREATE INDEX IF NOT EXISTS idx_filedel_uid  ON file_deliveries(uid, created_at);

-- 通知送达回执（通知类型化 v2）：设备每收到一条通知记一行，设备侧按类型回报
-- received（已收到）→ read（已读）/ replied（已回复，action_result 为预设短语）
-- / rejected（确认通知被驳回——用户点了取消/不在场）。「谁没回应、谁还没收到」
-- 在操控端逐台亮出来，不再只是"HTTP 200 = 已送达"的假象。
CREATE TABLE IF NOT EXISTS notice_deliveries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  notice_id    INTEGER NOT NULL,
  uid          TEXT    NOT NULL,
  state        TEXT    NOT NULL DEFAULT 'pending',  -- pending|received|read|replied|rejected
  action_result TEXT   NOT NULL DEFAULT '',          -- replied 时的预设短语原文（如 已收到/马上处理）
  -- 老师自由回复的原文（replyNotice 上报；区别于上面那个"预设短语"）。
  -- 一个字段存两种回复很容易在面板上串味：预设点是给老师一键点的，自由回复
  -- 是她打了一整句话，界面上要分开显示，否则「已收到」会被当成回复内容顶替掉。
  reply        TEXT    NOT NULL DEFAULT '',
  detail       TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nd_notice ON notice_deliveries(notice_id);
CREATE INDEX IF NOT EXISTS idx_nd_uid ON notice_deliveries(uid, created_at);

-- 设备执行回执（v2.1 2026-09-25）：被控端「一个动作做完之后」的上报 ——
-- 截图存到哪了、语音播了没、收到了哪个文件、哪条通知弹到了老师眼前。
--
-- 为什么不能只用 command/ack：ack 回答的是"这条指令收到、结果是成功"，
-- 回答不了"然后呢"。老师那台机器上截图其实 saving 到了 C:/Users/.../shots/1.png，
-- 面板却只看到一个绿勾 —— 一旦要追问"图呢"，谁都答不上来。
-- 与 notice_deliveries 的分工：那边是「通知逐台送达/回复」，这边是「动作结果流水」。
CREATE TABLE IF NOT EXISTS device_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uid        TEXT    NOT NULL,   -- 设备 uid（被控端自称，密钥为部署级共享）
  event      TEXT    NOT NULL,   -- screenshot | file_receive | notice_shown | notice_reply | …
  ok         INTEGER NOT NULL DEFAULT 1,  -- 1=成功 0=失败（失败也记：失败才需要被看见）
  detail     TEXT    NOT NULL DEFAULT '',  -- 人话结论（存到哪了 / 为什么失败）
  extra      TEXT    NOT NULL DEFAULT '',  -- 结构化补充（notice_id、kind…）JSON
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dev_events ON device_events(uid, created_at);

-- 通知类型化元数据（v2.1）：不 ALTER 既有 console_notices，类型/旗标放这里，
-- listNotices join 出来。type: notice|island|popup|fullscreen；
-- flags: JSON（如 {"emergency_confirm":true,"auto_dismiss_seconds":30,"reply_presets":["已收到",…]}）。
CREATE TABLE IF NOT EXISTS notice_kinds (
  notice_id  INTEGER PRIMARY KEY,
  type       TEXT    NOT NULL DEFAULT 'notice',
  flags      TEXT    NOT NULL DEFAULT '{}'
);
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
	// 经验值（#248）：经验等级的数据源。旧库补 0 = 从 Lv.1 起步。
	if (!cols.has("xp")) db.exec("ALTER TABLE users ADD COLUMN xp INTEGER NOT NULL DEFAULT 0");

	// console_notices 定向广播字段（向后兼容旧库：老行补空串，等价于「不限班级」）。
	// 有了这两列，历史通知才能「分班级、按通道」正确展示，也多通道重复推送有了判据。
	const ncols = new Set(
		(db.prepare("PRAGMA table_info(console_notices)").all() as { name: string }[]).map((c) => c.name)
	);
	if (!ncols.has("classes")) db.exec("ALTER TABLE console_notices ADD COLUMN classes TEXT NOT NULL DEFAULT ''");
	if (!ncols.has("channel")) db.exec("ALTER TABLE console_notices ADD COLUMN channel TEXT NOT NULL DEFAULT ''");
	// 通知类型化（v2 2026-09-25）：notice=普通公告 / island=岛循环 / popup=弹窗确认回复 /
	// fullscreen=全屏紧急。flags 为 JSON：{emergency_confirm, auto_dismiss_seconds, reply_presets, expire_at}
	// 老行统一按「普通公告」处理（channel 是旧的通道标识，与 type 正交）。
	if (!ncols.has("type")) db.exec("ALTER TABLE console_notices ADD COLUMN type TEXT NOT NULL DEFAULT 'notice'");
	if (!ncols.has("flags")) db.exec("ALTER TABLE console_notices ADD COLUMN flags TEXT NOT NULL DEFAULT ''");

	// notice_deliveries 自由回复列（2026-09-25）：老行补空串 = 「这台机器没回过话」，
	// 与 state='pending' 相符，不影响既有的「谁看了」统计。
	const dcols = new Set(
		(db.prepare("PRAGMA table_info(notice_deliveries)").all() as { name: string }[]).map((c) => c.name)
	);
	if (!dcols.has("reply")) db.exec("ALTER TABLE notice_deliveries ADD COLUMN reply TEXT NOT NULL DEFAULT ''");

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
