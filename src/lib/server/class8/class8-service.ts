/**
 * 2028届八班网站 · 业务逻辑层（读写 + 学业汇总）。
 *
 * 隐私红线：个人成绩/排名不公开。对外一律按【小组维度】聚合；
 * 个人成绩仅当请求者登录且匹配到本班成员时才单独返回。
 */
import { getDb } from "../db.js";
import { ensureClass8Schema } from "./class8-db.js";

async function db() {
  await ensureClass8Schema();
  return getDb();
}

export interface GroupRow { id: number; seq: number; name: string; goal: string; emoji: string; }
export interface MemberRow { id: number; group_id: number; seq: number; name: string; role: string; motto: string; seat: string; }
export interface ExamRow { id: number; exam_date: string; title: string; seq: number; }
export interface StarRow { id: number; month: string; category: string; subject: string; reason: string; }
export interface EventPhoto { src: string; caption: string; }
export interface EventRow { id: number; at: string; title: string; body: string; photos?: EventPhoto[]; }
export interface CultureSpot { id: number; key: string; title: string; slogan: string; body: string; }
export interface Profile { slug: string; class_name: string; slogan: string; concept: string; intro: string; teacher: string; quote: string; subtitle: string; }
export interface LeaderRow { id: number; seq: number; subject: string; name: string; icon: string; }
export interface RankRow { id: number; seq: number; group_name: string; avg: number; honor: string; }
export interface ChangelogRow { id: number; at: string; actor: string; op: string; detail: string; }

// ── 班级档案 ──
export async function getProfile(): Promise<Profile> {
  return await (await db()).prepare("SELECT slug, class_name, slogan, concept, intro, teacher, quote, subtitle FROM class8_profile WHERE id = 1").get() as unknown as Profile;
}

export async function updateProfile(p: Partial<Profile>): Promise<Profile> {
  const c = await getProfile();
  await (await db()).prepare("UPDATE class8_profile SET class_name=?, slogan=?, concept=?, intro=?, teacher=?, quote=?, subtitle=? WHERE id=1").run(
    p.class_name === undefined ? c.class_name : p.class_name,
    p.slogan === undefined ? c.slogan : p.slogan,
    p.concept === undefined ? c.concept : p.concept,
    p.intro === undefined ? c.intro : p.intro,
    p.teacher === undefined ? c.teacher : p.teacher,
    p.quote === undefined ? c.quote : p.quote,
    p.subtitle === undefined ? c.subtitle : p.subtitle
  );
  return await getProfile();
}

// ── 小组（含成员）──
export async function listGroups(): Promise<(GroupRow & { members: MemberRow[] })[]> {
  const groups = await (await db()).prepare("SELECT id, seq, name, goal, emoji FROM class8_groups ORDER BY seq, id").all() as unknown as GroupRow[];
  const members = await (await db()).prepare("SELECT * FROM class8_members ORDER BY group_id, seq, id").all() as unknown as MemberRow[];
  const byG = new Map<number, MemberRow[]>();
  for (const m of members) {
    const a = byG.get(m.group_id);
    if (a) a.push(m); else byG.set(m.group_id, [m]);
  }
  return groups.map(function (g) { return Object.assign({}, g, { members: byG.get(g.id) || [] }); });
}

export async function saveGroup(g: { id?: number; seq?: number; name: string; goal?: string; emoji?: string }): Promise<void> {
  if (g.id) {
    await (await db()).prepare("UPDATE class8_groups SET name=?, goal=?, emoji=? WHERE id=?").run(g.name, g.goal || "", g.emoji || "", g.id);
  } else {
    await (await db()).prepare("INSERT INTO class8_groups (seq, name, goal, emoji) VALUES (?,?,?,?)").run(g.seq || 0, g.name, g.goal || "", g.emoji || "");
  }
}

