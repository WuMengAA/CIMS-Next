/**
 * 项目展板数据层 —— 「类 GitHub 展板」的落库与检索。
 *
 * 分工（刻意的双层存储）：
 * - **配置型数据**（仓库绑定、待办、里程碑、发行记录、同步缓存、活跃度桶）→
 *   `content/project-boards.json`。它们是「少量、按项目整条读写、需要人肉可读可版本管理」，
 *   沿用本仓库 content/*.json 的既有惯例，且能直接 git diff。
 * - **用户生成数据**（Issues 与评论）→ SQLite（见 db.ts 的 board_issues / board_issue_comments）。
 *   它们需要项目内自增编号、状态流转、按状态分页查询，是关系型语义。
 *
 * 写入策略：JSON 用「临时文件 + rename」原子替换，避免同步过程中途崩溃留下半截文件；
 * 内存缓存按 mtime 失效，多个 API 并发读同一份不会重复解析。
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getDb, nowIso } from "./db.js";
import {
	parseRepoUrl,
	fetchRepo,
	fetchCommitBuckets,
	fetchReleases,
	hasGithubToken,
	GithubError,
	type RepoMeta
} from "./github.js";

import { CONTENT_DIR } from "./paths.js";
const BOARD_FILE = path.join(CONTENT_DIR, "project-boards.json");

export interface Todo {
	id: string;
	title: string;
	done: boolean;
	/** 分组名（如「核心」「体验」「基建」），空串表示未分组 */
	group: string;
	order: number;
}

export interface Milestone {
	id: string;
	title: string;
	due: string;
	state: "open" | "done";
}

export interface BoardRelease {
	id: string;
	tag: string;
	name: string;
	notes: string;
	/** 站内上传的文件名（相对 uploads/），站内发行才有 */
	file: string;
	/** 最终下载地址：站内 /uploads/xxx 或 GitHub 资产 URL */
	url: string;
	size: number;
	createdAt: string;
	downloads: number;
	prerelease: boolean;
	/** 来源：local=站内上传，github=从仓库发行同步而来 */
	source: "local" | "github";
}

export interface BoardSync {
	at: string;
	fullName: string;
	description: string;
	homepage: string;
	language: string;
	license: string;
	stars: number;
	forks: number;
	watchers: number;
	openIssues: number;
	defaultBranch: string;
	pushedAt: string;
	createdAt: string;
	archived: boolean;
	topics: string[];
	/** 本次同步是否处于匿名模式（无 GITHUB_TOKEN），前端据此提示配额风险 */
	anonymous: boolean;
	/** 提交历史是否因页数上限被截断 */
	truncated: boolean;
	/** 近一年提交总数 */
	commitTotal: number;
	error?: string;
}

export interface ProjectBoard {
	slug: string;
	/** 仓库标识 `owner/name`，空串表示尚未绑定 */
	repo: string;
	todos: Todo[];
	milestones: Milestone[];
	releases: BoardRelease[];
	sync: BoardSync | null;
	/** 活跃度：'YYYY-MM-DD' -> 提交次数 */
	contrib: Record<string, number>;
	/** 手动置顶的自述（覆盖 GitHub description） */
	tagline: string;
	updatedAt: string;
}

export interface BoardIssue {
	id: number;
	number: number;
	projectSlug: string;
	title: string;
	body: string;
	author: string;
	state: "open" | "closed";
	labels: string[];
	pinned: boolean;
	createdAt: string;
	updatedAt: string;
	closedAt: string;
	closedBy: string;
	commentCount?: number;
}

export interface BoardIssueComment {
	id: number;
	issueId: number;
	author: string;
	body: string;
	createdAt: string;
}

// ── JSON 读写（原子 + mtime 缓存）──────────────────────────────────────────

let _cache: ProjectBoard[] | null = null;
let _cacheMtime = -1;

