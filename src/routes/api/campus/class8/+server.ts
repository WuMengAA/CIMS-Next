/**
 * 2028届八班网站 · API
 *
 * GET  /api/campus/class8          公开快照（无个人成绩）
 * POST /api/campus/class8          班主任/管理员维护（改档案/小组/考试/成绩/星光/大事记）
 * GET  /api/campus/class8/me       登录本人个人曲线（仅自己）
 */
import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { userCan } from "$lib/permissions.js";
import {
  getProfile, updateProfile, listGroups, saveGroup, saveMember, saveLeader, deleteLeader,
  listExams, saveExam, saveScore, groupCurves, groupRanking,
  listStars, addStar, updateStar, listEvents, addEvent, saveEvent, listSpots, saveSpot, deleteSpot, fullSnapshot, memberCurve,
  saveRank, deleteRank, deleteGroup, deleteMember, deleteStar, deleteEvent, logChange,
  listScoresByExam, saveScoresBatch, exportAll, importAll, deleteExam, importTableRows
} from "$lib/server/class8/class8-service.js";
import { seedClass8IfEmpty, ensureRealClass8Data, ensureSportsTimeline } from "$lib/server/class8/class8-seed.js";

async function resolveUser(event: RequestEvent) {
  const cookieToken = event.cookies.get("admin_token");
  if (cookieToken) {
    const u = await verifyToken(cookieToken);
    if (u) return u;
  }
  const auth = event.request.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return await verifyToken(auth.slice(7).trim());
  return null;
}

export async function GET(event: RequestEvent) {
  await seedClass8IfEmpty();
  await ensureRealClass8Data();
  await ensureSportsTimeline();
  const me = await resolveUser(event);
  const snap = await fullSnapshot();
  const out: Record<string, unknown> = { ...snap, viewer: me ? { username: me.username, role: me.role } : null };
  const wantScores = event.url.searchParams.get("scores") === "1" || event.url.searchParams.get("scores") === "true";
  if (wantScores && me && (userCan({ role: me.role }, "manageContent") || userCan({ role: me.role }, "manageUsers"))) {
    const byExam: Record<string, Record<string, Record<string, number>>> = {};
    for (const e of snap.exams) byExam[e.id] = {};
    for (const e of snap.exams) {
      for (const row of await listScoresByExam(e.id)) {
        byExam[e.id][row.member_id] = byExam[e.id][row.member_id] || {};
        byExam[e.id][row.member_id][row.subject] = row.score;
      }
    }
    out.scoresByExam = byExam;
  }
  if (event.url.searchParams.get("export") === "1") return json(await exportAll());
  return json(out);
}

export async function POST(event: RequestEvent) {
  await seedClass8IfEmpty();
  await ensureRealClass8Data();
  await ensureSportsTimeline();
  const me = await resolveUser(event);
  if (!me || !(userCan({ role: me.role }, "manageContent") || userCan({ role: me.role }, "manageUsers"))) {
    return json({ error: "仅班主任或管理员可维护班级内容" }, { status: 403 });
  }
  const body = await event.request.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "参数错误" }, { status: 400 });

  const op = String(body.op || "");
  switch (op) {
    case "profile":
      await updateProfile({
        class_name: body.class_name, slogan: body.slogan, concept: body.concept,
        intro: body.intro, teacher: body.teacher
      });
      break;
    case "group":
      await saveGroup({ id: body.id ? Number(body.id) : undefined, seq: body.seq ? Number(body.seq) : undefined, name: String(body.name || ""), goal: String(body.goal || "") });
      break;
    case "member":
      await saveMember({ id: body.id ? Number(body.id) : undefined, group_id: Number(body.group_id || 0), seq: body.seq ? Number(body.seq) : undefined, name: String(body.name || ""), role: String(body.role || ""), motto: String(body.motto || ""), seat: String(body.seat || "") });
      break;
    case "exam":
      await saveExam({ id: body.id ? Number(body.id) : undefined, exam_date: String(body.exam_date || ""), title: String(body.title || ""), seq: body.seq ? Number(body.seq) : undefined });
      break;
    case "score":
      await saveScore({ exam_id: Number(body.exam_id || 0), group_id: Number(body.group_id || 0), member_id: Number(body.member_id || 0), subject: String(body.subject || ""), score: Number(body.score || 0) });
      break;
    case "star":
      await addStar({ month: String(body.month || ""), category: String(body.category || ""), subject: String(body.subject || ""), reason: String(body.reason || "") });
      break;
    case "event":
      await addEvent({ at: String(body.at || ""), title: String(body.title || ""), body: String(body.body || ""), photos: Array.isArray(body.photos) ? body.photos : undefined });
      break;
    case "eventUpdate":
      await saveEvent({ id: Number(body.id || 0), at: body.at, title: body.title, body: body.body, photos: Array.isArray(body.photos) ? body.photos : undefined });
      break;
    case "leader":
      await saveLeader({ id: body.id ? Number(body.id) : undefined, seq: body.seq ? Number(body.seq) : undefined, subject: String(body.subject || ""), name: String(body.name || ""), icon: String(body.icon || "") });
      break;
    case "leaderDelete":
      await deleteLeader(Number(body.id || 0));
      break;
    case "rank":
      await saveRank({ id: body.id ? Number(body.id) : undefined, seq: body.seq ? Number(body.seq) : undefined, group_name: String(body.group_name || ""), avg: Number(body.avg || 0), honor: String(body.honor || "") });
      break;
    case "rankDelete":
      await deleteRank(Number(body.id || 0));
      break;
    case "scoreBatch":
      await saveScoresBatch(Number(body.exam_id || 0), (body.items || []).map((it: any) => ({ member_id: Number(it.member_id || 0), group_id: Number(it.group_id || 0), subject: String(it.subject || ""), score: Number(it.score || 0) })));
      break;
    case "starUpdate":
      await updateStar(Number(body.id || 0), { month: body.month, category: body.category, subject: body.subject, reason: body.reason });
      break;
    case "spot":
      await saveSpot({ id: body.id ? Number(body.id) : undefined, key: String(body.key || ""), title: String(body.title || ""), slogan: String(body.slogan || ""), body: String(body.body || "") });
      break;
    case "spotDelete":
      await deleteSpot(Number(body.id || 0));
      break;
    case "examDelete":
      await deleteExam(Number(body.id || 0));
      break;
    case "importTable": {
      const res = await importTableRows(String(body.kind || ""), (body.rows || []).map((r: any) => (r || {})));
      return json(Object.assign({}, snap(), { importResult: res }));
    }
    case "import":
      await importAll(body.data || null);
      break;
    case "delete":
      { const kind = String(body.kind || ""); const id = Number(body.id || 0);
        if (kind === "group") await deleteGroup(id); else if (kind === "member") await deleteMember(id);
        else if (kind === "star") await deleteStar(id); else if (kind === "event") await deleteEvent(id);
        else return json({ error: "未知删除类型: " + kind }, { status: 400 });
      }
      break;
    default:
      return json({ error: "未知操作: " + op }, { status: 400 });
  }
  await logChange(me.username, op, JSON.stringify(body).slice(0, 120));
  return json({ ok: true, ...await fullSnapshot() });
}