export async function saveMember(m: { id?: number; group_id: number; seq?: number; name: string; role?: string; motto?: string; seat?: string }): Promise<void> {
  if (m.id) {
    await (await db()).prepare("UPDATE class8_members SET group_id=?, name=?, role=?, motto=?, seat=? WHERE id=?").run(m.group_id, m.name, m.role || "", m.motto || "", m.seat || "", m.id);
  } else {
    await (await db()).prepare("INSERT INTO class8_members (group_id, seq, name, role, motto, seat) VALUES (?,?,?,?,?,?)").run(m.group_id, m.seq || 0, m.name, m.role || "", m.motto || "", m.seat || "");
  }
}

// ── 考试 / 成绩 ──
export async function listExams(): Promise<ExamRow[]> {
  return await (await db()).prepare("SELECT * FROM class8_exams ORDER BY seq, id").all() as unknown as ExamRow[];
}

export async function saveExam(e: { id?: number; exam_date: string; title: string; seq?: number }): Promise<void> {
  if (e.id) {
    await (await db()).prepare("UPDATE class8_exams SET exam_date=?, title=?, seq=? WHERE id=?").run(e.exam_date, e.title, e.seq || 0, e.id);
  } else {
    await (await db()).prepare("INSERT INTO class8_exams (exam_date, title, seq) VALUES (?,?,?)").run(e.exam_date, e.title, e.seq || 0);
  }
}

export async function saveScore(s: { exam_id: number; group_id: number; member_id: number; subject: string; score: number }): Promise<void> {
  await (await db()).prepare("DELETE FROM class8_scores WHERE exam_id=? AND member_id=? AND subject=?").run(s.exam_id, s.member_id, s.subject);
  await (await db()).prepare("INSERT INTO class8_scores (exam_id, group_id, member_id, subject, score) VALUES (?,?,?,?,?)").run(s.exam_id, s.group_id, s.member_id, s.subject, s.score);
}

// ── 小组曲线（隐私安全：只出小组均值）──
export async function groupCurves(subject?: string): Promise<{ exams: string[]; groups: { id: number; name: string; points: (number | null)[] }[] }> {
  const exams = await listExams();
  const groups = await (await db()).prepare("SELECT id, seq, name, goal FROM class8_groups ORDER BY seq, id").all() as unknown as GroupRow[];
  const stOne = (await db()).prepare("SELECT AVG(score) AS avg FROM class8_scores WHERE exam_id=? AND group_id=?");
  const stSub = (await db()).prepare("SELECT AVG(score) AS avg FROM class8_scores WHERE exam_id=? AND group_id=? AND subject=?");
  const out = await Promise.all(groups.map(async function (g) {
    return {
      id: g.id,
      name: g.name,
      points: await Promise.all(exams.map(async function (e) {
        const r = (subject ? await stSub.get(e.id, g.id, subject) : await stOne.get(e.id, g.id)) as { avg: number | null } | undefined;
        const v = r && r.avg !== null && r.avg !== undefined ? Number(r.avg) : null;
        return v === null ? null : Math.round(v * 10) / 10;
      }))
    };
  }));
  return { exams: exams.map(function (e) { return e.title || e.exam_date; }), groups: out };
}

// ── 小组排行（按最近一次考试均分）──
export async function groupRanking(): Promise<{ name: string; avg: number | null }[]> {
  const exams = await listExams();
  if (exams.length === 0) return [];
  const last = exams[exams.length - 1];
  const rows = await (await db()).prepare("SELECT g.name AS name, AVG(s.score) AS avg FROM class8_scores s JOIN class8_groups g ON g.id = s.group_id WHERE s.exam_id = ? GROUP BY s.group_id ORDER BY avg DESC").all(last.id) as { name: string; avg: number | null }[];
  return rows.map(function (r) { return { name: r.name, avg: r.avg === null ? null : Math.round(Number(r.avg) * 10) / 10 }; });
}

// 个人曲线：仅登录本人可取（调用方负责鉴权）
export async function memberCurve(memberName: string): Promise<{ exams: string[]; points: (number | null)[]; rank: number[] }> {
  const exams = await listExams();
  const st = (await db()).prepare("SELECT AVG(score) AS avg FROM class8_scores s JOIN class8_members m ON m.id = s.member_id WHERE s.exam_id=? AND m.name=?");
  const points = await Promise.all(exams.map(async function (e) {
    const r = await st.get(e.id, memberName) as { avg: number | null } | undefined;
    const v = r && r.avg !== null && r.avg !== undefined ? Number(r.avg) : null;
    return v === null ? null : Math.round(v * 10) / 10;
  }));
  return { exams: exams.map(function (e) { return e.title || e.exam_date; }), points: points, rank: [] };
}

