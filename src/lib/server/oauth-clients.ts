/**
 * OAuth 客户端注册表 —— 本站作为**授权服务器**（IdP），面向多个客户端。
 *
 * 原来只硬编码了「星集控桌面端」一个 client_id，且只认 loopback 回拨。现在
 * VoiceHub 这类自建 Web 站点也要用本站账号登录，于是拆成一张表，支持：
 *   - 多个 client_id / client_secret
 *   - 两类回拨：Web（精确匹配的 https:// 地址）、原生（127.0.0.1 任意端口，RFC 8252）
 *
 * ── 数据落点（2026-09-26 改为数据库主导）──────────────────────────────────
 * 表 `oauth_clients`（见 db.ts SCHEMA）是运行时真源：管理页要能增删客户端、重置密钥、
 * 临时停用，这些动作没法在「清单是文件、密钥在 .env」的两段式结构里做。
 *
 * content/oauth-clients.json 降级为**种子**：库里没有某个 id 时，按它播种一次
 * （含当时从环境变量读到的密钥），之后一切以库为准。这样存量部署无需手工迁移，
 * 已发布在外的客户端也不会因为换了存储而登不上。
 *
 * 其他分工维持不变：
 *   - 本模块只回答「这个客户端是谁、能回拨到哪、密钥对不对、开没开」；
 *   - 发码 / 换令牌 / 取用户信息分别在 src/lib/server/oauth.ts 与各路由里。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db.js";

export interface OAuthClientRecord {
	id: string;
	/** 同意页上显示的客户端名 */
	name: string;
	/** 同意页上给用户看的一句话（它要什么） */
	description?: string;
	/** 密钥所在的环境变量名（仅用于播种阶段读值；之后以库里的 secret 为准） */
	secretEnv?: string;
	/** 精确匹配的 Web 回拨地址（比较时忽略结尾斜杠） */
	redirectUris?: string[];
	/** 是否允许原生应用回拨：http://127.0.0.1:<任意端口>/oauth-callback */
	loopback?: boolean;
	/** 允许申请的 scope；不在表里的会被丢掉 */
	scopes?: string[];
	/** 客户端没传 scope 时发放的默认 scope */
	defaultScope?: string;
	/** 停用后 authorize / token 阶段直接拒绝（false = 已停用） */
	enabled?: boolean;
}

/**
 * 内置兜底：content/oauth-clients.json 缺失或被写坏时，至少保证桌面端仍能登录
 * （它是已发布在外的客户端，不能因为一个配置文件而整体失效）。
 */
const BUILTIN: OAuthClientRecord[] = [
	{
		id: "xingjikong_native",
		name: "星集控桌面端",
		description: "桌面集控端（xingjikong）请求使用你的 Stelarith 账号登录",
		secretEnv: "OAUTH_DESKTOP_SECRET",
		loopback: true,
		scopes: ["cims", "profile"],
		defaultScope: "cims"
	}
];
const BUILTIN_IDS = new Set(BUILTIN.map((c) => c.id));

/**
 * 历史默认密钥：OAUTH_DESKTOP_SECRET 未配置时沿用旧值，
 * 避免已经发出去的桌面端在站长没配 env 的情况下突然登不上。
 */
const LEGACY_SECRET_DEFAULTS: Record<string, string> = {
	xingjikong_native: "dev-xingjikong-secret-change-me"
};

import { CONTENT_DIR } from "./paths.js";

const CONFIG_PATH = path.join(CONTENT_DIR, "oauth-clients.json");

function readConfig(): OAuthClientRecord[] {
	try {
		const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as {
			clients?: OAuthClientRecord[];
		};
		const list = Array.isArray(parsed?.clients) ? parsed.clients : [];
		// 按 id 合并：配置文件里的同 id 记录覆盖内置项（例如给桌面端加白名单地址）
		const byId = new Map(BUILTIN.map((c) => [c.id, c]));
		for (const c of list) {
			if (!c || typeof c.id !== "string" || !c.id.trim()) continue;
			byId.set(c.id, { ...byId.get(c.id), ...c, id: c.id.trim() });
		}
		return [...byId.values()];
	} catch {
		return BUILTIN;
	}
}

