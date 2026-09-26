/**
 * 项目展板 · 站内 Issues API（类 GitHub）。
 *
 * 权限设计：
 * - 提 Issue → `submitIssue`（登录用户即可，与「提交反馈/工单」同源能力）
 * - 回复    → `comment`
 * - 关闭/重开 → 提问者本人 **或** `moderate`（自己提的能自己关，符合 GitHub 直觉）
 * - 打标签 / 删除 → `moderate`
 *
 * 所有写操作都要求登录：Issues 是署名内容，匿名提交会带来审核负担，
 * 站内已有账号体系，没有理由再开匿名口子。
 */

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getApiUser } from "$lib/server/api-auth.js";
import { can } from "$lib/permissions.js";
import {
	listIssues,
	issueStats,
	getIssue,
	createIssue,
	setIssueState,
	setIssueLabels,
	addIssueComment,
	deleteIssue
} from "$lib/server/project-board.js";

export const GET: RequestHandler = async ({ url }) => {
	const slug = url.searchParams.get("slug");
	if (!slug) return json({ error: "slug required" }, { status: 400 });

	const stateParam = url.searchParams.get("state");
	const state = stateParam === "open" || stateParam === "closed" ? stateParam : "all";
	const q = url.searchParams.get("q") ?? "";
	const number = url.searchParams.get("number");

	// 单条详情（含评论）
	if (number) {
		const one = getIssue(slug, Number(number));
		if (!one) return json({ error: "issue not found" }, { status: 404 });
		return json(one);
	}

	return json({
		issues: listIssues(slug, { state, q }),
		stats: issueStats(slug)
	});
};

export const POST: RequestHandler = async ({ request }) => {
	const user = getApiUser(request);
	if (!user) return json({ error: "请先登录后再提交" }, { status: 401 });

	const action = request.headers.get("x-action");
	let body: any = {};
	try {
		body = await request.json();
	} catch {
		return json({ error: "无效的请求体" }, { status: 400 });
	}
	const slug = String(body.slug ?? "").trim();
	if (!slug) return json({ error: "slug required" }, { status: 400 });

	switch (action) {
		case "create": {
			if (!can(user.role, "submitIssue")) return json({ error: "当前等级不可提交 Issue" }, { status: 403 });
			const title = String(body.title ?? "").trim();
			const content = String(body.body ?? "").trim();
			if (title.length < 2) return json({ error: "标题至少 2 个字" }, { status: 400 });
			if (title.length > 160) return json({ error: "标题最多 160 字" }, { status: 400 });
			if (content.length > 8000) return json({ error: "正文最多 8000 字" }, { status: 400 });
			const labels = Array.isArray(body.labels)
				? body.labels.map((l: any) => String(l).trim()).filter(Boolean).slice(0, 5)
				: [];
			const issue = createIssue({ slug, title, body: content, author: user.username, labels });
			return json({ issue, stats: issueStats(slug) });
		}

		case "comment": {
			if (!can(user.role, "comment")) return json({ error: "当前等级不可回复" }, { status: 403 });
			const number = Number(body.number);
			const content = String(body.body ?? "").trim();
			if (!Number.isFinite(number)) return json({ error: "number required" }, { status: 400 });
			if (!content) return json({ error: "回复内容不能为空" }, { status: 400 });
			if (content.length > 8000) return json({ error: "回复最多 8000 字" }, { status: 400 });
			const comment = addIssueComment(slug, number, { author: user.username, body: content });
			if (!comment) return json({ error: "issue not found" }, { status: 404 });
			return json({ comment });
		}

		case "state": {
			const number = Number(body.number);
			const next = body.state === "closed" ? "closed" : "open";
			if (!Number.isFinite(number)) return json({ error: "number required" }, { status: 400 });
			const one = getIssue(slug, number);
			if (!one) return json({ error: "issue not found" }, { status: 404 });
			// 本人可关自己的，管理/审核可关任何人的
			const isOwner = one.issue.author === user.username;
			if (!isOwner && !can(user.role, "moderate")) {
				return json({ error: "只能关闭自己提交的 Issue" }, { status: 403 });
			}
			const issue = setIssueState(slug, number, next, user.username);
			return json({ issue, stats: issueStats(slug) });
		}

		case "labels": {
			if (!can(user.role, "moderate")) return json({ error: "无权设置标签" }, { status: 403 });
			const number = Number(body.number);
			if (!Number.isFinite(number)) return json({ error: "number required" }, { status: 400 });
			const labels = Array.isArray(body.labels)
				? body.labels.map((l: any) => String(l).trim()).filter(Boolean).slice(0, 5)
				: [];
			const issue = setIssueLabels(slug, number, labels);
			if (!issue) return json({ error: "issue not found" }, { status: 404 });
			return json({ issue });
		}

		case "delete": {
			if (!can(user.role, "moderate")) return json({ error: "无权删除 Issue" }, { status: 403 });
			const number = Number(body.number);
			if (!Number.isFinite(number)) return json({ error: "number required" }, { status: 400 });
			return json({ ok: deleteIssue(slug, number), stats: issueStats(slug) });
		}

		default:
			return json({ error: "unknown action" }, { status: 400 });
	}
};