// ── 星光榜 / 大事记 / 点位 ──
export async function listStars(): Promise<StarRow[]> { return await (await db()).prepare("SELECT * FROM class8_stars ORDER BY month DESC, id").all() as unknown as StarRow[]; }
export async function listEvents(): Promise<EventRow[]> {
  const rows = await (await db()).prepare("SELECT * FROM class8_events ORDER BY at DESC, id DESC").all() as unknown as EventRow[];
  return rows.map(function (e) {
    let photos: EventPhoto[] = [];
    try {
      let p: unknown = JSON.parse((e as any).photos || "[]");
      while (typeof p === "string") { try { p = JSON.parse(p); } catch { break; } }
      if (!Array.isArray(p)) p = [];
      photos = p as EventPhoto[];
    } catch { photos = []; }
    return Object.assign({}, e, { photos });
  });
}
export async function listSpots(): Promise<CultureSpot[]> { return await (await db()).prepare("SELECT * FROM class8_culture_spots ORDER BY id").all() as unknown as CultureSpot[]; }

export async function addStar(s: { month: string; category: string; subject: string; reason: string }): Promise<void> {
  await (await db()).prepare("INSERT INTO class8_stars (month, category, subject, reason) VALUES (?,?,?,?)").run(s.month, s.category, s.subject, s.reason);
}
function normPhotos(photos: unknown): EventPhoto[] {
  let p = photos;
  while (typeof p === "string") { try { p = JSON.parse(p); } catch { break; } }
  return Array.isArray(p) ? (p as EventPhoto[]) : [];
}

export async function addEvent(e: { at: string; title: string; body: string; photos?: EventPhoto[] }): Promise<void> {
  const ph = normPhotos((e.photos as unknown) ?? []);
  await (await db()).prepare("INSERT INTO class8_events (at, title, body, photos) VALUES (?,?,?,?)").run(e.at, e.title, e.body, JSON.stringify(ph));
}
export async function saveEvent(e: { id: number; at?: string; title?: string; body?: string; photos?: EventPhoto[] }): Promise<void> {
  const c = await (await db()).prepare("SELECT * FROM class8_events WHERE id=?").get(e.id) as unknown as EventRow | undefined;
  if (!c) return;
  await (await db()).prepare("UPDATE class8_events SET at=?, title=?, body=?, photos=? WHERE id=?").run(
    e.at === undefined ? c.at : e.at,
    e.title === undefined ? c.title : e.title,
    e.body === undefined ? c.body : e.body,
    JSON.stringify(normPhotos(e.photos === undefined ? (c.photos as unknown) : e.photos)),
    e.id
  );
}


// ── 学科领航人 ──
export async function listLeaders(): Promise<LeaderRow[]> {
  return await (await db()).prepare("SELECT * FROM class8_leaders ORDER BY seq, id").all() as unknown as LeaderRow[];
}
export async function saveLeader(l: { id?: number; seq?: number; subject: string; name: string; icon?: string }): Promise<void> {
  if (l.id) {
    await (await db()).prepare("UPDATE class8_leaders SET subject=?, name=?, icon=?, seq=? WHERE id=?").run(l.subject, l.name, l.icon || "", l.seq || 0, l.id);
  } else {
    await (await db()).prepare("INSERT INTO class8_leaders (seq, subject, name, icon) VALUES (?,?,?,?)").run(l.seq || 0, l.subject, l.name, l.icon || "");
  }
}
export async function deleteLeader(id: number): Promise<void> { await (await db()).prepare("DELETE FROM class8_leaders WHERE id=?").run(id); }

