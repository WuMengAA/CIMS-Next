/**
 * 站点数据访问层 —— 统一异步门面（Facade）。
 *
 * 设计要点：
 * - `getDb()` 始终**同步**返回一个「门面」对象，底层后端由环境变量 DB_BACKEND 决定：
 *     · sqlite（默认）：基于 Node 内置 `node:sqlite`，行为与旧版完全一致（Phase 1）；
 *     · pg（Phase 2 实现）：PostgreSQL，独立库 + 独立角色，与 cims/voicehub_dev 隔离。
 * - 门面把同步的 node:sqlite 包装成 await 友好的接口：
 *     `prepare(sql)` 返回 Stmt，`Stmt.get/all/run` 与 `exec` 均返回 Promise。
 *   调用形态完全不变（? 占位符、`.changes` / `.lastInsertRowid` 照旧），
 *   上层只需在调用处加 `await`、把所在函数标 `async`。
 * - SQLite 后端用一把进程内异步锁串行化所有语句，等价于旧版「单线程同步」语义，
 *   因此 BEGIN/COMMIT 事务不会被并发请求交错破坏（Phase 1 行为零变化）。
 *
 * 数据库文件：content/stelarith.db（已被 .gitignore 排除，属运行时数据）。
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import crypto from "node:crypto";
import type { Client as PgClient, QueryResult } from "pg";
// 运行时数据路径统一由 paths.ts 推导 —— 环境隔离只需改 STELARITH_DATA_ROOT 一处。
import { CONTENT_DIR, DB_FILE, USERS_JSON, describeDataLayout } from "./paths.js";

// ───────────────────────────── 统一异步门面类型 ─────────────────────────────
export type DbRow = Record<string, unknown>;

export interface RunResult {
	changes: number;
	/** 与旧版 DatabaseSync 语义对齐：恒为 number（后端内部从 bigint 收敛）。 */
	lastInsertRowid: number;
}

export interface Stmt {
	get(...params: unknown[]): Promise<DbRow | undefined>;
	all(...params: unknown[]): Promise<DbRow[]>;
	run(...params: unknown[]): Promise<RunResult>;
}

export interface DbFacade {
	readonly backend: "sqlite" | "pg";
	prepare(sql: string): Stmt;
	exec(sql: string): Promise<void>;
}

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
  token         TEXT    PRIMARY KEY,
  user_id       INTEGER NOT NULL,
  created_at    TEXT    NOT NULL,
  last_seen_at  TEXT    NOT NULL,
  expires_at    TEXT    NOT NULL,
  -- 登录时限绝对截止（2026-09-27 安全网补强）：滑动续期不得越过此线，
  -- 否则活跃会话"永远不过期"，登录时限形同虚设。
  deadline      TEXT    NOT NULL DEFAULT '',
  ip            TEXT    NOT NULL DEFAULT '',
  user_agent    TEXT    NOT NULL DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user   ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_seen   ON sessions(last_seen_at);

-- 第三方登录授权（本站作为 OAuth2 授权服务器的客户端注册表）。
-- 表出现之前清单只活在 content/oauth-clients.json（无密钥）与 .env 的密钥变量里，
-- 二者都在仓库/部署层，站内部署上改不动。管理页要能增删客户端、重置密钥、临时停用，
-- 就必须有一个运行时可写的真源，于是落库。JSON 降级为「首次播种的种子」。
--
-- secret 存明文是刻意的取舍：授权服务器需要常量时间比对，且管理页要「重置后一次性
-- 展示」，哈希存储会让这两件事都变复杂；而密钥的可见性本来就只开放给 manageOAuth
-- 的站长，与原先放在 .env 里的暴露面相当。
CREATE TABLE IF NOT EXISTS oauth_clients (
  id            TEXT    PRIMARY KEY,
  name          TEXT    NOT NULL,
  description   TEXT    NOT NULL DEFAULT '',
  -- 密钥；空串 = 未配置，该客户端一律拒绝发放令牌
  secret        TEXT    NOT NULL DEFAULT '',
  -- JSON 数组字符串：允许的回拨地址（精确匹配）
  redirect_uris TEXT    NOT NULL DEFAULT '[]',
  -- 是否允许原生应用回拨 http://127.0.0.1:<任意端口>/oauth-callback
  loopback      INTEGER NOT NULL DEFAULT 0,
  -- JSON 数组字符串：允许申请的 scope
  scopes        TEXT    NOT NULL DEFAULT '[]',
  default_scope TEXT    NOT NULL DEFAULT 'profile',
  -- 0 = 停用：authorize / token 阶段直接拒绝，已在用的令牌不受影响
  enabled       INTEGER NOT NULL DEFAULT 1,
  -- 1 = 内置兜底客户端（如已发布在外的桌面端），页面上不可删除
  builtin       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);

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
-- 用户 ↔ 班级绑定（人归哪个班；**school_id 为多学校预留**，2026-10-05 定位 v2）
CREATE TABLE IF NOT EXISTS user_class_bindings (
  uid        INTEGER NOT NULL,
  school_id  TEXT    NOT NULL DEFAULT '',
  class_id   TEXT    NOT NULL,
  class_name TEXT    NOT NULL DEFAULT '',
  bound_by   TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL,
  PRIMARY KEY (uid, school_id, class_id)
);
CREATE INDEX IF NOT EXISTS idx_ucb_class ON user_class_bindings(class_id);