/** 播种期取密钥：环境变量优先，其次历史默认，再没有就是空串（= 未配置）。 */
function seedSecretOf(rec: OAuthClientRecord): string {
	const envName = (rec.secretEnv ?? "").trim();
	const fromEnv = envName ? (process.env[envName] ?? "").trim() : "";
	if (fromEnv) return fromEnv;
	return LEGACY_SECRET_DEFAULTS[rec.id] ?? "";
}

const parseList = (s: string): string[] => {
	try {
		const v = JSON.parse(s ?? "[]");
		return Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean) : [];
	} catch {
		return [];
	}
};

function nowIso(): string {
	return new Date().toISOString();
}

/**
 * 把 JSON 清单里库中不存在的客户端补进库（幂等；已存在的跳过）。
 * 只在启动时跑一次，之后管理员的改动不会被配置文件回踩。
 */
function seedFromConfig(db: ReturnType<typeof getDb>): void {
	const ts = nowIso();
	const has = db.prepare(`SELECT 1 FROM oauth_clients WHERE id = ?`);
	const insert = db.prepare(
		`INSERT OR IGNORE INTO oauth_clients
		 (id, name, description, secret, redirect_uris, loopback, scopes, default_scope, enabled, builtin, created_at, updated_at)
		 VALUES (?,?,?,?,?,?,?,?,1,?,?,?)`
	);
	for (const c of readConfig()) {
		if (has.get(c.id)) continue;
		insert.run(
			c.id,
			c.name,
			c.description ?? "",
			seedSecretOf(c),
			JSON.stringify(c.redirectUris ?? []),
			c.loopback ? 1 : 0,
			JSON.stringify(c.scopes ?? []),
			c.defaultScope ?? "profile",
			BUILTIN_IDS.has(c.id) ? 1 : 0,
			ts,
			ts
		);
	}
}

interface ClientRow {
	id: string;
	name: string;
	description: string;
	secret: string;
	redirect_uris: string;
	loopback: number;
	scopes: string;
	default_scope: string;
	enabled: number;
	builtin: number;
	created_at: string;
	updated_at: string;
}

function rowToRecord(r: ClientRow): OAuthClientRecord {
	return {
		id: r.id,
		name: r.name,
		description: r.description || undefined,
		// 库里留空时退回环境变量 / 历史默认值，兼容播种前就写在 .env 的部署
		secret: r.secret || seedSecretOf({ id: r.id, secretEnv: "" }) || LEGACY_SECRET_DEFAULTS[r.id] || "",
		redirectUris: parseList(r.redirect_uris),
		loopback: r.loopback === 1,
		scopes: parseList(r.scopes),
		defaultScope: r.default_scope || "profile",
		enabled: r.enabled !== 0
	};
}

// 缓存：清单是小表，读写都走内存副本。DB 侧靠写操作自新的 stamp 失效，
// 不再盯 mtime（种子写库、管理员改配置都会动它，两个来源会互相打架）。
let cache: { stamp: number; list: OAuthClientRecord[] } | null = null;
let stamp = 0;

/** 写操作完成后调一次，让下一次 allClients() 重新读库。 */
function invalidate(): void {
	stamp += 1;
	cache = null;
}

function allClients(): OAuthClientRecord[] {
	if (cache) return cache.list;
	const db = getDb();
	seedFromConfig(db);
	const rows = db.prepare(`SELECT * FROM oauth_clients ORDER BY builtin DESC, created_at ASC`).all() as ClientRow[];
	const list = rows.map(rowToRecord);
	cache = { stamp, list };
	return list;
}

export function getClient(clientId: string): OAuthClientRecord | null {
	const id = (clientId ?? "").trim();
	return allClients().find((c) => c.id === id) ?? null;
}

/** 客户端的密钥：库里存的值 → 环境变量 → 历史默认 → 空串。空串 = 未配置，该客户端不发放令牌。 */
export function clientSecret(rec: OAuthClientRecord): string {
	const own = (rec as { secret?: string }).secret;
	if (typeof own === "string" && own.trim()) return own.trim();
	const envName = (rec.secretEnv ?? "").trim();
	const fromEnv = envName ? (process.env[envName] ?? "").trim() : "";
	if (fromEnv) return fromEnv;
	return LEGACY_SECRET_DEFAULTS[rec.id] ?? "";
}