// ── 官方排名（期末均分快照，班主任维护）──
export async function listRanks(): Promise<RankRow[]> {
  return await (await db()).prepare("SELECT * FROM class8_rank ORDER BY seq, id").all() as unknown as RankRow[];
}
export async function saveRank(r: { id?: number; seq?: number; group_name: string; avg: number; honor?: string }): Promise<void> {
  if (r.id) {
    await (await db()).prepare("UPDATE class8_rank SET group_name=?, avg=?, honor=?, seq=? WHERE id=?").run(r.group_name, r.avg, r.honor || "", r.seq || 0, r.id);
  } else {
    await (await db()).prepare("INSERT INTO class8_rank (seq, group_name, avg, honor) VALUES (?,?,?,?)").run(r.seq || 0, r.group_name, r.avg, r.honor || "");
  }
}
export async function deleteRank(id: number): Promise<void> { await (await db()).prepare("DELETE FROM class8_rank WHERE id=?").run(id); }

// ── 删除（可维护性补齐）──
export async function deleteGroup(id: number): Promise<void> {
  await (await db()).prepare("DELETE FROM class8_scores WHERE group_id=?").run(id);
  await (await db()).prepare("DELETE FROM class8_members WHERE group_id=?").run(id);
  await (await db()).prepare("DELETE FROM class8_groups WHERE id=?").run(id);
}
export async function deleteMember(id: number): Promise<void> { await (await db()).prepare("DELETE FROM class8_members WHERE id=?").run(id); }
export async function deleteStar(id: number): Promise<void> { await (await db()).prepare("DELETE FROM class8_stars WHERE id=?").run(id); }
export async function deleteEvent(id: number): Promise<void> { await (await db()).prepare("DELETE FROM class8_events WHERE id=?").run(id); }

// ── 变更记录（可记录）──
export async function logChange(actor: string, op: string, detail: string): Promise<void> {
  await (await db()).prepare("INSERT INTO class8_changelog (at, actor, op, detail) VALUES (?,?,?,?)")
    .run(new Date().toISOString().slice(0, 19).replace("T", " "), actor || "system", op, detail);
}
export async function listChangelog(limit = 30): Promise<ChangelogRow[]> {
  return await (await db()).prepare("SELECT * FROM class8_changelog ORDER BY id DESC LIMIT ?").all(limit) as unknown as ChangelogRow[];
}

// ── 成绩读取 / 批量写入（管理端成绩录入）──
export async function listScoresByExam(examId: number): Promise<{ member_id: number; group_id: number; subject: string; score: number }[]> {
  return await (await db()).prepare("SELECT member_id, group_id, subject, score FROM class8_scores WHERE exam_id=?").all(examId) as unknown as { member_id: number; group_id: number; subject: string; score: number }[];
}
export async function saveScoresBatch(examId: number, items: { member_id: number; group_id: number; subject: string; score: number }[]): Promise<void> {
  const del = await (await db()).prepare("DELETE FROM class8_scores WHERE exam_id=? AND member_id=? AND subject=?");
  const ins = await (await db()).prepare("INSERT INTO class8_scores (exam_id, group_id, member_id, subject, score) VALUES (?,?,?,?,?)");
  for (const it of items) { await del.run(examId, it.member_id, it.subject); await ins.run(examId, it.group_id, it.member_id, it.subject, it.score); }
}


// ── 星光编辑 ──
export async function updateStar(id: number, s: { month?: string; category?: string; subject?: string; reason?: string }): Promise<void> {
  const c = await (await db()).prepare("SELECT * FROM class8_stars WHERE id=?").get(id) as unknown as StarRow | undefined;
  if (!c) return;
  await (await db()).prepare("UPDATE class8_stars SET month=?, category=?, subject=?, reason=? WHERE id=?").run(
    s.month === undefined ? c.month : s.month,
    s.category === undefined ? c.category : s.category,
    s.subject === undefined ? c.subject : s.subject,
    s.reason === undefined ? c.reason : s.reason,
    id
  );
}

