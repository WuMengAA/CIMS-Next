/**
 * 2028届八班网站 · 数据层（class8_* 独立表，不侵入主库 SCHEMA）。
 *
 * 通过独立的 ensureClass8Schema() 在启动时调用一次建表（幂等）。
 * 所有表以 class8_ 前缀，避免与主站 users/sessions 等冲突。
 */
import { getDb } from "../db.js";

const CLASS8_SCHEMA = `
CREATE TABLE IF NOT EXISTS class8_profile (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  slug       TEXT NOT NULL DEFAULT '2028/8',
  class_name TEXT NOT NULL DEFAULT '2028届8班',
  slogan     TEXT NOT NULL DEFAULT '',
  concept    TEXT NOT NULL DEFAULT '',
  intro      TEXT NOT NULL DEFAULT '',
  teacher    TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS class8_groups (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  seq       INTEGER NOT NULL DEFAULT 0,
  name      TEXT NOT NULL DEFAULT '',
  goal      TEXT NOT NULL DEFAULT '',
  readonly  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS class8_members (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL DEFAULT 0,
  seq      INTEGER NOT NULL DEFAULT 0,
  name     TEXT NOT NULL DEFAULT '',
  role     TEXT NOT NULL DEFAULT '',
  motto    TEXT NOT NULL DEFAULT '',
  seat     TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS class8_exams (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_date  TEXT NOT NULL DEFAULT '',
  title      TEXT NOT NULL DEFAULT '',
  seq        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS class8_scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id    INTEGER NOT NULL DEFAULT 0,
  group_id   INTEGER NOT NULL DEFAULT 0,
  member_id  INTEGER NOT NULL DEFAULT 0,
  subject    TEXT NOT NULL DEFAULT '',
  score      REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS class8_stars (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  month    TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  subject  TEXT NOT NULL DEFAULT '',
  reason   TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS class8_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        TEXT NOT NULL DEFAULT '',
  title     TEXT NOT NULL DEFAULT '',
  body      TEXT NOT NULL DEFAULT ''
);


CREATE TABLE IF NOT EXISTS class8_leaders (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  seq     INTEGER NOT NULL DEFAULT 0,
  subject TEXT NOT NULL DEFAULT '',
  name    TEXT NOT NULL DEFAULT '',
  icon    TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS class8_rank (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  seq        INTEGER NOT NULL DEFAULT 0,
  group_name TEXT NOT NULL DEFAULT '',
  avg        REAL NOT NULL DEFAULT 0,
  honor      TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS class8_changelog (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  at     TEXT NOT NULL DEFAULT '',
  actor  TEXT NOT NULL DEFAULT '',
  op     TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS class8_culture_spots (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  key      TEXT NOT NULL DEFAULT '',
  title    TEXT NOT NULL DEFAULT '',
  slogan   TEXT NOT NULL DEFAULT '',
  body     TEXT NOT NULL DEFAULT ''
);
`;

let _done = false;

/** 幂等：建 class8 全部表（启动时调用一次）。 */
export function ensureClass8Schema() {
  if (_done) return;
  const db = getDb();
  db.exec(CLASS8_SCHEMA);
  db.exec(`INSERT OR IGNORE INTO class8_profile (id) VALUES (1)`);
  // 点位微文化默认（空则填充，幂等）
  const spotN = (db.prepare("SELECT COUNT(*) AS n FROM class8_culture_spots").get() as { n: number }).n;
  if (spotN === 0) {
    const insSt = db.prepare("INSERT INTO class8_culture_spots (key,title,slogan,body) VALUES (?,?,?,?)");
    const spots = [
      ["entry", "进门宣传栏", "入室即静，入座即学", "班级名称·口号·理念·公约。由全体同学共同讨论制定。"],
      ["water", "饮水处", "饮水思源", "珍惜水资源，节约每一滴水。"],
      ["south_wall", "侧墙·小组文化区", "小组自治", "各小组名称、成员、学科小组长、共同发展目标，落实自主管理。"],
      ["ac", "空调旁", "节约用电", "安全使用电器，人走断电。"],
      ["back_wall", "后墙·成长看板", "慢一点没关系，持续记录", "学业追踪·月度星光榜·目标宣言墙·班级大事记，磁吸按月更新。"],
      ["hygiene", "卫生角", "扫帚簸箕有其家，干净有序靠大家", "工具归位，分区分片，值日尽责。"],
      ["north_wall", "侧墙·靶向标语区", "入室即静，入座即学", "结合本班现阶段突出问题选取标语，动态调整。"]
    ];
    for (const s of spots) insSt.run(s[0], s[1], s[2], s[3]);
  }

  // ── 幂等加列（2028-09-29：展板数据字段）──
  function ensureColumn(table: string, column: string, ddl: string) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
  ensureColumn("class8_profile", "quote", "quote TEXT NOT NULL DEFAULT ''");
  ensureColumn("class8_profile", "subtitle", "subtitle TEXT NOT NULL DEFAULT ''");
  ensureColumn("class8_groups", "emoji", "emoji TEXT NOT NULL DEFAULT ''");
  ensureColumn("class8_events", "photos", "photos TEXT NOT NULL DEFAULT '[]'");
  _done = true;
}