function readAll(): ProjectBoard[] {
	if (!fs.existsSync(BOARD_FILE)) {
		_cache = [];
		_cacheMtime = -1;
		return [];
	}
	const mtime = fs.statSync(BOARD_FILE).mtimeMs;
	if (_cache && _cacheMtime === mtime) return _cache;
	try {
		const parsed = JSON.parse(fs.readFileSync(BOARD_FILE, "utf8"));
		_cache = Array.isArray(parsed) ? parsed.map(normalize) : [];
	} catch (err) {
		console.warn("[board] project-boards.json 解析失败，按空处理：", err);
		_cache = [];
	}
	_cacheMtime = mtime;
	return _cache;
}

function writeAll(list: ProjectBoard[]): void {
	fs.mkdirSync(CONTENT_DIR, { recursive: true });
	const tmp = `${BOARD_FILE}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(list, null, 2), "utf8");
	fs.renameSync(tmp, BOARD_FILE);
	_cache = list;
	_cacheMtime = fs.statSync(BOARD_FILE).mtimeMs;
}

function newId(prefix: string): string {
	return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

/** 兼容手写/旧版数据：补齐缺省字段，避免前端到处判空。 */
function normalize(raw: any): ProjectBoard {
	return {
		slug: String(raw?.slug ?? ""),
		repo: String(raw?.repo ?? ""),
		todos: Array.isArray(raw?.todos)
			? raw.todos.map((t: any, i: number) => ({
					id: String(t?.id ?? newId("todo")),
					title: String(t?.title ?? ""),
					done: !!t?.done,
					group: String(t?.group ?? ""),
					order: Number.isFinite(t?.order) ? Number(t.order) : i
				}))
			: [],
		milestones: Array.isArray(raw?.milestones)
			? raw.milestones.map((m: any) => ({
					id: String(m?.id ?? newId("ms")),
					title: String(m?.title ?? ""),
					due: String(m?.due ?? ""),
					state: m?.state === "done" ? "done" : "open"
				}))
			: [],
		releases: Array.isArray(raw?.releases)
			? raw.releases.map((r: any) => ({
					id: String(r?.id ?? newId("rel")),
					tag: String(r?.tag ?? ""),
					name: String(r?.name ?? r?.tag ?? ""),
					notes: String(r?.notes ?? ""),
					file: String(r?.file ?? ""),
					url: String(r?.url ?? ""),
					size: Number(r?.size ?? 0),
					createdAt: String(r?.createdAt ?? nowIso()),
					downloads: Number(r?.downloads ?? 0),
					prerelease: !!r?.prerelease,
					source: r?.source === "github" ? "github" : "local"
				}))
			: [],
		sync: raw?.sync ?? null,
		contrib: raw?.contrib && typeof raw.contrib === "object" ? raw.contrib : {},
		tagline: String(raw?.tagline ?? ""),
		updatedAt: String(raw?.updatedAt ?? nowIso())
	};
}

// ── 展板读取 ───────────────────────────────────────────────────────────────

export function getBoards(): ProjectBoard[] {
	return readAll();
}

export function getBoard(slug: string): ProjectBoard | null {
	return readAll().find((b) => b.slug === slug) ?? null;
}

/** 取展板；不存在则以「空展板」形式即时创建并落盘（后台首次配置时用）。 */
export function ensureBoard(slug: string): ProjectBoard {
	const list = readAll();
	const found = list.find((b) => b.slug === slug);
	if (found) return found;
	const fresh = normalize({ slug, updatedAt: nowIso() });
	writeAll([...list, fresh]);
	return fresh;
}

export function saveBoard(slug: string, patch: Partial<ProjectBoard>): ProjectBoard {
	const list = readAll();
	const idx = list.findIndex((b) => b.slug === slug);
	const base = idx >= 0 ? list[idx] : normalize({ slug });
	const next: ProjectBoard = {
		...base,
		...patch,
		slug, // slug 不可被 patch 覆盖
		todos: patch.todos ? normalize({ todos: patch.todos }).todos : base.todos,
		milestones: patch.milestones ? normalize({ milestones: patch.milestones }).milestones : base.milestones,
		releases: patch.releases ? normalize({ releases: patch.releases }).releases : base.releases,
		contrib: patch.contrib ?? base.contrib,
		updatedAt: nowIso()
	};
	if (idx >= 0) list[idx] = next;
	else list.push(next);
	writeAll(list);
	return next;
}

export function deleteBoard(slug: string): boolean {
	const list = readAll();
	const next = list.filter((b) => b.slug !== slug);
	if (next.length === list.length) return false;
	writeAll(next);
	return true;
}

// ── 待办 ───────────────────────────────────────────────────────────────────

export function setTodos(slug: string, todos: Todo[]): ProjectBoard {
	return saveBoard(slug, { todos });
}

/** 进度 = 已完成 / 总数。无待办时返回 null，让前端显示「未规划」而不是误导性的 0%。 */
export function progressOf(board: ProjectBoard | null): { done: number; total: number; percent: number } | null {
	if (!board || board.todos.length === 0) return null;
	const done = board.todos.filter((t) => t.done).length;
	const total = board.todos.length;
	return { done, total, percent: Math.round((done / total) * 100) };
}

// ── 发行 ───────────────────────────────────────────────────────────────────

export function addRelease(
	slug: string,
	input: Omit<BoardRelease, "id" | "createdAt" | "downloads" | "source"> & { source?: "local" | "github" }
): ProjectBoard {
	const board = ensureBoard(slug);
	const rel: BoardRelease = {
		id: newId("rel"),
		createdAt: nowIso(),
		downloads: 0,
		source: input.source ?? "local",
		tag: input.tag,
		name: input.name || input.tag,
		notes: input.notes ?? "",
		file: input.file ?? "",
		url: input.url ?? "",
		size: input.size ?? 0,
		prerelease: !!input.prerelease
	};
	return saveBoard(slug, { releases: [rel, ...board.releases] });
}

export function deleteRelease(slug: string, id: string): ProjectBoard {
	const board = ensureBoard(slug);
	return saveBoard(slug, { releases: board.releases.filter((r) => r.id !== id) });
}

/** 下载计数 +1（下载路由调用）。 */
export function bumpDownload(slug: string, id: string): boolean {
	const board = getBoard(slug);
	if (!board) return false;
	const rel = board.releases.find((r) => r.id === id);
	if (!rel) return false;
	rel.downloads += 1;
	saveBoard(slug, { releases: board.releases });
	return true;
}

// ── 同步 ───────────────────────────────────────────────────────────────────

function errorSync(message: string): BoardSync {
	return {
		at: nowIso(),
		fullName: "",
		description: "",
		homepage: "",
		language: "",
		license: "",
		stars: 0,
		forks: 0,
		watchers: 0,
		openIssues: 0,
		defaultBranch: "main",
		pushedAt: "",
		createdAt: "",
		archived: false,
		topics: [],
		anonymous: !hasGithubToken(),
		truncated: false,
		commitTotal: 0,
		error: message
	};
}

function syncFromMeta(meta: RepoMeta, commits: { buckets: Record<string, number>; truncated: boolean; total: number }): BoardSync {
	return {
		at: nowIso(),
		fullName: meta.fullName,
		description: meta.description,
		homepage: meta.homepage,
		language: meta.language,
		license: meta.license,
		stars: meta.stars,
		forks: meta.forks,
		watchers: meta.watchers,
		openIssues: meta.openIssues,
		defaultBranch: meta.defaultBranch,
		pushedAt: meta.pushedAt,
		createdAt: meta.createdAt,
		archived: meta.archived,
		topics: meta.topics,
		anonymous: meta.anonymous,
		truncated: commits.truncated,
		commitTotal: commits.total
	};
}

/**
 * 同步单个项目的仓库数据。
 * 失败不抛异常，而是把错误写进 `sync.error` —— 批量同步时一个仓库失败不应中断整批。
 */
export async function syncBoard(
	slug: string,
	opts: { withReleases?: boolean; repoOverride?: string } = {}
): Promise<{ ok: boolean; board: ProjectBoard; error?: string }> {
	const list = readAll();
	let board = list.find((b) => b.slug === slug);

	// 未绑定仓库时，允许从 repoOverride 或空值推断
	const repoRef = (opts.repoOverride ?? board?.repo ?? "").trim();
	const parsed = parseRepoUrl(repoRef);
	if (!parsed) {
		board = saveBoard(slug, { sync: errorSync("未配置有效的仓库地址（需形如 owner/name）") });
		return { ok: false, board, error: "未配置有效的仓库地址" };
	}

	const repo = `${parsed.owner}/${parsed.name}`;
	try {
		const meta = await fetchRepo(parsed.owner, parsed.name);
		const commits = await fetchCommitBuckets(parsed.owner, parsed.name, meta.defaultBranch);

		let releases = board?.releases ?? [];
		if (opts.withReleases) {
			const ghReleases = await fetchReleases(parsed.owner, parsed.name);
			// 保留站内上传（local），用 GitHub 发行覆盖 github 来源的那部分
			const localOnes = releases.filter((r) => r.source === "local");
			const ghOnes: BoardRelease[] = [];
			for (const r of ghReleases) {
				for (const a of r.assets.length ? r.assets : [null as any]) {
					ghOnes.push({
						id: newId("rel"),
						tag: r.tag,
						name: a ? `${r.name} · ${a.name}` : `${r.name}（源码）`,
						notes: r.body ?? "",
						file: "",
						url: a ? a.url : r.url,
						size: a ? a.size : 0,
						createdAt: r.publishedAt || nowIso(),
						downloads: a ? a.downloads : 0,
						prerelease: r.prerelease,
						source: "github"
					});
				}
			}
			releases = [...localOnes, ...ghOnes];
		}

		const next = saveBoard(slug, {
			repo,
			contrib: commits.buckets,
			sync: syncFromMeta(meta, commits),
			...(opts.withReleases ? { releases } : {})
		});
		return { ok: true, board: next };
	} catch (err) {
		const msg = err instanceof GithubError ? err.message : (err as Error).message;
		const next = saveBoard(slug, { repo, sync: errorSync(msg) });
		return { ok: false, board: next, error: msg };
	}
}

/** 批量同步（后台「全部同步」）。串行执行以避免瞬时打爆 GitHub 的二级限流。 */
export async function syncAll(opts: { withReleases?: boolean } = {}): Promise<
	{ slug: string; ok: boolean; error?: string }[]
> {
	const results: { slug: string; ok: boolean; error?: string }[] = [];
	for (const b of readAll()) {
		if (!b.repo) continue;
		const r = await syncBoard(b.slug, opts);
		results.push({ slug: b.slug, ok: r.ok, error: r.error });
	}
	return results;
}

// ── Issues（SQLite）────────────────────────────────────────────────────────

function rowToIssue(r: any): BoardIssue {
	let labels: string[] = [];
	try {
		const parsed = JSON.parse(String(r.labels ?? "[]"));
		if (Array.isArray(parsed)) labels = parsed.map(String);
	} catch {
		/* 坏数据按无标签处理 */
	}
	return {
		id: Number(r.id),
		number: Number(r.number),
		projectSlug: String(r.project_slug),
		title: String(r.title),
		body: String(r.body ?? ""),
		author: String(r.author ?? ""),
		state: r.state === "closed" ? "closed" : "open",
		labels,
		pinned: !!r.pinned,
		createdAt: String(r.created_at),
		updatedAt: String(r.updated_at),
		closedAt: String(r.closed_at ?? ""),
		closedBy: String(r.closed_by ?? ""),
		commentCount: r.comment_count != null ? Number(r.comment_count) : undefined
	};
}

export async function listIssues(
	slug: string,
	opts: { state?: "open" | "closed" | "all"; q?: string; limit?: number } = {}
): Promise<BoardIssue[]> {
	const db = getDb();
	const state = opts.state ?? "all";
	const limit = Math.min(opts.limit ?? 200, 500);
	const where: string[] = ["i.project_slug = ?"];
	const params: any[] = [slug];
	if (state !== "all") {
		where.push("i.state = ?");
		params.push(state);
	}
	if (opts.q?.trim()) {
		where.push("(i.title LIKE ? OR i.body LIKE ?)");
		const like = `%${opts.q.trim()}%`;
		params.push(like, like);
	}
	const rows = await db
		.prepare(
			`SELECT i.*, (SELECT COUNT(*) FROM board_issue_comments c WHERE c.issue_id = i.id) AS comment_count
			 FROM board_issues i
			 WHERE ${where.join(" AND ")}
			 ORDER BY i.pinned DESC, i.number DESC
			 LIMIT ${limit}`
		)
		.all(...params);
	return (await rows as any[]).map(rowToIssue);
}

export async function issueStats(slug: string): Promise<{ open: number; closed: number; total: number }> {
	const db = getDb();
	const rows = await db
		.prepare(`SELECT state, COUNT(*) AS n FROM board_issues WHERE project_slug = ? GROUP BY state`)
		.all(slug) as any[];
	let open = 0;
	let closed = 0;
	for (const r of rows) {
		if (r.state === "closed") closed = Number(r.n);
		else open = Number(r.n);
	}
	return { open, closed, total: open + closed };
}

export async function getIssue(slug: string, number: number): Promise<{ issue: BoardIssue; comments: BoardIssueComment[] } | null> {
	const db = getDb();
	const row = await db
		.prepare(`SELECT * FROM board_issues WHERE project_slug = ? AND number = ?`)
		.get(slug, number) as any;
	if (!row) return null;
	const comments = await db
		.prepare(`SELECT * FROM board_issue_comments WHERE issue_id = ? ORDER BY created_at ASC`)
		.all(row.id) as any[];
	return {
		issue: rowToIssue(row),
		comments: comments.map((c) => ({
			id: Number(c.id),
			issueId: Number(c.issue_id),
			author: String(c.author ?? ""),
			body: String(c.body ?? ""),
			createdAt: String(c.created_at)
		}))
	};
}

export async function createIssue(input: {
	slug: string;
	title: string;
	body?: string;
	author: string;
	labels?: string[];
}): Promise<BoardIssue> {
	const db = getDb();
	const ts = nowIso();
	await db.exec("BEGIN IMMEDIATE");
	try {
		const row = await db
			.prepare(`SELECT COALESCE(MAX(number), 0) AS n FROM board_issues WHERE project_slug = ?`)
			.get(input.slug) as any;
		const next = Number(row?.n ?? 0) + 1;
		await db.prepare(
			`INSERT INTO board_issues (project_slug, number, title, body, author, state, labels, pinned, created_at, updated_at, closed_at, closed_by)
			 VALUES (?, ?, ?, ?, ?, 'open', ?, 0, ?, ?, '', '')`
		).run(
			input.slug,
			next,
			input.title,
			input.body ?? "",
			input.author,
			JSON.stringify(input.labels ?? []),
			ts,
			ts
		);
		await db.exec("COMMIT");
		const created = await db
			.prepare(`SELECT * FROM board_issues WHERE project_slug = ? AND number = ?`)
			.get(input.slug, next) as any;
		return rowToIssue(created);
	} catch (err) {
		await db.exec("ROLLBACK");
		throw err;
	}
}

export async function setIssueState(
	slug: string,
	number: number,
	state: "open" | "closed",
	by: string
): Promise<BoardIssue | null> {
	const db = getDb();
	const ts = nowIso();
	const res = await db
		.prepare(
			`UPDATE board_issues
			 SET state = ?, updated_at = ?, closed_at = ?, closed_by = ?
			 WHERE project_slug = ? AND number = ?`
		)
		.run(state, ts, state === "closed" ? ts : "", state === "closed" ? by : "", slug, number);
	if ((await res).changes === 0) return null;
	const row = await db
		.prepare(`SELECT * FROM board_issues WHERE project_slug = ? AND number = ?`)
		.get(slug, number) as any;
	return rowToIssue(row);
}

export async function setIssueLabels(slug: string, number: number, labels: string[]): Promise<BoardIssue | null> {
	const db = getDb();
	const res = await db
		.prepare(`UPDATE board_issues SET labels = ?, updated_at = ? WHERE project_slug = ? AND number = ?`)
		.run(JSON.stringify(labels), nowIso(), slug, number);
	if ((await res).changes === 0) return null;
	const row = await db
		.prepare(`SELECT * FROM board_issues WHERE project_slug = ? AND number = ?`)
		.get(slug, number) as any;
	return rowToIssue(row);
}

export async function addIssueComment(
	slug: string,
	number: number,
	input: { author: string; body: string }
): Promise<BoardIssueComment | null> {
	const db = getDb();
	const issue = await db
		.prepare(`SELECT id FROM board_issues WHERE project_slug = ? AND number = ?`)
		.get(slug, number) as any;
	if (!issue) return null;
	const ts = nowIso();
	const res = await db
		.prepare(`INSERT INTO board_issue_comments (issue_id, author, body, created_at) VALUES (?, ?, ?, ?)`)
		.run(issue.id, input.author, input.body, ts);
	await db.prepare(`UPDATE board_issues SET updated_at = ? WHERE id = ?`).run(ts, issue.id);
	return { id: Number((await res).lastInsertRowid), issueId: Number(issue.id), author: input.author, body: input.body, createdAt: ts };
}

export async function deleteIssue(slug: string, number: number): Promise<boolean> {
	const db = getDb();
	const issue = await db
		.prepare(`SELECT id FROM board_issues WHERE project_slug = ? AND number = ?`)
		.get(slug, number) as any;
	if (!issue) return false;
	await db.prepare(`DELETE FROM board_issue_comments WHERE issue_id = ?`).run(issue.id);
	const res = await db.prepare(`DELETE FROM board_issues WHERE id = ?`).run(issue.id);
	return res.changes > 0;
}

// ── 聚合视图（前台 /projects 展板视图用）────────────────────────────────────

export interface BoardSummary {
	slug: string;
	title: string;
	excerpt: string;
	category: string;
	date: string;
	repo: string;
	repoUrl: string;
	lang: string;
	license: string;
	stars: number;
	forks: number;
	openIssues: number;
	issues: { open: number; closed: number; total: number };
	progress: { done: number; total: number; percent: number } | null;
	releaseCount: number;
	latestRelease: { tag: string; name: string; url: string; downloads: number } | null;
	commits: number;
	lastSyncAt: string;
	syncError: string;
	hasBoard: boolean;
}

/** 把「内容项」与「展板」合并成前台需要的扁平结构。 */
export async function summarizeBoard(
	item: { slug: string; title: string; excerpt?: string; category?: string; date?: string; repoUrl?: string },
	board: ProjectBoard | null
): Promise<BoardSummary> {
	const p = progressOf(board);
	const issues = await issueStats(item.slug);
	const releases = board?.releases ?? [];
	const latest = releases[0] ?? null;
	return {
		slug: item.slug,
		title: item.title,
		excerpt: item.excerpt ?? "",
		category: item.category ?? "未分类",
		date: item.date ?? "",
		repo: board?.repo ?? "",
		repoUrl: item.repoUrl || (board?.repo ? `https://github.com/${board.repo}` : ""),
		lang: board?.sync?.language ?? "",
		license: board?.sync?.license ?? "",
		stars: board?.sync?.stars ?? 0,
		forks: board?.sync?.forks ?? 0,
		openIssues: board?.sync?.openIssues ?? 0,
		issues,
		progress: p,
		releaseCount: releases.length,
		latestRelease: latest ? { tag: latest.tag, name: latest.name, url: latest.url, downloads: latest.downloads } : null,
		commits: board?.sync?.commitTotal ?? 0,
		lastSyncAt: board?.sync?.at ?? "",
		syncError: board?.sync?.error ?? "",
		hasBoard: !!board && (!!board.repo || board.todos.length > 0 || board.releases.length > 0)
	};
}

/** 全局活跃度：把所有项目的 contrib 相加，供 /projects 顶部的总览热力图。 */
export function mergedContrib(boards: ProjectBoard[]): Record<string, number> {
	const out: Record<string, number> = {};
	for (const b of boards) {
		for (const [d, c] of Object.entries(b.contrib ?? {})) {
			out[d] = (out[d] ?? 0) + Number(c);
		}
	}
	return out;
}
