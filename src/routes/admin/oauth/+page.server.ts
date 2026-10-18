import { error, redirect } from "@sveltejs/kit";
import type { Cookies } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { verifyToken } from "$lib/server/auth.js";
import { userCan } from "$lib/permissions.js";
import {
	listClientsForAdmin,
	resetClientSecret,
	saveClient,
	setClientEnabled,
	deleteClient
} from "$lib/server/oauth-clients.js";

/**
 * 登录授权 / API 管理页的服务端。
 *
 * 这一页同时干两件事，别混为一谈：
 *   ① 接入速查 —— 把「本站作为授权服务器」的对外契约摊开给第三方对接；
 *   ② 客户端管理 —— 增删改、启停、重置密钥。
 * ② 要求清单可写，所以数据真源是数据库表 oauth_clients，content/oauth-clients.json
 * 只在库里缺少某个 id 时播种一次（见 oauth-clients.ts）。
 *
 * 密钥的暴露策略沿用「首屏不下发」：页面 props 会被 SvelteKit 序列化进 HTML，
 * 把 secret 塞进 props 等于公开；所以列表里只给「是否已配置」，明文只在
 *   ① 点「显示」时单独请求 /api/oauth-clients/<id>/secret；
 *   ② 重置密钥后由 flash 机制取一次。
 */

/** flash 只带 id 与种类，绝不带密钥本身 —— 密钥到这一步才按 id 回查一次。 */
const FLASH_COOKIE = "oauth_flash";

type Flash = { kind: "reset" | "saved" | "disabled" | "enabled" | "deleted" | "error"; id?: string; message?: string };

/**
 * 所有结果都走 flash + 303 回跳，而不是 fail()。
 * 理由有二：① fail 的 payload 要靠前端显式渲染，而这一页只有一个 flash 条，
 * 统一通道能少一套分支；② 批量操作（重置密钥/删除）本就是 303 回跳，
 * 让成功与失败走同一条路，刷新页面不会重复提交。
 */
function flashAndBack(cookies: Cookies, f: Flash): never {
	cookies.set(FLASH_COOKIE, JSON.stringify(f), {
		path: "/admin/oauth",
		httpOnly: true,
		sameSite: "lax",
		maxAge: 120
	});
	redirect(303, "/admin/oauth");
}

function splitLines(s: string): string[] {
	return (s ?? "")
		.split(/\r?\n/)
		.map((x) => x.trim())
		.filter(Boolean);
}

export const load: PageServerLoad = async ({ cookies, url }) => {
	const u = await verifyToken(cookies.get("admin_token") ?? "");
	if (!u || !userCan(u, "manageOAuth")) throw error(403, "需要站长权限");

	// 站点对外根地址的取值优先序：PUBLIC_SITE_URL → ORIGIN → 本次请求来源。
	// 后两者都不配时才退回"这次访问用的那个地址"，宁可地址随访问变，也不给相对路径。
	//
	// ⚠️ baseSource 必须在这里算好传给页面，**不能在 .svelte 里读 process.env**：
	//    SvelteKit 在客户端产物里把 `process.env` 替换成空对象字面量 `({})`，
	//    于是 `!process.env.X` 在浏览器里恒为 true —— 服务端不渲染、客户端无条件渲染，
	//    既产生 hydration 不一致，又让运维看到一条与事实相反的提示（本页 2026-09-26 修）。
	const siteUrl = (process.env.PUBLIC_SITE_URL || "").trim();
	const origin = (process.env.ORIGIN || "").trim();
	const base = (siteUrl || origin || url.origin).replace(/\/+$/, "");
	const baseSource: "site-url" | "origin" | "request" = siteUrl
		? "site-url"
		: origin
			? "origin"
			: "request";

	// flash 是一次性的：取到就删，避免刷新页面又把「刚重置的密钥」摆一遍
	let flash: Flash | null = null;
	const raw = cookies.get(FLASH_COOKIE);
	if (raw) {
		try {
			const parsed = JSON.parse(raw) as Flash;
			if (parsed && typeof parsed === "object" && typeof parsed.kind === "string") flash = parsed;
		} catch {
			flash = null;
		}
		cookies.delete(FLASH_COOKIE, { path: "/admin/oauth" });
	}

	const all = await listClientsForAdmin();

	// 只有「刚重置密钥」这一种 flash 才回读明文，且读完即不再出现在后续刷新里
	let flashSecret = "";
	if (flash?.kind === "reset" && flash.id) {
		const hit = all.find((c) => c.id === flash.id);
		if (hit) flashSecret = hit.secret;
	}

	const clients = all.map((c) => ({
		id: c.id,
		name: c.name,
		description: c.description ?? "",
		secretConfigured: c.secretConfigured,
		loopback: c.loopback,
		enabled: c.enabled !== false,
		builtin: c.builtin,
		scopes: c.scopes ?? [],
		defaultScope: c.defaultScope ?? "",
		redirectUris: c.redirectUris ?? [],
		updatedAt: c.updatedAt,
		authorizeUrl: `${base}/oauth/authorize`,
		tokenUrl: `${base}/oauth/token`,
		userInfoUrl: `${base}/oauth/userinfo`
	}));

	return { base, baseSource, clients, flash, flashSecret };
};

