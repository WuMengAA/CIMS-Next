import { json } from "@sveltejs/kit";
import { getComments, addComment, deleteComment, toggleCommentApproval } from "$lib/server/content-store.js";
import { verifyToken } from "$lib/server/auth.js";
import { can } from "$lib/permissions.js";

// 简单内存限流：同一 IP 60 秒内最多 3 条
const ipBuckets = new Map<string, number[]>();
function rateLimit(ip: string): boolean {
	const now = Date.now();
	const arr = (ipBuckets.get(ip) || []).filter(t => now - t < 60000);
	arr.push(now);
	ipBuckets.set(ip, arr);
	return arr.length <= 3;
}
const SPAM_KEYWORDS = ["http://", "https://", "www.", "购买", "加微信", "加v", "代开发票", "贷款", "刷单", "seo", "推广", "免费领取", "彩票", "赌博"];

// GET /api/comments?target=posts:slug  → 公开：返回该目标下“已通过”的评论
// 兼容旧契约：?post=slug 等价于 target=posts:slug
// ?all=1（需审核权限）→ 后台：返回全部（含待审），可配合 target 过滤
export async function GET({ url, cookies }) {
	let target = url.searchParams.get("target");
	const post = url.searchParams.get("post");
	if (!target && post) target = "posts:" + post;
	const all = url.searchParams.get("all") === "1";

	if (all) {
		const u = verifyToken(cookies.get("admin_token"));
		if (!u || !can(u.role, "moderate")) return json({ error: "无权限" }, { status: 403 });
		const list = target ? getComments(target) : getComments();
		return json(list);
	}
	if (!target) return json({ error: "缺少 target" }, { status: 400 });
	const approved = getComments(target).filter(c => c.approved);
	return json(approved.map(c => ({ id: c.id, name: c.name, content: c.content, createdAt: c.createdAt, parentId: c.parentId })));
}

// POST /api/comments  → 游客可评论（需昵称，待审核）；登录用户自动通过审核
export async function POST({ request, cookies, getClientAddress }) {
	const ip = getClientAddress?.() || "unknown";
	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ error: "请求体无效" }, { status: 400 });
	}
	const action = body.action || "submit";
	const user = verifyToken(cookies.get("admin_token"));

	if (action === "submit") {
		const target = body.target || (body.postSlug ? "posts:" + body.postSlug : null);
		const name = (body.name || "").trim();
		const content = (body.content || "").trim();
		if (!target) return json({ error: "缺少 target" }, { status: 400 });
		if (!content) return json({ error: "评论内容不能为空" }, { status: 400 });
		if (content.length > 2000) return json({ error: "评论内容不能超过 2000 字" }, { status: 400 });

		// 登录用户需有 comment 权限；游客允许但必须填昵称
		if (user) {
			if (!can(user.role, "comment")) return json({ error: "无评论权限" }, { status: 403 });
		} else {
			if (!name) return json({ error: "游客评论请填写昵称" }, { status: 400 });
		}
		if (!rateLimit(ip)) return json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });

		// 反垃圾：关键词过滤
		const lower = (content + " " + (name || "")).toLowerCase();
		if (SPAM_KEYWORDS.some(k => lower.includes(k))) return json({ error: "内容包含违规信息，已拦截" }, { status: 400 });
		// 反垃圾：链接占比过高
		const linkCount = (content.match(/https?:\/\//g) || []).length;
		if (linkCount > 2) return json({ error: "链接过多，疑似广告" }, { status: 400 });

		const c = addComment({
			target,
			name: user ? (user.displayName || user.username) : name.slice(0, 50),
			content,
			approved: !!user,
			author: user ? user.username : undefined,
			...(body.parentId ? { parentId: body.parentId } : {})
		});
		return json({ id: c.id, name: c.name, content: c.content, createdAt: c.createdAt, approved: c.approved }, { status: 201 });
	}

	// 后台管理动作：删除 / 切换审核状态
	if (!user) return json({ error: "未登录" }, { status: 401 });
	if (action === "delete") return json({ ok: deleteComment(body.id) });
	if (action === "toggle") return json({ ok: toggleCommentApproval(body.id) });
	return json({ error: "unknown action" }, { status: 400 });
}
