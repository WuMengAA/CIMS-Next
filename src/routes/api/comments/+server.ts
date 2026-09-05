import { json } from "@sveltejs/kit";
import { getComments, addComment, deleteComment, toggleCommentApproval } from "$lib/server/content-store.js";
import { verifyToken as verifyAuth } from "$lib/server/auth.js";

// GET /api/comments?post=slug  — public approved comments
export async function GET({ url }) {
	const post = url.searchParams.get("post");
	const all = url.searchParams.get("all");

	// Admin-only: list all (including unapproved) for management
	if (all === "1") {
		const token = url.searchParams.get("token");
		// Cookies can't be read here easily via query; use header
		return json({ error: "use POST or admin route" }, { status: 400 });
	}

	const comments = getComments(post || undefined).filter(c => c.approved);
	return json(comments);
}

// POST — public submit (auto-approved) or admin actions
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

export async function POST({ request, getClientAddress }) {
	const ip = getClientAddress?.() || "unknown";
	const body = await request.json();
	const action = body.action || "submit";

	if (action === "submit") {
		const { postSlug, name, content, parentId } = body;
		if (!postSlug || !name?.trim() || !content?.trim()) {
			return json({ error: "请填写昵称和内容" }, { status: 400 });
		}
		if (content.trim().length > 2000) {
			return json({ error: "评论内容不能超过 2000 字" }, { status: 400 });
		}
		// 反垃圾：频率限制
		if (!rateLimit(ip)) {
			return json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
		}
		// 反垃圾：关键词过滤
		const lower = (content + " " + name).toLowerCase();
		if (SPAM_KEYWORDS.some(k => lower.includes(k))) {
			return json({ error: "内容包含违规信息，已拦截" }, { status: 400 });
		}
		// 反垃圾：链接占比过高
		const linkCount = (content.match(/https?:\/\//g) || []).length;
		if (linkCount > 2) {
			return json({ error: "链接过多，疑似广告" }, { status: 400 });
		}
		const comment = addComment({
			postSlug,
			name: name.trim().slice(0, 50),
			content: content.trim(),
			approved: true,
			...(parentId ? { parentId } : {})
		});
		return json(comment);
	}

	// Admin actions below
	const user = verifyAuth(request.headers.get("cookie")?.match(/admin_token=([^;]+)/)?.[1] || "");
	if (!user) return json({ error: "未登录" }, { status: 401 });

	if (action === "delete") {
		return json({ ok: deleteComment(body.id) });
	}
	if (action === "toggle") {
		return json({ ok: toggleCommentApproval(body.id) });
	}

	return json({ error: "unknown action" }, { status: 400 });
}