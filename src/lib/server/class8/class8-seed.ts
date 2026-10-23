/**
 * 2028届八班网站 · 测试种子数据（占位，后续由班主任在后台覆盖）。
 *
 * 8 个小组、52 名同学（人数有出入，预留空位）；1 次考试 × 9 学科成绩。
 */
import { getDb } from "../db.js";
import { ensureClass8Schema } from "./class8-db.js";

const GROUP_NAMES = ["青竹组", "星火组", "澜溪组", "破晓组", "砺行组", "拾光组", "远航组", "晴岚组"];
const GROUP_GOALS = [
  "组内互查作业，月考小组均分进前三",
  "每周一次小组复盘，消灭薄弱学科",
  "结对帮扶，不让一个人掉队",
  "早读齐到，晚自习零走动",
  "错题共享，建立小组错题本",
  "课堂发言人均每周三次",
  "英语单词打卡全组满勤",
  "理综实验题专项突破"
];
const SUBJECTS = ["语文", "数学", "英语", "物理", "化学", "生物", "政治", "历史", "地理"];
// 考试次数：2026-10-22 用户要求 4→1。保留「第一次月考」。
const EXAMS = [
  { title: "第一次月考", exam_date: "2026-09-12", seq: 1 }
];
/** 组内人数分布（合计 52）：6,7,6,7,6,6,7,7 */
const SIZES = [6, 7, 6, 7, 6, 6, 7, 7];

async function pad(n: number): Promise<string> { return n < 10 ? "0" + n : String(n); }

let _seeded = false;

/** 幂等种子：仅在小组表为空时写入。 */
export async function seedClass8IfEmpty(): Promise<void> {
  if (_seeded) return;
  await ensureClass8Schema();
  const db = getDb();
  const n = (await db.prepare("SELECT COUNT(*) AS n FROM class8_groups").get() as { n: number }).n;
  if (n > 0) { _seeded = true; return; }

  await db.prepare("UPDATE class8_profile SET class_name=?, slogan=?, concept=?, intro=?, teacher=? WHERE id=1").run(
    "2028届8班",
    "励思笃行，八班同行，格物拓疆，聚力争强",
    "环境育人 · 可视化管理 · 小组自治 · 目标驱动",
    "高二上学期，我们以小组为单元、以成长看板为镜，把每一天的努力显性化。（当前为测试占位内容）",
    "待填写"
  );

  const insG = await db.prepare("INSERT INTO class8_groups (seq, name, goal) VALUES (?,?,?)");
  const insM = await db.prepare("INSERT INTO class8_members (group_id, seq, name, role, motto, seat) VALUES (?,?,?,?,?,?)");
  const insE = await db.prepare("INSERT INTO class8_exams (exam_date, title, seq) VALUES (?,?,?)");
  const insS = await db.prepare("INSERT INTO class8_scores (exam_id, group_id, member_id, subject, score) VALUES (?,?,?,?,?)");

  let idx = 0;
  const gids: number[] = [];
  for (let g = 0; g < GROUP_NAMES.length; g++) {
    const r = await insG.run(g + 1, GROUP_NAMES[g], GROUP_GOALS[g]);
    gids.push(Number(r.lastInsertRowid));
  }
  const mids: number[][] = [];
  for (let g = 0; g < SIZES.length; g++) {
    const arr: number[] = [];
    for (let i = 0; i < SIZES[g]; i++) {
      idx++;
      const role = i === 0 ? "组长" : (i === 1 ? "学科小组长" : "组员");
      const r = await insM.run(gids[g], i + 1, "示例同学" + await pad(idx), role, "座右铭待填写", "座位待填写");
      arr.push(Number(r.lastInsertRowid));
    }
    mids.push(arr);
  }

  const eids: number[] = [];
  for (const e of EXAMS) {
    const r = await insE.run(e.exam_date, e.title, e.seq);
    eids.push(Number(r.lastInsertRowid));
  }

  let s = 20280927;
  async function rnd(): Promise<number> { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }
  for (let ei = 0; ei < eids.length; ei++) {
    for (let g = 0; g < mids.length; g++) {
      const gBias = (g - 3.5) * 0.9 + (ei * 0.6);
      for (const mid of mids[g]) {
        for (const sub of SUBJECTS) {
          const base = 72 + await rnd() * 18 + gBias;
          const v = Math.max(48, Math.min(99, Math.round(base * 10) / 10));
          await insS.run(eids[ei], gids[g], mid, sub, v);
        }
      }
    }
  }

  const insStar = await db.prepare("INSERT INTO class8_stars (month, category, subject, reason) VALUES (?,?,?,?)");
  await insStar.run("2026-09", "学业进步", "示例同学03", "月考较入学提升明显（占位）");
  await insStar.run("2026-09", "作业优秀", "示例同学11", "连续三周作业全优（占位）");
  await insStar.run("2026-09", "值日尽责", "示例同学22", "卫生角整理标杆（占位）");
  await insStar.run("2026-09", "互助奉献", "示例同学35", "课后为同学讲题多次（占位）");
  await insStar.run("2026-10", "学业进步", "示例同学41", "小组均分进步最快（占位）");
  await insStar.run("2026-10", "课堂活跃", "示例同学17", "课堂发言次数第一（占位）");

  const insEv = await db.prepare("INSERT INTO class8_events (at, title, body) VALUES (?,?,?)");
  await insEv.run("2026-09-01", "开学第一课", "明确高二目标，启动小组自治机制。（占位）");
  await insEv.run("2026-09-10", "教师节主题班会", "为老师制作手写贺卡，班级合影留念。（占位）");
  await insEv.run("2026-09-25", "班级文化建设启动", "全班讨论班级名称、口号、理念与公约。（占位）");
  await insEv.run("2026-10-08", "国庆后阵地布置", "宣传栏、侧墙、后墙、点位标语全部上墙。（占位）");
  await insEv.run("2026-10-20", "校级验收", "学生讲解员按路线逐区介绍，获评优秀班级。（占位）");

  _seeded = true;
}

