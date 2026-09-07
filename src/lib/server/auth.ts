import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Role } from "$lib/permissions.js";

export interface User {
	username: string;
	passwordHash: string;
	salt: string;
	displayName: string;
	role: Role;
	createdAt: string;
}

const USERS_FILE = path.resolve("content", "users.json");

function ensureUsersFile() {
	if (!fs.existsSync(USERS_FILE)) {
		// Seed default admin. Password comes from ADMIN_PASSWORD when provided;
		// otherwise a strong random one is generated so no credential is ever
		// hardcoded in the repository. The value is printed once to the log.
		const generated = !process.env.ADMIN_PASSWORD;
		const seedPassword = process.env.ADMIN_PASSWORD || crypto.randomBytes(18).toString("base64url");
		const salt = crypto.randomBytes(16).toString("hex");
		const passwordHash = hashPassword(seedPassword, salt);
		const users: User[] = [{
			username: "admin",
			passwordHash,
			salt,
			displayName: "管理员",
			role: "admin",
			createdAt: new Date().toISOString()
		}];
		fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
		fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2), "utf-8");
		if (generated) {
			console.log(`[auth] 已初始化管理员账号 admin，随机生成的初始密码：${seedPassword}`);
			console.log("[auth] 此密码仅显示一次，请登录后立即修改。也可通过环境变量 ADMIN_PASSWORD 预设。");
		}
	}
}

export function getUsers(): User[] {
	ensureUsersFile();
	reconcileAdmin();
	try {
		const raw = fs.readFileSync(USERS_FILE, "utf-8");
		const data = JSON.parse(raw);
		return Array.isArray(data) ? data : data.users || [];
	} catch {
		return [];
	}
}

// 内置 admin 的密码以环境变量 ADMIN_PASSWORD 为权威来源：
// 首次播种时若未设置则生成随机密码；但一旦后续在 .env 中设置了
// ADMIN_PASSWORD，已存在的 users.json 不会自动回写，导致"设了密码却登不上"。
// 这里在每次读取用户时（模块级只跑一次）把 admin 哈希对齐到环境变量，
// 保证文档化的 ADMIN_PASSWORD 始终能登录，避免被首次随机种子锁死。
let adminReconciled = false;
function reconcileAdmin() {
	if (adminReconciled) return;
	adminReconciled = true;
	const envPw = process.env.ADMIN_PASSWORD;
	if (!envPw) return;
	let users: User[];
	try {
		const raw = fs.readFileSync(USERS_FILE, "utf-8");
		const data = JSON.parse(raw);
		users = Array.isArray(data) ? data : data.users || [];
	} catch {
		return;
	}
	const admin = users.find((u) => u.username === "admin");
	if (!admin) return;
	const expected = hashPassword(envPw, admin.salt);
	if (expected !== admin.passwordHash) {
		admin.passwordHash = expected;
		saveUsers(users);
	}
}

function saveUsers(users: User[]) {
	fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
	fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2), "utf-8");
}

export function hashPassword(password: string, salt: string): string {
	return crypto.scryptSync(password, salt, 64).toString("hex");
}

export function verifyLogin(username: string, password: string): User | null {
	const users = getUsers();
	const user = users.find(u => u.username === username);
	if (!user) return null;
	const hash = hashPassword(password, user.salt);
	if (hash !== user.passwordHash) return null;
	return user;
}

export function createUser(username: string, password: string, displayName: string, role: Role = "editor"): { ok: boolean; error?: string } {
	if (!username.trim() || !password || password.length < 6) {
		return { ok: false, error: "用户名不能为空，密码至少 6 位" };
	}
	const users = getUsers();
	if (users.some(u => u.username === username)) {
		return { ok: false, error: "用户名已存在" };
	}
	const salt = crypto.randomBytes(16).toString("hex");
	const user: User = {
		username: username.trim(),
		passwordHash: hashPassword(password, salt),
		salt,
		displayName: displayName.trim() || username.trim(),
		role,
		createdAt: new Date().toISOString()
	};
	users.push(user);
	saveUsers(users);
	return { ok: true };
}

export function deleteUser(username: string): { ok: boolean; error?: string } {
	if (username === "admin") {
		return { ok: false, error: "不能删除内置管理员" };
	}
	const users = getUsers();
	const remaining = users.filter(u => u.username !== username);
	if (remaining.length === users.length) {
		return { ok: false, error: "用户不存在" };
	}
	saveUsers(remaining);
	return { ok: true };
}

export function changePassword(username: string, newPassword: string): { ok: boolean; error?: string } {
	if (!newPassword || newPassword.length < 6) {
		return { ok: false, error: "密码至少 6 位" };
	}
	const users = getUsers();
	const user = users.find(u => u.username === username);
	if (!user) return { ok: false, error: "用户不存在" };
	user.salt = crypto.randomBytes(16).toString("hex");
	user.passwordHash = hashPassword(newPassword, user.salt);
	saveUsers(users);
	return { ok: true };
}

export function makeToken(user: User): string {
	return crypto.createHash("sha256").update(user.username + ":" + user.salt + ":" + user.passwordHash).digest("hex");
}

export function verifyToken(token: string | undefined | null): User | null {
	if (!token) return null;
	const users = getUsers();
	for (const user of users) {
		if (makeToken(user) === token) return user;
	}
	return null;
}

// Legacy single-password env fallback removed: it carried a hardcoded credential.
// Authentication is driven entirely by content/users.json (never committed).