-- ── 设备 ↔ 班级绑定（2026-10-04，「取代 CIMS」第一步）────────────────────────
-- 与上面 user_class_bindings（**人** ↔ 班级）正交：这张表管的是**机器**归哪个班。
--
-- 为什么必须落库：在此之前，"哪台机器在哪个班"只有 CIMS 的 /class/device-map 能回答；
-- 接入码消费成功只把 usedBy 写在码上，设备→班级**不落任何库**（事后查不到、不可审计）。
-- 一旦 CIMS 不可达，classOfDevice 直接返 null，面板就"不知道机器在哪班"。
-- 现在站点自持这条映射：登记为准、可审计、CIMS 仅作兜底 —— 为"机器归班不再依赖
-- CIMS 在线"打底。本表只做**登记**（记录事实），不做**准入**（不拦截未登记的设备）。
--
-- uid 直接作主键：一台机器只能归一个班，重复激活 = 改归属（幂等 upsert）。
-- display_name 是管理员给机器起的"好认的名字"（如"高三3班讲台机"），空串则回落班级名。
CREATE TABLE IF NOT EXISTS device_bindings (
  uid          TEXT PRIMARY KEY,
  school_id    TEXT NOT NULL DEFAULT '',
  class_id     TEXT NOT NULL DEFAULT '',
  class_name   TEXT NOT NULL DEFAULT '',
  bound_by     TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_device_bindings_class ON device_bindings(class_id);

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

-- 功能开关（per-user 能力位，2026-09-26）：「谁能用哪个功能」的唯一裁决点在服务端。
--
-- 为什么不放前端判：前端判权限等于把门禁画在门上，改一行 JS 就全开。
-- 这里存的只是**覆盖值**（true=强制开 / false=强制关 / 缺省=按角色默认），
-- 角色默认值仍由 permissions.ts 的矩阵算出，两者叠加才是最终能力位。
-- uid 是 users.id 的文本形式（不是设备 uid —— 管的是「人」，不是「机器」）。
CREATE TABLE IF NOT EXISTS user_features (
  uid        TEXT PRIMARY KEY,
  flags      TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);

-- 任务级回执（2026-09-26）：操控端「点了一个动作」→ 被控端「做完了」→ 结果回到这一个点上。
--
-- 为什么不够用 device_events：那条表是流水，面板只能拿"最近一条截图事件"去猜
-- 这次点击的结果 —— 点了两次截图，分不清哪张是哪次的。task_id 让"这次点击"
-- 和"那次上报"对得上号，也让"点了但一直没回"能超时判死，而不是永远转圈。
CREATE TABLE IF NOT EXISTS device_tasks (
  task_id    TEXT PRIMARY KEY,
  uid        TEXT    NOT NULL,              -- 目标设备 uid
  kind       TEXT    NOT NULL,              -- screenshot|notify|file|restart|…
  actor      TEXT    NOT NULL DEFAULT '',    -- 谁点的（留痕，出问题能问到人）
  state      TEXT    NOT NULL DEFAULT 'pending',  -- pending|done|failed|timeout
  result     TEXT    NOT NULL DEFAULT '',    -- 人话结果（存到哪了 / 为什么失败）
  extra      TEXT    NOT NULL DEFAULT '',    -- JSON 补充（capture_id、notice_id…）
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_uid ON device_tasks(uid, created_at);
CREATE INDEX IF NOT EXISTS idx_task_state ON device_tasks(state, created_at);

-- ============================================================================
-- 个人附件库 / 图床（用户自己的文件仓库）
-- 设计铁律：
--   1) 一切文件都带 owner_id，**每一次读写都必须按 owner 过滤**——隔离是靠查询条件保证的，
--      不是靠"约定"；后台跨账号管理是唯一例外，且必须显式走管理员路径（admin/library）。
--   2) 对象实体在 Cloudflare R2（见 lib/server/storage/r2.ts），表只存元数据 + 存储键。
--      表是元数据真源，R2 里的对象可以重建、可以换域名，元数据丢了才真丢。
--   3) 文件夹可无限层嵌套（parent_id 自引用）；删除文件夹时子文件夹一并带走。
-- ============================================================================
CREATE TABLE IF NOT EXISTS attachment_folders (
  id         TEXT    PRIMARY KEY,
  owner_id   INTEGER NOT NULL,
  parent_id  TEXT,
  name       TEXT    NOT NULL,
  -- general=普通目录 / avatar=头像专用 / imagehub=图床推荐展示
  purpose    TEXT    NOT NULL DEFAULT 'general',
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_folders_owner ON attachment_folders(owner_id, parent_id);

CREATE TABLE IF NOT EXISTS attachments (
  id             TEXT    PRIMARY KEY,
  owner_id       INTEGER NOT NULL,
  folder_id      TEXT,
  filename       TEXT    NOT NULL,
  storage_key    TEXT    NOT NULL,   -- R2 内的对象键（也是本文件在存储里的唯一坐标）
  url            TEXT    NOT NULL,   -- 可公开访问的外链
  mime           TEXT    NOT NULL DEFAULT 'application/octet-stream',
  bytes          INTEGER NOT NULL DEFAULT 0,
  sha256         TEXT    NOT NULL DEFAULT '',
  width          INTEGER,             -- 仅图片
  height         INTEGER,
  is_image       INTEGER NOT NULL DEFAULT 0,
  -- 图片水印（默认开）：仅对图片生效
  watermark      INTEGER NOT NULL DEFAULT 1,
  -- 压缩产物：original=未动过 / avif / webp
  variant        TEXT    NOT NULL DEFAULT 'original',
  -- 一键压缩「保留原图」时，原图另存一份在这里，可随时还原
  original_key   TEXT    NOT NULL DEFAULT '',
  original_bytes INTEGER NOT NULL DEFAULT 0,
  purpose        TEXT    NOT NULL DEFAULT 'upload',   -- upload=附件库 / avatar=头像
  created_at     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_att_owner      ON attachments(owner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_att_folder     ON attachments(folder_id);
CREATE INDEX IF NOT EXISTS idx_att_owner_kind ON attachments(owner_id, is_image, created_at);

-- ── 课表 + 调课 + 作息（2026-10-05 · 定位 v2：课表按班、作息全校共用；调课/换课是核心）──────────
-- 定位：取代 CIMS ClassPlan（教室端读课表从此读这里）。三张表正交：
--   学校作息（节次时间）全校共用一张；课表每班一张（引用作息节次）；调课是课表之上的
--   变更流（含金量：换课/调课走申请→审批→生效，不是直接改课表）。
CREATE TABLE IF NOT EXISTS school_timetable (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id   TEXT NOT NULL DEFAULT '',          -- 多学校预留（默认 '' 单学校）
  period_no   INTEGER NOT NULL,                  -- 第几节（1 开始）
  name        TEXT NOT NULL DEFAULT '',          -- 节名（如"第一节"）
  start_time  TEXT NOT NULL DEFAULT '',          -- "08:00"
  end_time    TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  UNIQUE (school_id, period_no)
);
CREATE INDEX IF NOT EXISTS idx_tt_school ON school_timetable(school_id, sort_order);

CREATE TABLE IF NOT EXISTS class_schedules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id   TEXT NOT NULL DEFAULT '',
  class_id    TEXT NOT NULL,                     -- stelarith_classes.class_id
  weekday     INTEGER NOT NULL,                  -- 1-7（周一=1）
  period_no   INTEGER NOT NULL,                  -- 第几节（对齐 school_timetable.period_no）
  subject     TEXT NOT NULL DEFAULT '',          -- 科目名（中文，如"数学"）
  teacher     TEXT NOT NULL DEFAULT '',          -- 任课教师（显示名）
  remark      TEXT NOT NULL DEFAULT '',          -- 备注（教室/合班等）
  updated_at  TEXT NOT NULL,
  UNIQUE (school_id, class_id, weekday, period_no)
);
CREATE INDEX IF NOT EXISTS idx_sched_class ON class_schedules(school_id, class_id, weekday);

CREATE TABLE IF NOT EXISTS schedule_swaps (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id       TEXT NOT NULL DEFAULT '',
  class_id        TEXT NOT NULL,
  -- 原节（被调走的那节）
  from_weekday    INTEGER NOT NULL,
  from_period     INTEGER NOT NULL,
  -- 目标节（调去那节）
  to_weekday      INTEGER NOT NULL,
  to_period       INTEGER NOT NULL,
  reason          TEXT NOT NULL DEFAULT '',      -- 调课原因
  requested_by    TEXT NOT NULL DEFAULT '',      -- 申请人（显示名）
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | applied
  reviewed_by     TEXT NOT NULL DEFAULT '',      -- 审批人
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_swaps_class ON schedule_swaps(school_id, class_id, status);

-- 定时广播（2026-10-05 · 取代 CIMS scheduled-broadcast：站点自持调度，到点走自有 notify 通道）
CREATE TABLE IF NOT EXISTS scheduled_broadcasts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL DEFAULT '',
  schedule_type  TEXT NOT NULL DEFAULT 'once',   -- once | daily | weekly
  weekday        INTEGER,                         -- weekly 用 1-7
  run_at         TEXT NOT NULL DEFAULT '',        -- "HH:MM" 或 "YYYY-MM-DD HH:MM"
  target_class_id TEXT NOT NULL DEFAULT '',
  title          TEXT NOT NULL DEFAULT '',
  content        TEXT NOT NULL DEFAULT '',
  enabled        INTEGER NOT NULL DEFAULT 1,
  next_run_at    TEXT NOT NULL DEFAULT '',
  last_run_at    TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sched_bc ON scheduled_broadcasts(enabled, next_run_at);
`;

export function nowIso(): string {
	return new Date().toISOString();
}

function hashPassword(password: string, salt: string): string {
	return crypto.scryptSync(password, salt, 64).toString("hex");
}

function ensureDb(): DatabaseSync {
	if (_db) return _db;
	// 启动标识：一行说清"这次进程读的到底是哪个数据根"。
	// 见 docs/架构评估与落地路线.md 5.6 —— 一次启动只允许一个环境标识，
	// 且必须在**建库之前**打出来，否则出错时反而看不到自己连的是哪个库。
	console.log(describeDataLayout());
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
	// 个人空间「额外配额」（字节）。0/空 = 只用等级配额；管理员可在后台 /admin/library 赠送。
	if (!cols.has("quota_bonus_bytes")) db.exec("ALTER TABLE users ADD COLUMN quota_bonus_bytes INTEGER NOT NULL DEFAULT 0");

	// sessions.deadline（2026-09-27 安全网补强）：登录时限绝对截止。老行缺失则
	// 回填为 created_at + 30 天（与历史 SESSION_TTL_MS 语义一致），保证既有会话
	// 也有硬上限，不因「表结构变更」把旧会话变成永不过期。
	const scol = new Set(
		(db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map((c) => c.name)
	);
	if (!scol.has("deadline")) {
		db.exec("ALTER TABLE sessions ADD COLUMN deadline TEXT NOT NULL DEFAULT ''");
		db.exec(
			"UPDATE sessions SET deadline = datetime(created_at, '+30 days') WHERE deadline = '' OR deadline IS NULL"
		);
	}

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

// ───────────────────────────── SQLite 后端实现 ─────────────────────────────
// 进程内异步锁：把所有语句串成一条 Promise 链，等价于旧版「单线程同步」语义，
// 保证 BEGIN/COMMIT 事务不会被并发请求的语句交错（详见文件头注释）。
let _sqliteLock: Promise<unknown> = Promise.resolve();
function sqliteLocked<T>(fn: () => T | Promise<T>): Promise<T> {
	const run = _sqliteLock.then(fn, fn);
	// 无论成功失败都让锁继续向前，避免一次报错卡死后续所有语句。
	_sqliteLock = run.then(
		() => undefined,
		() => undefined
	);
	return run;
}

class SqliteBackend implements DbFacade {
	readonly backend = "sqlite" as const;
	private handle(): DatabaseSync {
		return ensureDb();
	}
	prepare(sql: string): Stmt {
		const stmt = this.handle().prepare(sql);
		return {
			get: async (...params: unknown[]) =>
				await sqliteLocked(() => stmt.get(...(params as unknown as Parameters<typeof stmt.get>)) as DbRow | undefined),
			all: async (...params: unknown[]) =>
				await sqliteLocked(() => stmt.all(...(params as unknown as Parameters<typeof stmt.all>)) as DbRow[]),
			run: async (...params: unknown[]) => {
				const r = await sqliteLocked(() => stmt.run(...(params as unknown as Parameters<typeof stmt.run>)) as RunResult);
				return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) };
			}
		};
	}
	async exec(sql: string): Promise<void> {
		await sqliteLocked(() => {
			this.handle().exec(sql);
		});
	}
	raw(): DatabaseSync {
		return this.handle();
	}
}

// ───────────────────────────── SQL 方言翻译（SQLite → PostgreSQL）─────────────────────────────
// 单趟扫描：跳过字符串字面量；? → $n；INSERT OR IGNORE → ON CONFLICT DO NOTHING；
// GROUP_CONCAT(expr[, sep]) → string_agg(expr::text, sep)；datetime(X, '+N days') → 时间戳区间；
// COUNT(*) → COUNT(*)::int（pg 的 bigint 会变成 JS string，统一转 int 保住 number 语义）。

interface PgSql {
	text: string;
	insertIgnore: boolean;
}

function translateToPg(sql: string): PgSql {
	let out = "";
	let i = 0;
	let n = 0;
	let insertIgnore = false;
	while (i < sql.length) {
		const rest = sql.slice(i);
		if (sql[i] === "'") {
			let j = i + 1;
			while (j < sql.length) {
				if (sql[j] === "'") {
					if (sql[j + 1] === "'") { j += 2; continue; }
					break;
				}
				j++;
			}
			out += sql.slice(i, j + 1);
			i = j + 1;
			continue;
		}
		const ignore = rest.match(/^INSERT\s+OR\s+IGNORE\s+INTO/i);
		if (ignore) {
			out += "INSERT INTO";
			i += ignore[0].length;
			insertIgnore = true;
			continue;
		}
		if (/^GROUP_CONCAT\(/i.test(rest)) {
			const open = rest.indexOf("(");
			let depth = 0;
			let k = open;
			for (; k < rest.length; k++) {
				if (rest[k] === "(") depth++;
				else if (rest[k] === ")") { depth--; if (depth === 0) break; }
			}
			const inner = rest.slice(open + 1, k);
			let d2 = 0;
			let inS = false;
			let split = -1;
			for (let x = 0; x < inner.length; x++) {
				const c = inner[x];
				if (c === "'") inS = !inS;
				else if (!inS) {
					if (c === "(") d2++;
					else if (c === ")") d2--;
					else if (c === "," && d2 === 0) { split = x; break; }
				}
			}
			const expr = (split >= 0 ? inner.slice(0, split) : inner).trim();
			const sep = split >= 0 ? inner.slice(split + 1).trim() : "','";
			out += `string_agg(${expr}::text, ${sep})`;
			i += k + 1;
			continue;
		}
		const dt = rest.match(/^datetime\(\s*([^,()]+?)\s*,\s*'([+-])\s*(\d+)\s+([a-z]+)'\s*\)/i);
		if (dt) {
			out += `(${dt[1].trim()}::timestamp ${dt[2]} interval '${dt[3]} ${dt[4]}')`;
			i += dt[0].length;
			continue;
		}
		const cnt = rest.match(/^COUNT\(\s*\*\s*\)/i);
		if (cnt) {
			out += "COUNT(*)::int";
			i += cnt[0].length;
			continue;
		}
		if (sql[i] === "?") {
			out += "$" + ++n;
			i++;
			continue;
		}
		out += sql[i];
		i++;
	}
	return { text: out, insertIgnore };
}

/** SQLite DDL → PG DDL 静态转换（SCHEMA 类型面仅 TEXT/INTEGER/REAL + AUTOINCREMENT + REFERENCES）。 */
function transformSchemaToPg(schema: string): string {
	return schema.replace(
		/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi,
		"INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY"
	).replace(/\bBLOB\b/gi, "BYTEA");
}

function collectIdentityTables(pgSchema: string): Set<string> {
	const set = new Set<string>();
	for (const m of pgSchema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\);/g)) {
		if (/GENERATED BY DEFAULT AS IDENTITY/i.test(m[2])) set.add(m[1].toLowerCase());
	}
	return set;
}

// ───────────────────────────── PostgreSQL 后端实现 ─────────────────────────────
// 单 Client + 进程内串行队列：与 SQLite 门面等价的「语句串行」语义，
// 保证 BEGIN/COMMIT 事务不被并发请求交错（与 SqliteBackend 的锁同一原理）。
class PgBackend implements DbFacade {
	readonly backend = "pg" as const;
	private client: PgClient | null = null;
	private ready: Promise<void> | null = null;
	private identity = new Set<string>();
	private queue: Promise<unknown> = Promise.resolve();

	private async ensure(): Promise<void> {
		if (this.client) {
			await this.ready;
			return;
		}
		this.ready = (async () => {
			const dsn = process.env.DATABASE_URL;
			if (!dsn) throw new Error("DB_BACKEND=pg 需要设置 DATABASE_URL（postgres://user:pass@host:5432/db）");
			const { Client } = await import("pg");
			const client = new Client({ connectionString: dsn });
			await client.connect();
			const pgSchema = transformSchemaToPg(SCHEMA);
			await client.query(pgSchema);
			// 列迁移：与 SQLite ensureDb 的 PRAGMA 探测迁移同集（SCHEMA 本体不含这些历史加列）。
			// PG 直接用 ADD COLUMN IF NOT EXISTS，幂等。
			await client.query(`
				ALTER TABLE users            ADD COLUMN IF NOT EXISTS verified           INTEGER NOT NULL DEFAULT 0;
				ALTER TABLE users            ADD COLUMN IF NOT EXISTS verify_token       TEXT    NOT NULL DEFAULT '';
				ALTER TABLE users            ADD COLUMN IF NOT EXISTS verify_token_expires TEXT  NOT NULL DEFAULT '';
				ALTER TABLE users            ADD COLUMN IF NOT EXISTS class_name         TEXT    NOT NULL DEFAULT '';
				ALTER TABLE users            ADD COLUMN IF NOT EXISTS grade_name         TEXT    NOT NULL DEFAULT '';
				ALTER TABLE users            ADD COLUMN IF NOT EXISTS xp                 INTEGER NOT NULL DEFAULT 0;
				ALTER TABLE users            ADD COLUMN IF NOT EXISTS quota_bonus_bytes  INTEGER NOT NULL DEFAULT 0;
				ALTER TABLE sessions         ADD COLUMN IF NOT EXISTS deadline           TEXT    NOT NULL DEFAULT '';
				ALTER TABLE console_notices  ADD COLUMN IF NOT EXISTS classes            TEXT    NOT NULL DEFAULT '';
				ALTER TABLE console_notices  ADD COLUMN IF NOT EXISTS channel            TEXT    NOT NULL DEFAULT '';
				ALTER TABLE console_notices  ADD COLUMN IF NOT EXISTS type               TEXT    NOT NULL DEFAULT 'notice';
				ALTER TABLE console_notices  ADD COLUMN IF NOT EXISTS flags              TEXT    NOT NULL DEFAULT '';
				ALTER TABLE notice_deliveries ADD COLUMN IF NOT EXISTS reply             TEXT    NOT NULL DEFAULT '';
				ALTER TABLE console_audit    ADD COLUMN IF NOT EXISTS prev_hash          TEXT    NOT NULL DEFAULT '';
				ALTER TABLE console_audit    ADD COLUMN IF NOT EXISTS row_hash           TEXT    NOT NULL DEFAULT '';
				UPDATE users SET verified = 1 WHERE status = 'active' AND verified = 0;
			`);
			this.identity = collectIdentityTables(pgSchema);
			await seedPg(client);
			this.client = client;
			console.log("[db] PostgreSQL 后端已就绪（SCHEMA 已确保，自增表", this.identity.size, "张）");
		})();
		try {
			await this.ready;
		} catch (err) {
			this.ready = null; // 允许修复配置后重试
			throw err;
		}
	}

	private async run<T>(fn: (c: PgClient) => Promise<T>): Promise<T> {
		await this.ensure();
		const prev = this.queue;
		const task = prev.then(() => fn(this.client as PgClient));
		this.queue = task.then(
			() => undefined,
			() => undefined
		);
		return task;
	}

	prepare(sql: string): Stmt {
		return {
			get: async (...params: unknown[]) => {
				const res = await this.run((c) => c.query(translateToPg(sql).text, params as never[]));
				return res.rows[0] as DbRow | undefined;
			},
			all: async (...params: unknown[]) => {
				const res = await this.run((c) => c.query(translateToPg(sql).text, params as never[]));
				return res.rows as DbRow[];
			},
			run: async (...params: unknown[]) => {
				const t = translateToPg(sql);
				let text = t.text + (t.insertIgnore ? " ON CONFLICT DO NOTHING" : "");
				const m = text.match(/^\s*INSERT\s+INTO\s+"?(\w+)"?/i);
				const isIdentity =
					!!m && this.identity.has(m[1].toLowerCase()) && !/RETURNING/i.test(text);
				if (isIdentity) text = text.replace(/;\s*$/, "") + " RETURNING id";
				const res = await this.run((c) => c.query(text, params as never[]));
				const row = res.rows?.[0] as { id?: number | string } | undefined;
				return { changes: res.rowCount ?? 0, lastInsertRowid: Number(row?.id ?? 0) };
			}
		};
	}

	async exec(sql: string): Promise<void> {
		const t = translateToPg(sql);
		await this.run((c) => c.query(t.text + (t.insertIgnore ? " ON CONFLICT DO NOTHING" : "")));
	}
}

/** PG 首次播种：与 SQLite seed 同逻辑（users.json 迁移 → admin 引导）。 */
async function seedPg(client: PgClient): Promise<void> {
	const row = (await client.query("SELECT COUNT(*)::int AS n FROM users")).rows[0] as { n: number };
	if (row && row.n > 0) return;

	// ① 迁移旧 JSON 用户（保留原哈希与 salt，密码继续有效）
	if (fs.existsSync(USERS_JSON)) {
		try {
			const raw = JSON.parse(fs.readFileSync(USERS_JSON, "utf-8"));
			const list: unknown[] = Array.isArray(raw) ? raw : (raw as { users?: unknown[] }).users || [];
			let n = 0;
			const ts = nowIso();
			for (const u of list) {
				const rec = u as { username?: string; passwordHash?: string; salt?: string; displayName?: string; role?: string; createdAt?: string };
				if (!rec?.username || !rec?.passwordHash || !rec?.salt) continue;
				await client.query(
					`INSERT INTO users
					 (username, display_name, email, avatar, bio, role, status, password_hash, salt, created_at, updated_at, login_count)
					 VALUES ($1, $2, '', '', '', $3, 'active', $4, $5, $6, $7, 0)
					 ON CONFLICT (username) DO NOTHING`,
					[
						String(rec.username),
						String(rec.displayName || rec.username),
						String(rec.role || "user"),
						String(rec.passwordHash),
						String(rec.salt),
						String(rec.createdAt || ts),
						ts
					]
				);
				n++;
			}
			if (n > 0) {
				console.log(`[db] 已从 users.json 迁移 ${n} 个账号到 PostgreSQL。`);
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
	await client.query(
		`INSERT INTO users (username, display_name, email, avatar, bio, role, status, password_hash, salt, created_at, updated_at, login_count)
		 VALUES ('admin', '管理员', '', '', '', 'admin', 'active', $1, $2, $3, $3, 0)`,
		[hashPassword(seedPassword, salt), salt, ts]
	);
	if (generated) {
		console.log(`[auth] 已初始化管理员账号 admin，随机生成的初始密码：${seedPassword}`);
		console.log("[auth] 此密码仅显示一次，请登录后立即修改。也可通过环境变量 ADMIN_PASSWORD 预设。");
	}
}

let _facade: DbFacade | null = null;

function createFacade(): DbFacade {
	const backend = (process.env.DB_BACKEND ?? "sqlite").trim().toLowerCase();
	switch (backend) {
		case "":
		case "sqlite":
			return new SqliteBackend();
		case "pg":
		case "postgres":
		case "postgresql":
			return new PgBackend();
		default:
			throw new Error(`未知 DB_BACKEND: ${backend}（仅支持 sqlite / pg）`);
	}
}

/** 取统一数据访问门面（同步返回；prepare/exec 的具体调用需 await）。 */
export function getDb(): DbFacade {
	if (!_facade) _facade = createFacade();
	return _facade;
}

/** 导出供 auth 复用，避免重复实现。 */
export { hashPassword };