// ── 文化点位 CRUD ──
export async function saveSpot(s: { id?: number; key: string; title: string; slogan: string; body: string }): Promise<void> {
  if (s.id) {
    await (await db()).prepare("UPDATE class8_culture_spots SET key=?, title=?, slogan=?, body=? WHERE id=?").run(s.key, s.title, s.slogan, s.body, s.id);
  } else {
    await (await db()).prepare("INSERT INTO class8_culture_spots (key, title, slogan, body) VALUES (?,?,?,?)").run(s.key, s.title, s.slogan, s.body);
  }
}
export async function deleteSpot(id: number): Promise<void> { await (await db()).prepare("DELETE FROM class8_culture_spots WHERE id=?").run(id); }

// ── 全量导出 / 导入（全换数据）──
export async function exportAll() {
  return {
    profile: await getProfile(),
    groups: await listGroups(),
    exams: await listExams(),
    scores: await (await listExams()).map(async function (e) { return { exam_id: e.id, rows: await listScoresByExam(e.id) }; }),
    stars: await listStars(),
    events: await listEvents(),
    spots: await listSpots(),
    leaders: await listLeaders(),
    ranks: await listRanks()
  };
}

export async function importAll(data: any): Promise<void> {
  const d = await db();
  d.exec("DELETE FROM class8_scores; DELETE FROM class8_exams; DELETE FROM class8_members; DELETE FROM class8_groups; DELETE FROM class8_stars; DELETE FROM class8_events; DELETE FROM class8_culture_spots; DELETE FROM class8_leaders; DELETE FROM class8_rank;");
  // profile
  if (data && data.profile) await updateProfile(Object.assign({}, data.profile));
  // groups → members（维护 id 映射）
  const gMap = new Map<number, number>();
  for (const g of (data && data.groups) || []) {
    const r = await (await db()).prepare("INSERT INTO class8_groups (seq, name, goal, emoji) VALUES (?,?,?,?)").run(g.seq || 0, g.name || "", g.goal || "", g.emoji || "");
    const newId = Number(r.lastInsertRowid);
    if (g.id !== undefined) gMap.set(g.id, newId);
    for (const m of (g.members || [])) {
      await (await db()).prepare("INSERT INTO class8_members (group_id, seq, name, role, motto, seat) VALUES (?,?,?,?,?,?)").run(newId, m.seq || 0, m.name || "", m.role || "", m.motto || "", m.seat || "");
    }
  }
  // exams（id 映射）
  const eMap = new Map<number, number>();
  for (const e of (data && data.exams) || []) {
    const r = await (await db()).prepare("INSERT INTO class8_exams (exam_date, title, seq) VALUES (?,?,?)").run(e.exam_date || "", e.title || "", e.seq || 0);
    if (e.id !== undefined) eMap.set(e.id, Number(r.lastInsertRowid));
  }
  // stars / events / spots / leaders / ranks
  for (const s of (data && data.stars) || []) await addStar({ month: s.month || "", category: s.category || "", subject: s.subject || "", reason: s.reason || "" });
  for (const e of (data && data.events) || []) await addEvent({ at: e.at || "", title: e.title || "", body: e.body || "", photos: e.photos || [] });
  for (const sp of (data && data.spots) || []) await saveSpot({ key: sp.key || "", title: sp.title || "", slogan: sp.slogan || "", body: sp.body || "" });
  for (const l of (data && data.leaders) || []) await saveLeader({ subject: l.subject || "", name: l.name || "", icon: l.icon || "", seq: l.seq || 0 });
  for (const r of (data && data.ranks) || []) await saveRank({ group_name: r.group_name || "", avg: Number(r.avg) || 0, honor: r.honor || "", seq: r.seq || 0 });
  // scores（用 id 映射重建）
  for (const ex of (data && data.scores) || []) {
    const newExam = eMap.get(Number(ex.exam_id));
    if (newExam === undefined) continue;
    for (const row of (ex.rows || [])) {
      await (await db()).prepare("INSERT INTO class8_scores (exam_id, group_id, member_id, subject, score) VALUES (?,?,?,?,?)")
        .run(newExam, 0, 0, row.subject || "", Number(row.score) || 0);
    }
  }
}

export async function deleteExam(id: number): Promise<void> {
  await (await db()).prepare("DELETE FROM class8_scores WHERE exam_id=?").run(id);
  await (await db()).prepare("DELETE FROM class8_exams WHERE id=?").run(id);
}