export function hasSecret(rec: OAuthClientRecord): boolean {
	return clientSecret(rec).length > 0;
}

/** 常量时间比较，避免用返回时间侧信道逐位猜密钥。 */
function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a, "utf8");
	const bb = Buffer.from(b, "utf8");
	if (ab.length !== bb.length) return false;
	return crypto.timingSafeEqual(ab, bb);
}

/**
 * 客户端是否可用：登记存在 + 密钥已配 + 未被停用。
 * 停用与「密钥没配」区分开 —— 前者是站长主动掐断，后者是需要补配置。
 */
export function isClientActive(rec: OAuthClientRecord | null): boolean {
	return !!rec && rec.enabled !== false && hasSecret(rec);
}

export function validateClient(clientId: string, secret: string): boolean {
	const rec = getClient(clientId);
	if (!rec || rec.enabled === false) return false;
	const expected = clientSecret(rec);
	if (!expected) return false;
	return safeEqual(expected, secret ?? "");
}

/**
 * 回拨地址校验：
 * - 先看客户的登记地址（精确匹配，忽略结尾斜杠）；
 * - 再按 loopback 开关放行 http://127.0.0.1:<任意端口>/oauth-callback。
 *
 * 不匹配必须硬失败（而不是"回退到默认地址"）：回拨地址是授权码唯一的投递出口，
 * 放行一个没登记过的地址等于把 code 送给别人的域名。
 */
export function validateRedirectUri(rec: OAuthClientRecord, uri: string): boolean {
	const raw = (uri ?? "").trim();
	if (!raw) return false;

	const norm = (s: string) => s.replace(/\/+$/, "");
	const allowlist = (rec.redirectUris ?? []).map(norm).filter(Boolean);
	if (allowlist.includes(norm(raw))) return true;

	if (rec.loopback) {
		try {
			const u = new URL(raw);
			return u.protocol === "http:" && u.hostname === "127.0.0.1" && u.pathname.endsWith("/oauth-callback");
		} catch {
			return false;
		}
	}
	return false;
}

/** 把客户端请求的 scope 收敛到登记范围内；空则回落 defaultScope，再空则给 "profile"。 */
export function resolveScope(rec: OAuthClientRecord, requested: string | null | undefined): string {
	const allowed = rec.scopes ?? [];
	const asked = (requested ?? "")
		.split(/[\s,]+/)
		.map((s) => s.trim())
		.filter(Boolean);
	const granted = allowed.length ? asked.filter((s) => allowed.includes(s)) : asked;
	if (granted.length) return granted.join(" ");
	return rec.defaultScope ?? (allowed[0] ?? "profile");
}

/** 生成一枚客户端密钥（url-safe，避开 +/= 以免被对方当作 query 参数截断）。 */
export function generateSecret(): string {
	return crypto.randomBytes(32).toString("base64url");
}

/**
 * 为某台设备注册专属 OAuth 客户端（动态注册，2026-09-27 安全改造）。
 *
 * 背景：安装包内置的桌面端密钥（dev-xingjikong-secret-change-me）是公开默认值，
 * 任何人反编译安装包都能以"星集控桌面端"身份走授权 —— 打包即附带登录权限。
 * 改为：客户端首启携带设备指纹调用注册接口，服务端为每台设备生成
 * 专属 client_id（xjk_dev_<指纹>）+ 随机密钥，存在 oauth_clients 表，幂等复用。
 * 包内不再内置任何密钥；旧内置 xingjikong_native 保留仅作兼容旧已装版本。
 *
 * @param fingerprint 设备指纹（稳定身份键，如 cims_agent_uid）。
 * @returns { clientId, clientSecret }；同一指纹重复注册返回同一对（幂等）。
 */