/**
 * 2028届八班 · 真实数据导入（2028-09-29）
 * 检测到占位数据（示例同学 / 占位组名）→ 重置小组/成员/星光/大事记，
 * 灌入班主任提供的真实 50 人名单、8 组、7 位学科领航人、官方排名与寄语。
 * 幂等：leaders/rank 已存在则跳过；重跑安全。
 */
export async function ensureRealClass8Data(): Promise<void> {
  await ensureClass8Schema();
  const db = getDb();
  const isPlaceholder = (await db.prepare("SELECT COUNT(*) AS n FROM class8_members WHERE name LIKE '%示例%'").get() as { n: number }).n > 0;

  if (isPlaceholder) {
    await db.exec("DELETE FROM class8_groups; DELETE FROM class8_members; DELETE FROM class8_scores; DELETE FROM class8_stars; DELETE FROM class8_events;");
  }

  // 组 + 成员（若占位被清空则重灌；否则保持现状不覆盖）
  const gCount = (await db.prepare("SELECT COUNT(*) AS n FROM class8_groups").get() as { n: number }).n;
  if (gCount === 0) {
    const REAL_GROUPS: { emoji: string; name: string; goal: string; leader: string; members: string[] }[] = [
      { emoji: "🔥", name: "光宗耀组", goal: "组内互查作业，月考小组均分进前三", leader: "胡宇鹏", members: ["徐佳恒", "刘梓湘", "杨姿涵", "李佳妮", "李思怡", "焦天赐", "胡宇鹏"] },
      { emoji: "🌧️", name: "风雨无组", goal: "风雨无阻，全员满勤", leader: "", members: ["陈昊泽", "罗怡冉", "张思远", "王嘉宁", "秦梓涵", "王璐彤"] },
      { emoji: "🏆", name: "名门望组", goal: "结对帮扶，不让一个人掉队", leader: "", members: ["张跃航", "史雨欣", "徐俊东", "任乔安", "元胜杰", "李昱莹"] },
      { emoji: "🪶", name: "少羽组", goal: "错题共享，建立小组错题本", leader: "张鹏俊", members: ["张鹏俊", "宋薇", "温涵瑞", "刘赵哲", "吕梦欣", "刘奕洋"] },
      { emoji: "💎", name: "琢玉组", goal: "如琢如磨，精进不止", leader: "", members: ["何奥杰", "李欣茹", "秦琳清", "张梦佳", "任梓涵", "董雯玉"] },
      { emoji: "🙏", name: "如来佛组", goal: "课堂发言人均每周三次", leader: "杨智杰", members: ["雷艺涵", "徐欣然", "王馨雨", "东祎璐", "杨智杰", "董昊燃", "杨玉辉"] },
      { emoji: "🧠", name: "没哲组", goal: "英语单词打卡全组满勤", leader: "", members: ["杨家辉", "魏宁宁", "高慧妍", "耿子杰", "刘腾飞", "孙浩楠"] },
      { emoji: "✨", name: "无言组", goal: "与光同尘，行者无疆", leader: "王博泽", members: ["王博泽", "麻皓哲", "陈嘉威", "李昊轩", "高怡鑫", "雷超越"] }
    ];
    const insG = await db.prepare("INSERT INTO class8_groups (seq, name, goal, emoji) VALUES (?,?,?,?)");
    const insM = await db.prepare("INSERT INTO class8_members (group_id, seq, name, role, motto, seat) VALUES (?,?,?,?,?,?)");
    REAL_GROUPS.forEach(async function (g, gi) {
      const r = await insG.run(gi + 1, g.name, g.goal, g.emoji);
      const gid = Number(r.lastInsertRowid);
      g.members.forEach(async function (m, mi) {
        const isLeader = m === g.leader;
        await insM.run(gid, mi + 1, m, isLeader ? "组长" : (mi === 1 ? "学科小组长" : "组员"), "", "");
      });
    });

    // 重建占位成绩（真实组名，9 学科 × 4 考试，供学业曲线可视化；可在后台逐科覆盖）
    const SUBJECTS = ["语文", "数学", "英语", "物理", "化学", "生物", "政治", "历史", "地理"];
    const gids = (await db.prepare("SELECT id FROM class8_groups ORDER BY seq").all() as { id: number }[]).map(function (x) { return x.id; });
    const mids = (await db.prepare("SELECT id, group_id FROM class8_members ORDER BY id").all() as { id: number; group_id: number }[]);
    const exams = (await db.prepare("SELECT id FROM class8_exams ORDER BY seq").all() as { id: number }[]);
    let s = 20280927;
    function rnd(): number { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }
    const gBias: Record<number, number> = {};
    gids.forEach(function (id, i) { gBias[id] = (i - 3.5) * 0.9; });
    const insS = await db.prepare("INSERT INTO class8_scores (exam_id, group_id, member_id, subject, score) VALUES (?,?,?,?,?)");
    exams.forEach(async function (e) {
      gids.forEach(function (gid) {
        mids.filter(function (m) { return m.group_id === gid; }).forEach(function (m) {
          SUBJECTS.forEach(async function (sub) {
            const base = 72 + await rnd() * 18 + (gBias[gid] || 0);
            const v = Math.max(48, Math.min(99, Math.round(base * 10) / 10));
            await insS.run(e.id, gid, m.id, sub, v);
          });
        });
      });
    });
  }

  // 旧种子清理（一次性、幂等）：2026-10-22 用户要求考试次数 4→1。
  // 精准删早先 4-考试种子里多出的「期中/二考/期末」，只留「第一次月考」；
  // 按 title 删，不影响后台后续新增的考试（不会误锁成 1 条）。
  for (const t of ["期中考试", "第二次月考", "期末考试"]) {
    const rows = (await db.prepare("SELECT id FROM class8_exams WHERE title=?").all(t) as { id: number }[]);
    for (const row of rows) {
      await db.prepare("DELETE FROM class8_scores WHERE exam_id=?").run(row.id);
      await db.prepare("DELETE FROM class8_exams WHERE id=?").run(row.id);
    }
  }

  // 档案：真实寄语 / 副标题
  await db.prepare("UPDATE class8_profile SET class_name='2028届8班', slogan='励思笃行，八班同行，格物拓疆，聚力争强', concept='环境育人 · 小组自治 · 目标驱动 · 可视记录', intro='高二八班，以小组为单元、以成长看板为镜，把每一天的努力显性化。', teacher='待填写', quote='一朵花独绽不是春天，百花齐放才是春色满园。高二八班，不比基础比进步，不比聪明比勤奋！', subtitle='小组风采展' WHERE id=1").run();

  // 学科领航人（幂等：空则灌）
  if ((await db.prepare("SELECT COUNT(*) AS n FROM class8_leaders").get() as { n: number }).n === 0) {
    const insL = await db.prepare("INSERT INTO class8_leaders (seq, subject, name, icon) VALUES (?,?,?,?)");
    [["语文", "胡宇鹏", "📖"], ["数学", "王博泽", "🧮"], ["英语", "董昊燃", "🔤"], ["俄语", "杨智杰", "🇷🇺"], ["地理", "李昊轩", "🌍"], ["物理", "雷超越", "⚡"], ["化学", "张鹏俊", "🧪"]].forEach(async function (l, i) { await insL.run(i + 1, l[0], l[1], l[2]); });
  }

  // 官方排名（幂等：空则灌）
  if ((await db.prepare("SELECT COUNT(*) AS n FROM class8_rank").get() as { n: number }).n === 0) {
    const insR = await db.prepare("INSERT INTO class8_rank (seq, group_name, avg, honor) VALUES (?,?,?,?)");
    [["无言组", 407.83, "独占鳌头"], ["光宗耀组", 366.5, "名列前茅"], ["没哲组", 355.42, "稳扎稳打"], ["少羽组", 345.67, "锐意进取"], ["风雨无组", 345.42, "潜力无限"], ["名门望组", 343.5, "奋起直追"], ["如来佛组", 315.36, "蓄势待发"], ["琢玉组", 305.33, "破茧成蝶"]].forEach(async function (r, i) { await insR.run(i + 1, r[0], r[1], r[2]); });
  }

  // 初始 changelog（幂等）
  if ((await db.prepare("SELECT COUNT(*) AS n FROM class8_changelog").get() as { n: number }).n === 0) {
    await db.prepare("INSERT INTO class8_changelog (at, actor, op, detail) VALUES (?,?,?,?)")
      .run(new Date().toISOString().slice(0, 19).replace("T", " "), "system", "import", "导入真实班级数据：50 人 / 8 组 / 7 领航人 / 官方排名 / 寄语");
  }
}