export const actions: Actions = {
	save: async ({ request, cookies }) => {
		const u = await verifyToken(cookies.get("admin_token") ?? "");
		if (!u || !userCan(u, "manageOAuth")) flashAndBack(cookies, { kind: "error", message: "需要站长权限" });

		const f = await request.formData();
		const id = (f.get("id") ?? "").toString().trim();
		const name = (f.get("name") ?? "").toString().trim();
		const description = (f.get("description") ?? "").toString().trim();
		const redirectUris = splitLines(f.get("redirectUris")?.toString() ?? "");
		const scopes = splitLines(f.get("scopes")?.toString() ?? "");
		const defaultScope = (f.get("defaultScope") ?? "").toString().trim() || (scopes[0] ?? "profile");
		const loopback = f.get("loopback") != null;
		const enabled = f.get("enabled") != null;
		const secret = (f.get("secret") ?? "").toString().trim();

		// 混填 http 回拨地址会让授权码被明文送到内网路径上，直接挡在表单这一层
		for (const uri of redirectUris) {
			if (!/^https:\/\//.test(uri) && !(loopback && /^http:\/\/127\.0\.0\.1:/.test(uri))) {
				flashAndBack(cookies, { kind: "error", message: `回拨地址必须是 https（或本机回拨）：${uri}`, id });
			}
		}

		const res = await saveClient({ id, name, description, secret, redirectUris, scopes, defaultScope, loopback, enabled });
		if (!res.ok) flashAndBack(cookies, { kind: "error", message: res.error, id });
		flashAndBack(cookies, { kind: "saved", id });
	},

	resetSecret: async ({ request, cookies }) => {
		const u = await verifyToken(cookies.get("admin_token") ?? "");
		if (!u || !userCan(u, "manageOAuth")) flashAndBack(cookies, { kind: "error", message: "需要站长权限" });

		const f = await request.formData();
		const id = (f.get("id") ?? "").toString().trim();
		const res = await resetClientSecret(id);
		if (!res.ok) flashAndBack(cookies, { kind: "error", message: res.error, id });
		flashAndBack(cookies, { kind: "reset", id });
	},

	toggle: async ({ request, cookies }) => {
		const u = await verifyToken(cookies.get("admin_token") ?? "");
		if (!u || !userCan(u, "manageOAuth")) flashAndBack(cookies, { kind: "error", message: "需要站长权限" });

		const f = await request.formData();
		const id = (f.get("id") ?? "").toString().trim();
		const on = f.get("enabled") != null;
		const res = await setClientEnabled(id, on);
		if (!res.ok) flashAndBack(cookies, { kind: "error", message: res.error ?? "操作失败", id });
		flashAndBack(cookies, { kind: on ? "enabled" : "disabled", id });
	},

	remove: async ({ request, cookies }) => {
		const u = await verifyToken(cookies.get("admin_token") ?? "");
		if (!u || !userCan(u, "manageOAuth")) flashAndBack(cookies, { kind: "error", message: "需要站长权限" });

		const f = await request.formData();
		const id = (f.get("id") ?? "").toString().trim();
		const res = await deleteClient(id);
		if (!res.ok) flashAndBack(cookies, { kind: "error", message: res.error ?? "删除失败", id });
		flashAndBack(cookies, { kind: "deleted", id });
	}
};