export function registerDeviceClient(fingerprint: string): {
	clientId: string;
	clientSecret: string;
} {
	const fp = (fingerprint || "").trim().toLowerCase();
	const id = "xjk_dev_" + fp.replace(/[^a-z0-9_\-.]/g, "_").slice(0, 48);
	if (!id.match(/^[a-z0-9]/)) {
		throw new Error("设备指纹非法：无法派生 client_id");
	}
	const db = getDb();
	const existing = db.prepare("SELECT secret FROM oauth_clients WHERE id = ?").get(id) as
		| { secret: string }
		| undefined;
	if (existing && existing.secret) {
		return { clientId: id, clientSecret: existing.secret };
	}
	const secret = generateSecret();
	const ts = nowIso();
	db.prepare(
		"INSERT OR REPLACE INTO oauth_clients" +
			" (id, name, description, secret, redirect_uris, loopback, scopes, default_scope, enabled, builtin, created_at, updated_at)" +
			" VALUES (?, ?, ?, ?, ?, 1, ?, ?, 1, 0, ?, ?)"
	).run(
		id,
		"星集控设备端（" + fp.slice(0, 12) + "）",
		"由设备首启动态注册的专属客户端（安全改造：包内零密钥）",
		secret,
		JSON.stringify([]),
		JSON.stringify(["cims", "profile"]),
		"cims",
		ts,
		ts
	);
	return { clientId: id, clientSecret: secret };
}

/** 站点对外根地址（拼 userinfo 的绝对头像地址用）。 */
export function publicBaseUrl(): string {
	const base = (process.env.PUBLIC_SITE_URL || process.env.ORIGIN || "").trim();
	return base.replace(/\/+$/, "");
}

/**
 * 站内默认头像的绝对地址（static/avatars/default.svg）。
 *
 * 客户端（如 VoiceHub）拿不到用户头像时会回落成「首字母占位」——功能不坏，但页面上
 * 少一块身份标识。与其让每个客户端各写一套占位，不如由授权服务器给一个统一的默认头像，
 * 客户端只要 `avatar` 字段非空就自然用上，零配置。
 *
 * 返回绝对值：客户端会以「自己的域名」为基准解析相对路径，给 `/avatars/default.svg`
 * 会被拼成 https://voicehub.245959623.xyz/avatars/default.svg，必然 404。
 */
export function defaultAvatarUrl(): string {
	return `${publicBaseUrl()}/avatars/default.svg`;
}

/** 后台管理页用：列出全部客户端（含密钥与启停状态）。 */
export interface OAuthClientView extends OAuthClientRecord {
	/** 明文密钥。管理页靠它判断「是否已配置」，但**不下发到页面**（见下方 listClientsForAdmin）。 */
	secret: string;
	secretConfigured: boolean;
	builtin: boolean;
	createdAt: string;
	updatedAt: string;
}

/**
 * 管理页视觉层用。密钥在这里是存在于服务端的，序列化到 HTML 必须靠调用方剔除——
 * 页面数据会被塞进首屏 HTML，让 secret 出现在 props 里等于公开。
 */
export function listClientsForAdmin(): OAuthClientView[] {
	const db = getDb();
	seedFromConfig(db);
	const rows = db.prepare(`SELECT * FROM oauth_clients ORDER BY builtin DESC, created_at ASC`).all() as ClientRow[];
	return rows.map((r) => ({
		...rowToRecord(r),
		// 库里的值就是真值；留空才回落到 .env / 历史默认
		secret: r.secret || LEGACY_SECRET_DEFAULTS[r.id] || "",
		secretConfigured: (r.secret || LEGACY_SECRET_DEFAULTS[r.id] || "").length > 0,
		builtin: r.builtin === 1,
		createdAt: r.created_at,
		updatedAt: r.updated_at
	}));
}

// ── 写操作（后台「登录授权 / API」管理页用）────────────────────────────────

/** id 合法性：只允许小写字母数字、下划线、连字符与点，且不能是纯符号。 */
export function isValidClientId(id: string): boolean {
	return /^[a-z0-9][a-z0-9._-]{1,63}$/.test(id);
}

export interface ClientInput {
	id?: string;
	name: string;
	description: string;
	secret?: string;
	redirectUris: string[];
	loopback: boolean;
	scopes: string[];
	defaultScope: string;
	enabled: boolean;
}

