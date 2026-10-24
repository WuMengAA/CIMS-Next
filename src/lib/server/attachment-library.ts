/**
 * 个人附件库 / 图床 —— 服务层。
 *
 * ## 安全隔离铁律
 * 本模块里**每一条 SQL 都带 owner_id 过滤**。账号之间看不到彼此的文件，不是靠前端藏、
 * 也不是靠"这个 id 是我的所以能访问"，而是靠查询条件本身——哪怕调用方传错 id，
 * 也只会查到空结果，绝不会漏出别人的文件。
 * 后台跨账号管理是唯一例外，必须显式走 `adminListAll()` / `adminPurgeUser()`，
 * 函数名里带 `admin` 就是给人的警示牌。
 *
 * ## 数据流向
 *   上传 → 图片管线（缩/水印/编码）→ 上传 R2 → 写 attachments 元数据
 *   删除 → 删 R2 对象（含 original_key 那份）→ 删行
 * 元数据（表）是真源；R2 里的对象丢了可以重传，元数据错了文件就"人间蒸发"，
 * 所以**先落元数据再删对象**的顺序不能倒。
 */
import crypto from "node:crypto";
import { getDb, nowIso } from "./db.js";
import { getUsers } from "./auth.js";
import { xpToLevel } from "../permissions.js";
import { quotaBytes } from "../storage-quota.js";
import { putObject, deleteObject, publicUrlForKey } from "./storage/r2.js";
import { processImage, probeImage, type TargetFormat } from "./image-pipeline.js";

const MB = 1024 * 1024;

/** 单次上传的体积上限：头像 8M，附件库文件 200M。超过直接拒，避免一根网线拖垮服务。 */
export const MAX_AVATAR_BYTES = 8 * MB;
export const MAX_FILE_BYTES = 200 * MB;

export interface LibraryFile {
	id: string;
	folderId: string | null;
	filename: string;
	url: string;
	mime: string;
	bytes: number;
	width: number | null;
	height: number | null;
	isImage: boolean;
	watermark: boolean;
	variant: TargetFormat | "original" | string;
	hasOriginal: boolean;
	originalBytes: number;
	purpose: string;
	createdAt: string;
}

export interface Folder {
	id: string;
	name: string;
	parentId: string | null;
	purpose: string;
	createdAt: string;
}

// ── 配额 ────────────────────────────────────────────────────────────────────

export interface UsageInfo {
	usedBytes: number;
	quotaBytes: number;
	level: number;
	bonusBytes: number;
	files: number;
	images: number;
	percent: number;
}

/** 某用户已用空间。软删除的行不计入（删了就该立刻还回去）。 */
export async function usageOf(userId: number): Promise<UsageInfo> {
	const db = getDb();
	const row = await db
		.prepare(
			`SELECT COALESCE(SUM(bytes),0) AS used, COUNT(*) AS n,
			        COALESCE(SUM(is_image),0) AS imgs
			   FROM attachments WHERE owner_id = ?`
		)
		.get(userId) as { used: number; n: number; imgs: number };

	const bonus = (await db.prepare("SELECT COALESCE(quota_bonus_bytes,0) AS b FROM users WHERE id = ?").get(userId) as
		| { b: number }
		| undefined)?.b;
	const bonusBytes = Math.max(0, bonus ?? 0);

	// xp 可能没在缓存里，兜底查一次；查不到按 0（Lv.1 = 100M 起配，不会把人锁死）。
	let xp = 0;
	const u = await db.prepare("SELECT xp FROM users WHERE id = ?").get(userId) as { xp: number } | undefined;
	if (u) xp = u.xp ?? 0;
	else {
		const legacy = await (await getUsers()).find((x) => x.id === userId);
		xp = legacy?.xp ?? 0;
	}

	const quota = quotaBytes(xp, bonusBytes);
	const used = Number(row.used) || 0;
	return {
		usedBytes: used,
		quotaBytes: quota,
		level: xpToLevel(xp),
		bonusBytes,
		files: Number(row.n) || 0,
		images: Number(row.imgs) || 0,
		percent: quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 100,
	};
}

