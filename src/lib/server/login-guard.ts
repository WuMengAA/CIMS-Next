/**
 * 登录防爆破（2026-09-27 安全网补强）：账号级 + IP 级双维度计数，
 * 5 次失败锁 15 分钟，指数退避，上限 8 小时。数据落 SQLite，重启不清零。
 */
import { getDb, nowIso } from "./db.js";

const MAX_FAILS = 5;
const LOCK_BASE_MIN = 15;
const LOCK_CAP_MIN = 8 * 60;

export interface LoginLock {
	locked: boolean;
	retryAfterSec: number;
	fail_count: number;
}

async function ensureTable(): Promise<void> {
	await getDb().prepare(
		`CREATE TABLE IF NOT EXISTS login_attempts (
			key         TEXT PRIMARY KEY,
			fail_count  INTEGER NOT NULL DEFAULT 0,
			locked_until TEXT NOT NULL DEFAULT '',
			last_fail_at TEXT NOT NULL DEFAULT ''
		)`
	).run();
}

function keys(username: string, ip: string): string[] {
	const out: string[] = [];
	if (username) out.push("u:" + username.slice(0, 64));
	if (ip) out.push("ip:" + ip.slice(0, 64));
	return out;
}

export async function checkLoginLock(username: string, ip: string): Promise<LoginLock> {
	const now = Date.now();
	await ensureTable();
	const db = getDb();
	let retry = 0;
	let fail = 0;
	for (const k of keys(username, ip)) {
		const row = await db.prepare("SELECT fail_count, locked_until FROM login_attempts WHERE key = ?").get("login:" + k) as
			{ fail_count: number; locked_until: string } | undefined;
		if (!row) continue;
		fail = Math.max(fail, row.fail_count || 0);
		const until = Date.parse(row.locked_until || "");
		if (Number.isFinite(until) && until > now) retry = Math.max(retry, Math.ceil((until - now) / 1000));
	}
	return { locked: retry > 0, retryAfterSec: retry, fail_count: fail };
}

export async function recordLoginFailure(username: string, ip: string): Promise<{ locked: boolean; retryAfterSec: number }> {
	const now = Date.now();
	await ensureTable();
	const db = getDb();
	let locked = false;
	let retry = 0;
	for (const k of keys(username, ip)) {
		const key = "login:" + k;
		const row = await db.prepare("SELECT fail_count, locked_until FROM login_attempts WHERE key = ?").get(key) as
			{ fail_count: number; locked_until: string } | undefined;
		const count = (row?.fail_count || 0) + 1;
		let until = "";
		if (count >= MAX_FAILS) {
			const rounds = Math.floor((count - MAX_FAILS) / MAX_FAILS) + 1;
			const minutes = Math.min(LOCK_BASE_MIN * Math.pow(2, rounds - 1), LOCK_CAP_MIN);
			until = new Date(now + minutes * 60 * 1000).toISOString();
			retry = Math.max(retry, minutes * 60);
			locked = true;
		}
		await db.prepare(
			`INSERT INTO login_attempts (key, fail_count, locked_until, last_fail_at)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(key) DO UPDATE SET
			   fail_count = excluded.fail_count,
			   locked_until = excluded.locked_until,
			   last_fail_at = excluded.last_fail_at`
		).run(key, count, until, nowIso());
	}
	return { locked, retryAfterSec: retry };
}

export async function clearLoginFailures(username: string, ip: string): Promise<void> {
	await ensureTable();
	const db = getDb();
	for (const k of keys(username, ip)) {
		await db.prepare("DELETE FROM login_attempts WHERE key = ?").run("login:" + k);
	}
}