/** 新建 / 更新一个客户端。id 为空表示新建。 */
export function saveClient(input: ClientInput): { ok: true } | { ok: false; error: string } {
	const id = (input.id ?? "").trim();
	const name = (input.name ?? "").trim();

	if (!name) return { ok: false, error: "请填写客户端名称" };
	if (!id) return { ok: false, error: "请填写客户端标识（Client ID）" };
	if (!isValidClientId(id)) {
		return { ok: false, error: "标识只能用小写字母、数字、下划线、连字符、点（2–64 位，且以字母数字开头）" };
	}

	const ts = nowIso();
	const db = getDb();
	const existing = db.prepare(`SELECT builtin, secret FROM oauth_clients WHERE id = ?`).get(id) as
		| { builtin: number; secret: string }
		| undefined;

	if (!existing) {
		// 新建时留空密钥 → 自动生成一枚，避免建完就「未配置」而看起来像坏了
		const secret = (input.secret ?? "").trim() || generateSecret();
		db.prepare(
			`INSERT INTO oauth_clients
			 (id, name, description, secret, redirect_uris, loopback, scopes, default_scope, enabled, builtin, created_at, updated_at)
			 VALUES (?,?,?,?,?,?,?,?,?,0,?,?)`
		).run(
			id,
			name,
			input.description ?? "",
			secret,
			JSON.stringify(input.redirectUris),
			input.loopback ? 1 : 0,
			JSON.stringify(input.scopes),
			input.defaultScope || "profile",
			input.enabled ? 1 : 0,
			ts,
			ts
		);
	} else {
		// 编辑不碰密钥（表单里也刻意不回传），但允许显式指定，方便「换成我想要的那个值」
		const secret = (input.secret ?? "").trim();
		const cols = `name = ?, description = ?, redirect_uris = ?, loopback = ?, scopes = ?,
			default_scope = ?, enabled = ?, updated_at = ?${secret ? ", secret = ?" : ""}`;
		const vals: (string | number)[] = [
			name,
			input.description ?? "",
			JSON.stringify(input.redirectUris),
			input.loopback ? 1 : 0,
			JSON.stringify(input.scopes),
			input.defaultScope || "profile",
			input.enabled ? 1 : 0,
			ts
		];
		if (secret) vals.push(secret);
		vals.push(id);
		db.prepare(`UPDATE oauth_clients SET ${cols} WHERE id = ?`).run(...vals);
	}
	invalidate();
	return { ok: true };
}

/** 重置密钥（返回新密钥，仅此一次展示）。 */
export function resetClientSecret(id: string): { ok: true; secret: string } | { ok: false; error: string } {
	const db = getDb();
	const row = db.prepare(`SELECT builtin FROM oauth_clients WHERE id = ?`).get(id) as { builtin: number } | undefined;
	if (!row) return { ok: false, error: "客户端不存在" };

	const secret = generateSecret();
	db.prepare(`UPDATE oauth_clients SET secret = ?, updated_at = ? WHERE id = ?`).run(secret, nowIso(), id);
	invalidate();
	return { ok: true, secret };
}

/** 启停开关。设为停用会保留配置，只掐断发放令牌。 */
export function setClientEnabled(id: string, enabled: boolean): { ok: boolean; error?: string } {
	const db = getDb();
	const row = db.prepare(`SELECT 1 FROM oauth_clients WHERE id = ?`).get(id);
	if (!row) return { ok: false, error: "客户端不存在" };
	db.prepare(`UPDATE oauth_clients SET enabled = ?, updated_at = ? WHERE id = ?`).run(
		enabled ? 1 : 0,
		nowIso(),
		id
	);
	invalidate();
	return { ok: true };
}

/** 删除客户端。内置兜底客户端（已发布在外的桌面端）禁止删除，避免整站登录一起失效。 */
export function deleteClient(id: string): { ok: boolean; error?: string } {
	const db = getDb();
	const row = db.prepare(`SELECT builtin FROM oauth_clients WHERE id = ?`).get(id) as { builtin: number } | undefined;
	if (!row) return { ok: false, error: "客户端不存在" };
	if (row.builtin === 1) return { ok: false, error: "内置客户端不允许删除，可改为「停用」" };
	db.prepare(`DELETE FROM oauth_clients WHERE id = ?`).run(id);
	invalidate();
	return { ok: true };
}