// ── 运动会时间轴（2026 春/秋，真实照片，幂等）──
export async function ensureSportsTimeline(): Promise<void> {
  await ensureClass8Schema();
  const db = getDb();
  const has = (await db.prepare("SELECT COUNT(*) AS n FROM class8_events WHERE title LIKE '%运动会%'").get() as { n: number }).n;
  if (has > 0) return;
  const ins = await db.prepare("INSERT INTO class8_events (at, title, body, photos) VALUES (?,?,?,?)");
  const SP = "/campus/2028/class8/sports/";
  const evs = [
    {
      at: "2026-10", title: "咸林中学2026秋季运动会 · 高二八班",
      body: "女子4×400接力：第五名\n女子4×100接力：第三名 🥉\n男子4×100接力：第六名",
      photos: [
        { src: SP + "mmexport1790763655871.jpg", caption: "女子4×400接力 · 教室合影" },
        { src: SP + "mmexport1790763718764.jpg", caption: "女子4×400接力 · 主席台合影" },
        { src: SP + "mmexport1790763678438.jpg", caption: "女子4×100接力 · 教室合影" },
        { src: SP + "mmexport1790763702534.jpg", caption: "男子4×100接力 · 教室合影" },
        { src: SP + "mmexport1790763727846.jpg", caption: "男子4×100接力 · 主席台合影" }
      ]
    },
    {
      at: "2026-04", title: "咸林中学2026春季运动会 · 高一八班",
      body: "男子4×100接力：第六名",
      photos: [
        { src: SP + "mmexport1790763949378.jpg", caption: "班级成员 · 操场临时合影" },
        { src: SP + "mmexport1790763973748.jpg", caption: "男子4×100接力 · 教室合影" },
        { src: SP + "mmexport1790763965338.jpg", caption: "男子4×100接力 · 奖状" }
      ]
    }
  ];
  for (const e of evs) await ins.run(e.at, e.title, e.body, JSON.stringify(e.photos));
}
