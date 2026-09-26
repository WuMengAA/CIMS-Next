/**
 * 项目展板 API。
 *
 * 约定与既有 `/api/projects` 一致：POST 用 `x-action` 头区分动作，身份取自
 * `admin_token` Cookie（getApiUser）。
 *
 * 权限分层（按「能力」而非角色硬编码，与 permissions.ts 单一真源对齐）：
 * - 展板配置 / 待办 / 发行 / 同步 → `manageContent`
 * - 删除展板 → `admin`（破坏性，收紧到站长）
 * 读操作完全公开（GET 无需登录）——展板是展示型内容。
 */

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getApiUser } from "$lib/server/api-auth.js";
import { can } from "$lib/permissions.js";
import {
	getBoard,
	getBoards,
	ensureBoard,
	saveBoard,
	deleteBoard,
	setTodos,
	addRelease,
	deleteRelease,
	syncBoard,
	syncAll,
	listIssues,
	issueStats
} from "$lib/server/project-board.js";
import { hasGithubToken, fetchRateLimit, parseRepoUrl, GithubError } from "$lib/server/github.js";

export const GET: RequestHandler = async ({ url }) => {
	const slug = url.searchParams.get("slug");
	if (!slug) {
		return json({
			boards: getBoards(),
			github: { hasToken: hasGithubToken() }
		});
	}
	const board = getBoard(slug);
	return json({
		board,
		issues: listIssues(slug, { state: "all" }),
		stats: issueStats(slug)
	});
};

export const POST: RequestHandler = async ({ request }) => {
	const user = getApiUser(request);
	if (!user) return json({ error: "未登录" }, { status: 401 });

	const action = request.headers.get("x-action");
	let body: any = {};
	try {
		body = await request.json();
	} catch {
		return json({ error: "无效的请求体" }, { status: 400 });
	}
	const slug = String(body.slug ?? "").trim();
	if (!slug) return json({ error: "slug required" }, { status: 400 });

	// ── 破坏性：仅站长 ──
	if (action === "deleteBoard") {
		if (user.role !== "admin") return json({ error: "仅站长可删除展板" }, { status: 403 });
		return json({ ok: deleteBoard(slug) });
	}

	// ── 配置类：需 manageContent ──
	if (!can(user.role, "manageContent")) {
		return json({ error: "无权管理项目展板" }, { status: 403 });
	}

	switch (action) {
		case "saveBoard": {
			// repo 允许显式传入（用于把 repoUrl 解析结果落地），非法则拒绝而不是静默存脏数据
			let repo = String(body.repo ?? "").trim();
			if (repo) {
				const parsed = parseRepoUrl(repo);
				if (!parsed) return json({ error: "仓库地址无法识别，请填 owner/name" }, { status: 400 });
				repo = `${parsed.owner}/${parsed.name}`;
			}
			const board = saveBoard(slug, {
				repo,
				tagline: body.tagline != null ? String(body.tagline) : undefined,
				milestones: Array.isArray(body.milestones) ? body.milestones : undefined
			});
			return json({ board });
		}

		case "setTodos": {
			const todos = Array.isArray(body.todos)
				? body.todos.map((t: any, i: number) => ({
						id: String(t?.id ?? `todo_${i}`),
						title: String(t?.title ?? "").trim(),
						done: !!t?.done,
						group: String(t?.group ?? "").trim(),
						order: Number.isFinite(t?.order) ? Number(t.order) : i
					})).filter((t: any) => t.title)
				: [];
			return json({ board: setTodos(slug, todos) });
		}

		case "addRelease": {
			const tag = String(body.tag ?? "").trim();
			if (!tag) return json({ error: "版本号（tag）必填" }, { status: 400 });
			const board = addRelease(slug, {
				tag,
				name: String(body.name ?? "").trim(),
				notes: String(body.notes ?? ""),
				file: String(body.file ?? "").trim(),
				url: String(body.url ?? "").trim(),
				size: Number(body.size ?? 0),
				prerelease: !!body.prerelease,
				source: "local"
			});
			return json({ board });
		}

		case "deleteRelease": {
			const id = String(body.id ?? "");
			if (!id) return json({ error: "id required" }, { status: 400 });
			return json({ board: deleteRelease(slug, id) });
		}

		case "sync": {
			const withReleases = !!body.withReleases;
			if (body.all) {
				const results = await syncAll({ withReleases });
				return json({ ok: true, results });
			}
			const r = await syncBoard(slug, { withReleases, repoOverride: body.repo ? String(body.repo) : undefined });
			return json({ ok: r.ok, board: r.board, error: r.error ?? null });
		}

		case "testGithub": {
			try {
				const info = await fetchRateLimit();
				return json({ ok: true, ...info });
			} catch (err) {
				const msg = err instanceof GithubError ? err.message : (err as Error).message;
				return json({ ok: false, error: msg });
			}
		}

		default:
			return json({ error: "unknown action" }, { status: 400 });
	}
};