// ── 文件夹 ──────────────────────────────────────────────────────────────────

function newId(prefix: string): string {
	return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

/** 懒创建「我的附件库 / 图床」两个内置目录。首次用Attachment库时自动出现，不用手动建。 */
export async function ensureRootFolders(userId: number): Promise<{ root: Folder; hub: Folder }> {
	const db = getDb();
	const now = nowIso();
	const existing = await db
		.prepare("SELECT id, name, parent_id, purpose, created_at FROM attachment_folders WHERE owner_id = ? ORDER BY created_at")
		.all(userId) as unknown as FolderRow[];

	let root = existing.find((f) => f.parent_id == null && f.purpose === "general");
	if (!root) {
		const id = newId("fd");
		await db.prepare(
			`INSERT INTO attachment_folders (id, owner_id, parent_id, name, purpose, created_at, updated_at)
			 VALUES (?, ?, NULL, ?, 'general', ?, ?)`
		).run(id, userId, "我的附件库", now, now);
		root = { id, name: "我的附件库", parent_id: null, purpose: "general", created_at: now };
	}
	let hub = existing.find((f) => f.parent_id === root.id && f.purpose === "imagehub");
	if (!hub) {
		const id = newId("fd");
		await db.prepare(
			`INSERT INTO attachment_folders (id, owner_id, parent_id, name, purpose, created_at, updated_at)
			 VALUES (?, ?, ?, ?, 'imagehub', ?, ?)`
		).run(id, userId, root?.id ?? "", "图床", now, now);
		hub = { id, name: "图床", parent_id: root?.id ?? null, purpose: "imagehub", created_at: now };
	}
	return { root: toFolder(root), hub: toFolder(hub) };
}

export async function listFolders(userId: number): Promise<Folder[]> {
	await ensureRootFolders(userId);
	const rows = await getDb()
		.prepare(
			`SELECT id, name, parent_id, purpose, created_at FROM attachment_folders
			  WHERE owner_id = ? ORDER BY purpose = 'imagehub' DESC, created_at ASC`
		)
		.all(userId) as unknown as FolderRow[];
	return rows.map(toFolder);
}

export async function createFolder(userId: number, name: string, parentId: string | null): Promise<Folder> {
	const db = getDb();
	const now = nowIso();
	const clean = (name || "").trim().slice(0, 60) || "新建文件夹";
	// 避免同一层出现同名目录（体验上比允许同名清晰得多）
	let finalName = clean;
	let i = 2;
	while (true) {
		// node:sqlite 只接受 SQLInputValue（number/string/Buffer/null/bigint），
		// 所以这里显式标成这几种而不是 unknown——parentId 为 null 的分支正是要靠它。
		const dup = await db
			.prepare("SELECT 1 FROM attachment_folders WHERE owner_id = ? AND parent_id IS ? AND name = ?")
			.get(userId, parentId, finalName);
		if (!dup) break;
		finalName = `${clean} (${i++})`;
	}
	const id = newId("fd");
	await db.prepare(
		`INSERT INTO attachment_folders (id, owner_id, parent_id, name, purpose, created_at, updated_at)
		 VALUES (?, ?, ?, ?, 'general', ?, ?)`
	).run(id, userId, parentId, finalName, now, now);
	return { id, name: finalName, parentId, purpose: "general", createdAt: now };
}

export async function renameFolder(userId: number, folderId: string, name: string): Promise<void> {
	await getDb()
		.prepare("UPDATE attachment_folders SET name = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
		.run((name || "").trim().slice(0, 60) || "未命名", nowIso(), folderId, userId);
}

/** 删除文件夹：子文件夹与里面所有文件一并删除（R2 对象也会一起清）。 */
export async function deleteFolderDeep(userId: number, folderId: string): Promise<number> {
	const db = getDb();
	const all = await db
		.prepare("SELECT id, parent_id FROM attachment_folders WHERE owner_id = ?")
		.all(userId) as unknown as { id: string; parent_id: string | null }[];
	// 就地收集整棵子树（深度不大，递归够了）
	const children = new Set<string>();
	const walk = (pid: string) => {
		for (const f of all) if (f.parent_id === pid) {
			children.add(f.id);
			walk(f.id);
		}
	};
	walk(folderId);

	// ⚠️ 没有子目录时绝不能拼出 `IN (?, )` —— 那是 SQL 语法错误，
	// 而且只在"删一个空目录"这种最常见的场景才触发，属于典型的没走到的分支。
	const ids = [folderId, ...children];
	const placeholders = ids.map(() => "?").join(",");

	const files = await db
		.prepare(
			`SELECT id, storage_key, original_key FROM attachments
			  WHERE owner_id = ? AND folder_id IN (${placeholders})`
		)
		.all(userId, ...ids) as unknown as { id: string; storage_key: string; original_key: string }[];

	for (const f of files) {
		await safeDeleteObject(f.storage_key);
		if (f.original_key) await safeDeleteObject(f.original_key);
	}
	await db.prepare(`DELETE FROM attachments WHERE owner_id = ? AND folder_id IN (${placeholders})`).run(userId, ...ids);
	await db.prepare(`DELETE FROM attachment_folders WHERE owner_id = ? AND id IN (${placeholders})`).run(userId, ...ids);
	return files.length;
}

// ── 文件查询（一律带 owner 过滤）────────────────────────────────────────────

interface FileRow {
	id: string;
	folder_id: string | null;
	filename: string;
	/** R2 对象键。删文件时靠它定位，也是表里唯一"文件在哪"的依据。 */
	storage_key: string;
	url: string;
	mime: string;
	bytes: number;
	width: number | null;
	height: number | null;
	is_image: number;
	watermark: number;
	variant: string;
	original_key: string;
	original_bytes: number;
	purpose: string;
	created_at: string;
}

/** 目录表的原始行（下划线命名）；对外一律转成 camelCase 的 Folder。 */
interface FolderRow {
	id: string;
	name: string;
	parent_id: string | null;
	purpose: string;
	created_at: string;
}

function toFolder(r: FolderRow): Folder {
	return {
		id: r.id,
		name: r.name,
		parentId: r.parent_id ?? null,
		purpose: r.purpose,
		createdAt: r.created_at
	};
}

function toFile(r: FileRow): LibraryFile {
	return {
		id: r.id,
		folderId: r.folder_id ?? null,
		filename: r.filename,
		url: r.url,
		mime: r.mime,
		bytes: r.bytes,
		width: r.width ?? null,
		height: r.height ?? null,
		isImage: !!r.is_image,
		watermark: !!r.watermark,
		variant: r.variant,
		hasOriginal: !!r.original_key,
		originalBytes: r.original_bytes ?? 0,
		purpose: r.purpose,
		createdAt: r.created_at,
	};
}

export interface ListFilesOptions {
	folderId?: string | null;
	kind?: "all" | "image" | "file";
	q?: string;
	limit?: number;
}

export async function listFiles(userId: number, opts: ListFilesOptions = {}): Promise<LibraryFile[]> {
	const where: string[] = ["owner_id = ?"];
	const params: unknown[] = [userId];
	if (opts.folderId) {
		where.push("folder_id = ?");
		params.push(opts.folderId);
	} else if (opts.folderId === null) {
		where.push("folder_id IS NULL");
	}
	if (opts.kind === "image") where.push("is_image = 1");
	else if (opts.kind === "file") where.push("is_image = 0");
	if (opts.q) {
		where.push("(filename LIKE ? OR url LIKE ?)");
		const like = `%${opts.q}%`;
		params.push(like, like);
	}
	const limit = Math.min(500, Math.max(1, opts.limit ?? 200));
	const rows = await getDb()
		.prepare(
			`SELECT * FROM attachments WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ${limit}`
		)
		.all(...(params as never[])) as unknown as FileRow[];
	return rows.map(toFile);
}

export async function getFile(userId: number, id: string): Promise<LibraryFile | null> {
	const r = await getDb().prepare("SELECT * FROM attachments WHERE id = ? AND owner_id = ?").get(id, userId) as
		| FileRow
		| undefined;
	return r ? toFile(r) : null;
}

// ── 上传 ────────────────────────────────────────────────────────────────────

export interface SaveUploadInput {
	userId: number;
	filename: string;
	data: Uint8Array;
	mime: string;
	/** 图片压缩目标：avif（默认）/ webp / original */
	format?: TargetFormat;
	/** 水印开关（默认开） */
	watermark?: boolean;
	/** 一键压缩场景：先把原图另存一份，之后再覆盖编码产物 */
	keepOriginal?: boolean;
	folderId?: string | null;
	purpose?: "upload" | "avatar";
	/** 头像走更严的画质（avif q55 在小图上会发糊） */
	quality?: number;
	maxEdge?: number | null;
}

export interface SaveUploadResult {
	file: LibraryFile;
	/** 压缩/水印是否真的做了；false 表示"原样存了"（可能是非图片或用户选了原图） */
	processed: boolean;
	compressionRatio: number | null;
}

/**
 * 上传一个文件到个人库。
 * 配额不够时**先扣不下来就直接退**，绝不做"先传后删"的补救——那会在并发时把别人的文件卷进去。
 */
export async function saveUpload(input: SaveUploadInput): Promise<SaveUploadResult> {
	const db = getDb();
	const purpose = input.purpose ?? "upload";
	const isImage = (input.mime || "").startsWith("image/") || /\.(jpe?g|png|webp|avif|gif)$/i.test(input.filename);

	// 1) 配额预检：先算「加上这个文件会是多少」
	const usage = await usageOf(input.userId);
	const incoming = input.data.byteLength;
	if (usage.usedBytes + incoming > usage.quotaBytes) {
		throw new QuotaExceededError(usage, incoming);
	}

	// 2) 图片走管线；非图片原样保留字节（只做体积与类型校验）
	let finalData = input.data;
	let finalMime = input.mime || "application/octet-stream";
	let finalExt = extOf(input.filename) || "bin";
	let width: number | null = null;
	let height: number | null = null;
	let processed = false;
	let originalKey = "";
	let originalBytes = 0;
	let watermark = input.watermark ?? true;
	let variant: string = "original";

	if (isImage) {
		const probed = await probeImage(input.data);
		if (probed) {
			width = probed.width;
			height = probed.height;
		}
		// 水印只对图片有意义；用户关掉就关掉，别自作主张
		const wantFormat: TargetFormat = input.format ?? "avif";
		const res = await processImage(input.data, {
			format: wantFormat,
			watermark,
			watermarkText: process.env.SITE_NAME || "Stelarith",
			maxEdge: input.maxEdge ?? 2560,
			quality: input.quality ?? 80,
		});
		finalData = res.buffer;
		finalMime = res.mime;
		finalExt = res.ext;
		width = res.width || width;
		height = res.height || height;
		variant = wantFormat;
		processed = true;
		if (input.keepOriginal) {
			// 原图另存一份，键不同，随时可还原
			originalBytes = input.data.byteLength;
		}
	} else {
		// 非图片：绝不给它加水印（那是图片专属能力）
		watermark = false;
	}

	const now = new Date();
	const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
	const baseKey = `u/${input.userId}/${ym}/${crypto.randomBytes(6).toString("hex")}`;
	const mainKey = `${baseKey}.${finalExt}`;

	// 3) 上传主产物
	const put = await putObject(mainKey, finalData, finalMime);

	// 4) 需要留原图 → 再传一份
	if (originalBytes > 0) {
		const origExt = extOf(input.filename) || "bin";
		originalKey = `${baseKey}.orig.${origExt}`;
		await putObject(originalKey, input.data, input.mime || "application/octet-stream");
	}

	// 5) 落元数据（真源），顺序不能倒：对象先到位，元数据后写，写失败还能手动补。
	const id = newId("at");
	const filename = safeFilename(input.filename);
	await db.prepare(
		`INSERT INTO attachments
		   (id, owner_id, folder_id, filename, storage_key, url, mime, bytes, sha256,
		    width, height, is_image, watermark, variant, original_key, original_bytes, purpose, created_at)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
	).run(
		id,
		input.userId,
		input.folderId ?? null,
		filename,
		mainKey,
		put.url,
		finalMime,
		finalData.byteLength,
		crypto.createHash("sha256").update(finalData).digest("hex"),
		width,
		height,
		isImage ? 1 : 0,
		watermark ? 1 : 0,
		variant,
		originalKey,
		originalBytes,
		purpose,
		nowIso()
	);

	const row = await db.prepare("SELECT * FROM attachments WHERE id = ?").get(id) as unknown as FileRow;
	return {
		file: toFile(row),
		processed,
		compressionRatio: processed && input.data.byteLength > 0 ? finalData.byteLength / input.data.byteLength : null,
	};
}

export class QuotaExceededError extends Error {
	// 这里刻意不用 TS 的「构造函数参数属性」（constructor(public usage: …)）：
	// 那种写法只有完整 TS 转译能处理，Node 的 strip-types 直跑源码会直接报语法错，
	// 于是本地想直接 `node xxx.ts` 做一次性验证就跑不起来。显式赋值没这个坑。
	usage: UsageInfo;
	incoming: number;
	constructor(usage: UsageInfo, incoming: number) {
		super(
			`个人空间不足：当前已用 ${(usage.usedBytes / MB).toFixed(1)} MB / 配额 ` +
				`${(usage.quotaBytes / MB).toFixed(0)} MB，本次文件 ${(incoming / MB).toFixed(1)} MB。`
		);
		this.name = "QuotaExceededError";
		this.usage = usage;
		this.incoming = incoming;
	}
}

function extOf(name: string): string {
	const m = /\.([a-z0-9]+)$/i.exec(name || "");
	return m ? m[1].toLowerCase() : "";
}

/** 文件名净化：去掉路径分隔符与控制字符，防止 R2 键与展示名出现歧义。 */
function safeFilename(name: string): string {
	const base = (name || "attachment").split(/[\\/]/).pop() || "attachment";
	return base.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120) || "attachment";
}

async function safeDeleteObject(key: string): Promise<void> {
	try {
		await deleteObject(key);
	} catch {
		// 对象已经不在（换过域名/手工清理过）不该让元数据清理失败——元数据才是真源
	}
}

// ── 编辑 / 删除 ─────────────────────────────────────────────────────────────

export async function renameFile(userId: number, id: string, filename: string): Promise<void> {
	await getDb()
		.prepare("UPDATE attachments SET filename = ? WHERE id = ? AND owner_id = ?")
		.run(safeFilename(filename), id, userId);
}

export async function moveFile(userId: number, id: string, folderId: string | null): Promise<void> {
	await getDb().prepare("UPDATE attachments SET folder_id = ? WHERE id = ? AND owner_id = ?").run(folderId, id, userId);
}

export async function setFileWatermark(userId: number, id: string, on: boolean): Promise<void> {
	// 只有图片才谈得上"关水印"；给非图片开没有意义
	await getDb()
		.prepare("UPDATE attachments SET watermark = ? WHERE id = ? AND owner_id = ? AND is_image = 1")
		.run(on ? 1 : 0, id, userId);
}

export async function deleteFile(userId: number, id: string): Promise<void> {
	const db = getDb();
	const row = await db.prepare("SELECT * FROM attachments WHERE id = ? AND owner_id = ?").get(id, userId) as
		| FileRow
		| undefined;
	if (!row) return;
	// 先删元数据（真源），再清对象：元数据先没了，对象就成孤儿；
	// 反过来若对象删失败，元数据还在，下次清理还能兜到。
	await db.prepare("DELETE FROM attachments WHERE id = ? AND owner_id = ?").run(id, userId);
	await safeDeleteObject(row.storage_key);
	if (row.original_key) await safeDeleteObject(row.original_key);
}

// ── 一键压缩 / 还原原图 ─────────────────────────────────────────────────────

export interface RecompressResult {
	before: number;
	after: number;
	savedBytes: number;
	savedPercent: number;
	appliedFormat: string;
}

/**
 * 对一张已有图片重新编码（一键压缩）。
 * `keepOriginal=true` 时不动原图：把**当前产物**退回当 original_key 另存，
 * 用户随时能一键还原；之前那份 original_key（若存在）会被顶替。
 */
export async function recompressFile(
	userId: number,
	id: string,
	format: "avif" | "webp",
	opts: { watermark?: boolean; keepOriginal?: boolean; quality?: number } = {}
): Promise<RecompressResult> {
	const db = getDb();
	const row = await db.prepare("SELECT * FROM attachments WHERE id = ? AND owner_id = ? AND is_image = 1").get(id, userId) as
		| FileRow
		| undefined;
	if (!row) throw new Error("图片不存在或无权操作");

	// 要重压就得先把当前产物（或原图）取回来；这里直接从 R2 拉最新字节，
	// 避免"磁盘上是什么"和"表里记的是什么"打架。
	const { getObject } = await import("./storage/r2.js");
	const cur = await getObject(row.storage_key);
	if (!cur) throw new Error("原文件已不在存储中，请重新上传");

	const before = row.bytes;
	// 压缩后画质调高一档：一键压缩是"顺手省点空间"，别把图压成马赛克
	const res = await processImage(cur.body as unknown as Uint8Array, {
		format,
		watermark: opts.watermark ?? !!row.watermark,
		watermarkText: process.env.SITE_NAME || "Stelarith",
		maxEdge: null,
		quality: opts.quality ?? 82,
	});

	const baseKey = row.storage_key.replace(/\.[a-z0-9]+$/i, "");
	const newKey = `${baseKey}.${res.ext}`;
	await putObject(newKey, res.buffer, res.mime);

	// 保留原图：把本次新产物当"新原图"留底；若这次就是要保留原图，则把用户上传的那一版留下。
	let originalKey = row.original_key;
	let originalBytes = row.original_bytes;
	if (opts.keepOriginal) {
		// 键的后缀要跟**被留存内容的真实格式**一致（即当前产物的扩展名），
		// 不能用新格式的 res.ext —— 否则会出现"文件内容是 avif、键却叫 .webp"的错位，
		// 还原时 MIME 与字节对不上，某些浏览器会直接拒绝渲染。
		const keepExt = extOf(row.storage_key) || res.ext;
		const keepKey = `${baseKey}.orig.${keepExt}`;
		await putObject(keepKey, cur.body as unknown as Uint8Array, row.mime);
		// 顶替下来的旧原图已经没人引用了，留着就是孤儿对象：占着 R2 空间却不计入配额，
		// 用户永远也删不掉它。所以这里必须一起清掉。
		if (row.original_key && row.original_key !== keepKey) await safeDeleteObject(row.original_key);
		originalKey = keepKey;
		originalBytes = before;
	}

	await db.prepare(
		`UPDATE attachments SET storage_key = ?, url = ?, mime = ?, bytes = ?, variant = ?,
		        original_key = ?, original_bytes = ?
		  WHERE id = ? AND owner_id = ?`
	).run(
		newKey,
		publicUrlFor(newKey),
		res.mime,
		res.bytes,
		format,
		originalKey,
		originalBytes,
		id,
		userId
	);

	// ⚠️ 同格式重压时 newKey 与旧 key 完全相同（都是 <base>.avif），
	// 此时绝不能删——否则刚上传的新产物会把自己删掉，文件凭空消失。
	if (newKey !== row.storage_key) await safeDeleteObject(row.storage_key);

	return {
		before,
		after: res.bytes,
		savedBytes: Math.max(0, before - res.bytes),
		savedPercent: before > 0 ? Math.max(0, Math.round(((before - res.bytes) / before) * 100)) : 0,
		appliedFormat: res.ext.toUpperCase(),
	};
}

/** 还原到用户上传的原始版本（需要 original_key 存在）。 */
export async function restoreOriginal(userId: number, id: string): Promise<RecompressResult> {
	const db = getDb();
	const row = await db.prepare("SELECT * FROM attachments WHERE id = ? AND owner_id = ?").get(id, userId) as
		| FileRow
		| undefined;
	if (!row || !row.original_key) throw new Error("这个附件没有留存原图");

	const { getObject } = await import("./storage/r2.js");
	const orig = await getObject(row.original_key);
	if (!orig) throw new Error("原图副本已失效，无法还原");

	const before = row.bytes;
	const baseKey = row.storage_key.replace(/\.[a-z0-9]+$/i, "");
	const origExt = extOf(row.original_key) || "png";
	const newKey = `${baseKey}.restore.${origExt}`;
	await putObject(newKey, orig.body as unknown as Uint8Array, orig.contentType || row.mime);

	await db.prepare(
		`UPDATE attachments SET storage_key = ?, url = ?, mime = ?, bytes = ?, variant = 'original'
		  WHERE id = ? AND owner_id = ?`
	).run(newKey, publicUrlFor(newKey), orig.contentType || row.mime, (orig.body as unknown as Uint8Array).byteLength, id, userId);

	// 与重压同理：新键带 .restore 后缀，正常不会撞名，但仍然先比一次再删，
	// 免得将来改键规则时踩到"删掉刚写的对象"。
	if (newKey !== row.storage_key) await safeDeleteObject(row.storage_key);
	return {
		before,
		after: (orig.body as unknown as Uint8Array).byteLength,
		savedBytes: 0,
		savedPercent: 0,
		appliedFormat: "原始",
	};
}

// 外链统一由 r2.ts 的 publicUrlForKey 生成——key 前缀规则只在那一个地方定义，
// 想换域名/换前缀只改环境变量即可，这里绝不能自己拼字符串。
function publicUrlFor(key: string): string {
	return publicUrlForKey(key);
}

// ── 后台跨账号视图（唯一例外，函数名带 admin 是警示）─────────────────────────

export interface AdminUserUsage {
	userId: number;
	username: string;
	displayName: string;
	role: string;
	usedBytes: number;
	quotaBytes: number;
	bonusBytes: number;
	level: number;
	files: number;
	images: number;
}

export async function adminUsageOverview(): Promise<AdminUserUsage[]> {
	const db = getDb();
	const users = await db
		.prepare("SELECT id, username, display_name, role, xp, quota_bonus_bytes FROM users ORDER BY id")
		.all() as unknown as {
		id: number;
		username: string;
		display_name: string;
		role: string;
		xp: number;
		quota_bonus_bytes: number;
	}[];
	const usages = await Promise.all(
		users.map(async (u) => {
			const agg = await db
				.prepare(
					`SELECT COALESCE(SUM(bytes),0) AS used, COUNT(*) AS n, COALESCE(SUM(is_image),0) AS imgs
					   FROM attachments WHERE owner_id = ?`
				)
				.get(u.id) as { used: number; n: number; imgs: number };
			const bonus = Math.max(0, u.quota_bonus_bytes ?? 0);
			return {
				userId: u.id,
				username: u.username,
				displayName: u.display_name || u.username,
				role: u.role,
				usedBytes: Number(agg.used) || 0,
				quotaBytes: quotaBytes(u.xp ?? 0, bonus),
				bonusBytes: bonus,
				level: xpToLevel(u.xp ?? 0),
				files: Number(agg.n) || 0,
				images: Number(agg.imgs) || 0,
			};
		})
	);
	return usages.sort((a, b) => b.usedBytes - a.usedBytes);
}

/** 后台强制清空某人全部附件（不可恢复，需二次确认）。 */
export async function adminPurgeUser(userId: number): Promise<number> {
	const db = getDb();
	const rows = await db.prepare("SELECT storage_key, original_key FROM attachments WHERE owner_id = ?").all(userId) as unknown as {
		storage_key: string;
		original_key: string;
	}[];
	for (const r of rows) {
		await safeDeleteObject(r.storage_key);
		if (r.original_key) await safeDeleteObject(r.original_key);
	}
	await db.prepare("DELETE FROM attachments WHERE owner_id = ?").run(userId);
	await db.prepare("DELETE FROM attachment_folders WHERE owner_id = ?").run(userId);
	return rows.length;
}

/** 后台给用户加/减额外配额（MiB）。 */
export async function adminSetBonusQuota(userId: number, mib: number): Promise<void> {
	const bytes = Number.isFinite(mib) && mib > 0 ? Math.round(mib * 1024 * 1024) : 0;
	await getDb().prepare("UPDATE users SET quota_bonus_bytes = ? WHERE id = ?").run(bytes, userId);
}
