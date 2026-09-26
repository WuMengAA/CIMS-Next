/**
 * 个人空间配额 —— 与经验等级挂钩的非线性容量模型。
 *
 * 规则（用户口述定死）：
 *   · 起配 100M（Lv.1 新人就有 100M，够用）
 *   · 随等级**非线性**上涨（前期涨得慢、中期加速，体现"越活跃空间越给得起"）
 *   · 上限 1000M 封顶（Lv.6 传奇也到头，避免有人拿它当备份盘）
 *
 * 单位是 MiB（1024 进制），展示时再换算成 M/G。
 *
 * 本模块是**纯函数、零依赖**，前后端共用（配额条要在前端实时算，
 * 上传前的预检也要在服务端兜底，两边必须得出同一个数）。
 */
import { xpToLevel, type Level } from "./permissions.js";

/** 每级容量（MiB）。索引即等级：quotaMiBForLevel(3) === QUOTA_MIB[3]。 */
export const QUOTA_MIB: Record<Level, number> = {
	1: 100,
	2: 180,
	3: 320,
	4: 520,
	5: 780,
	6: 1000
};

/** 起配与封顶，UI 上要显式展示，别让人猜。 */
export const QUOTA_BASE_MIB = QUOTA_MIB[1];
export const QUOTA_MAX_MIB = QUOTA_MIB[6];

/** 等级 → 容量（MiB）。非法等级按 Lv.1 起配，绝不返回 0（否则用户会直接被锁死）。 */
export function quotaMiBForLevel(level: Level | number | null | undefined): number {
	const lv = (typeof level === "number" && level >= 1 && level <= 6 ? Math.floor(level) : 1) as Level;
	return QUOTA_MIB[lv] ?? QUOTA_MIB[1];
}

/** 经验值 → 容量（MiB）。 */
export function quotaMiBForXp(xp: number): number {
	return quotaMiBForLevel(xpToLevel(xp));
}

/**
 * 管理员后台可以给个人「额外配额」（MiB，0 = 不额外加）。
 * 存在 users.quota_bonus_bytes，最终容量 = 等级容量 + 额外配额，仍受 QUOTA_MAX_MIB 之外的上限约束
 * —— 注意：额外配额**可以突破 1000M**，这是刻意给运营留的后门（活动送空间、危机兜底）。
 * 传 null/NaN 视为「不设额外配额」。
 */
export function bonusMiBToBytes(mib: number | null | undefined): number {
	if (mib == null || !Number.isFinite(mib) || mib <= 0) return 0;
	return Math.round(mib * 1024 * 1024);
}

/** 最终配额（字节）。basisXp 决定等级基数，bonusBytes 是管理员额外赠送。 */
export function quotaBytes(xp: number, bonusBytes = 0): number {
	const base = quotaMiBForXp(xp) * 1024 * 1024;
	return base + Math.max(0, Math.floor(bonusBytes || 0));
}

/** 字节 → 人类可读（不足 1M 用 K，避免显示 "0M" 让人以为没配额）。 */
export function formatBytes(bytes: number): string {
	const n = Math.max(0, Math.floor(bytes || 0));
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
	if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
	return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 配额等级线，供 UI 画容量条上的刻度。 */
export const QUOTA_LEVEL_STOPS: { level: Level; mib: number }[] = (
	[1, 2, 3, 4, 5, 6] as Level[]
).map((lv) => ({ level: lv, mib: QUOTA_MIB[lv] }));