// ── 表格批量导入（Excel/CSV 解析后写入）──
export async function importTableRows(kind: string, rows: Record<string, unknown>[]): Promise<{ ok: number; skip: number }> {
  let ok = 0, skip = 0;
  const db3 = await db();
  if (kind === "members") {
    for (const r of rows) {
      const gname = String(r.group || "").trim();
      const mname = String(r.name || "").trim();
      if (!gname || !mname) { skip++; continue; }
      let g = await db3.prepare("SELECT * FROM class8_groups WHERE name=?").get(gname) as unknown as { id: number; seq: number } | undefined;
      if (!g) {
        const ins = await db3.prepare("INSERT INTO class8_groups (seq, name, goal, emoji) VALUES (?,?,?,?)").run(999, gname, "", "");
        g = { id: Number(ins.lastInsertRowid), seq: 999 };
      }
      const dup = await db3.prepare("SELECT id FROM class8_members WHERE group_id=? AND name=?").get(g.id, mname);
      if (dup) { skip++; continue; }
      await db3.prepare("INSERT INTO class8_members (group_id, seq, name, role, motto, seat) VALUES (?,?,?,?,?,?)").run(g.id, 0, mname, String(r.role || "组员"), String(r.motto || ""), String(r.seat || ""));
      ok++;
    }
  } else if (kind === "stars") {
    for (const r of rows) {
      const name = String(r.subject || r.name || "").trim();
      if (!name) { skip++; continue; }
      await addStar({ month: String(r.month || ""), category: String(r.category || "星光"), subject: name, reason: String(r.reason || "") });
      ok++;
    }
  } else if (kind === "events") {
    for (const r of rows) {
      if (!String(r.title || "").trim()) { skip++; continue; }
      await addEvent({ at: String(r.at || ""), title: String(r.title || ""), body: String(r.body || ""), photos: [] });
      ok++;
    }
  } else if (kind === "groups") {
    for (const r of rows) {
      const gname = String(r.name || r.group || "").trim();
      if (!gname) { skip++; continue; }
      const dup = await db3.prepare("SELECT id FROM class8_groups WHERE name=?").get(gname);
      if (dup) { skip++; continue; }
      await db3.prepare("INSERT INTO class8_groups (seq, name, goal, emoji) VALUES (?,?,?,?)").run(0, gname, String(r.goal || ""), String(r.emoji || "🔹"));
      ok++;
    }
  } else if (kind === "ranks") {
    for (const r of rows) {
      const gname = String(r.group || r.name || "").trim();
      if (!gname) { skip++; continue; }
      const dup = await db3.prepare("SELECT id FROM class8_rank WHERE group_name=?").get(gname);
      if (dup) { skip++; continue; }
      await saveRank({ group_name: gname, avg: Number(r.avg) || 0, honor: String(r.honor || "") });
      ok++;
    }
  } else if (kind === "scores") {
    const examId = Number(r.exam_id || 0);
    const subject = String(r.subject || "");
    if (!examId || !subject) return { ok: 0, skip: rows.length };
    for (const row of rows) {
      const name = String(row.name || "").trim();
      const score = Number(row.score);
      if (!name || Number.isNaN(score)) { skip++; continue; }
      const m = await db3.prepare("SELECT id, group_id FROM class8_members WHERE name=?").get(name) as unknown as { id: number; group_id: number } | undefined;
      if (!m) { skip++; continue; }
      await db3.prepare("INSERT INTO class8_scores (exam_id, group_id, member_id, subject, score) VALUES (?,?,?,?,?)").run(examId, m.group_id, m.id, subject, score);
      ok++;
    }
  }
  return { ok, skip };
}

// ── 全量快照（公开页与后台共用）──
export async function fullSnapshot() {
  return {
    profile: await getProfile(),
    groups: await listGroups(),
    exams: await listExams(),
    ranking: await groupRanking(),
    curves: await groupCurves(undefined),
    stars: await listStars(),
    events: await listEvents(),
    spots: await listSpots(),
    leaders: await listLeaders(),
    ranks: await listRanks(),
    changelog: await listChangelog(30)
  };
}
