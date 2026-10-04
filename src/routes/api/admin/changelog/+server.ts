import { json } from "@sveltejs/kit";
import { getChangelog, saveChangelog, type ChangelogEntry, type ChangelogItem } from "$lib/server/changelog.js";
import { verifyToken } from "$lib/server/auth.js";
import { userCan } from "$lib/permissions.js";

/**
 * 更新日志后台读写接口。GET 给后台（含草稿），POST/PUT/DELETE 是写操作。
 *
 * 定位键是 `version`：更新日志没有 id（也没有必要有），版本号天然唯一且人可读，
 * 老师排查问题时说的是「2026.09.27 那条」，不是某个 uuid。
 * POST 因此要做重名校验，PUT 改版本号时也要查重。
 */

const NO_PERMISSION = "无权限，需要内容管理权限";
const CHANGELOG_KINDS = ["feat", "fix", "change", "chore"];

function readBody(request: Request): Promise<any> {
	return request.json().catch(() => null);
}

function fail(message: string, status: number) {
	return json({ error: message }, { status });
}

/** 条目的文本清洗：空文本直接丢掉（老师点了「确定」但没写字，不该留下一条空白记录）。 */
function normalizeItems(raw: unknown): ChangelogItem[] | undefined {
	if (raw === undefined) return undefined;
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((i: any) => i && String(i.text ?? "").trim())
		.map((i: any) => ({
			kind: CHANGELOG_KINDS.includes(String(i.kind)) ? String(i.kind) : "chore",
			text: String(i.text).trim()
		}));
}

/** 统一落盘并兜住底层 IO 异常——磁盘只读时不能把 ENOSPC 之类的英文原样甩给前端。 */
function write(list: ChangelogEntry[]): { ok: true } | { ok: false; res: ReturnType<typeof fail> } {
	try {
		saveChangelog(list);
		return { ok: true };
	} catch (e) {
		console.error("[api/admin/changelog] 写文件失败：", e instanceof Error ? e.message : e);
		return { ok: false, res: fail(`保存失败：${e instanceof Error ? e.message : "磁盘写入出错"}`, 500) };
	}
}

// GET /api/admin/changelog → 全部版本（含草稿，不过滤）
export function GET({ cookies }) {
	const u = verifyToken(cookies.get("admin_token"));
	if (!u || !userCan(u, "manageContent")) return fail(NO_PERMISSION, 403);
	return json(getChangelog());
}

// POST /api/admin/changelog → 新建版本（默认草稿）
export async function POST({ request, cookies }) {
	const u = verifyToken(cookies.get("admin_token"));
	if (!u || !userCan(u, "manageContent")) return fail(NO_PERMISSION, 403);
	const body = await readBody(request);
	if (!body) return fail("请求体解析失败，请刷新页面重试", 400);

	const version = String(body.version ?? "").trim();
	const date = String(body.date ?? "").trim();
	if (!version) return fail("版本号不能为空", 400);
	if (!date) return fail("发布日期不能为空", 400);

	const list = getChangelog();
	if (list.some((e) => e.version === version)) return fail(`这个版本号已经有了：${version}`, 400);

	const entry: ChangelogEntry = {
		version,
		date,
		title: String(body.title ?? "").trim(),
		highlight: String(body.highlight ?? "").trim(),
		items: normalizeItems(body.items) ?? [],
		// 新建默认草稿：没让老师显式点「发布」之前，绝不能自动出现在前台。
		published: body.published === true
	};
	// getChangelog 返回的是版本倒序，unshift 即「最新一条在最前」。
	const next = [entry, ...list];
	const w = write(next);
	if (!w.ok) return w.res;
	return json(entry, { status: 201 });
}

// PUT /api/admin/changelog → 按 version 更新（可改标题/高亮/日期/条目/发布状态，必要时改版本号）
export async function PUT({ request, cookies }) {
	const u = verifyToken(cookies.get("admin_token"));
	if (!u || !userCan(u, "manageContent")) return fail(NO_PERMISSION, 403);
	const body = await readBody(request);
	if (!body) return fail("请求体解析失败，请刷新页面重试", 400);

	const version = String(body.version ?? "").trim();
	if (!version) return fail("缺少版本号，无法定位要修改的版本", 400);

	const list = getChangelog();
	const i = list.findIndex((e) => e.version === version);
	if (i < 0) return fail(`找不到版本号为 ${version} 的更新记录`, 404);

	const nextVersion = body.newVersion === undefined ? version : String(body.newVersion ?? "").trim();
	if (!nextVersion) return fail("版本号不能为空", 400);
	if (nextVersion !== version && list.some((e, idx) => idx !== i && e.version === nextVersion)) {
		return fail(`这个版本号已经有了：${nextVersion}`, 400);
	}

	const items = normalizeItems(body.items);
	const updated: ChangelogEntry = {
		...list[i],
		version: nextVersion,
		date: body.date === undefined ? list[i].date : String(body.date ?? "").trim(),
		title: body.title === undefined ? list[i].title : String(body.title ?? "").trim(),
		highlight: body.highlight === undefined ? list[i].highlight : String(body.highlight ?? "").trim(),
		items: items ?? list[i].items,
		published: body.published === undefined ? list[i].published : body.published === true
	};
	if (!updated.date) return fail("发布日期不能为空", 400);

	const next = [...list];
	next[i] = updated;
	const w = write(next);
	if (!w.ok) return w.res;
	return json(updated);
}

// DELETE /api/admin/changelog → 按 version 删除
export async function DELETE({ request, cookies }) {
	const u = verifyToken(cookies.get("admin_token"));
	if (!u || !userCan(u, "manageContent")) return fail(NO_PERMISSION, 403);
	const body = await readBody(request);
	if (!body) return fail("请求体解析失败，请刷新页面重试", 400);

	const version = String(body.version ?? "").trim();
	if (!version) return fail("缺少版本号，无法定位要删除的版本", 400);

	const list = getChangelog();
	const next = list.filter((e) => e.version !== version);
	if (next.length === list.length) return fail(`找不到版本号为 ${version} 的更新记录`, 404);

	const w = write(next);
	if (!w.ok) return w.res;
	return json({ ok: true, version });
}
