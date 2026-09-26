/**
 * 班级档案 → 三维档案墙 内容适配器
 * ================================================================================
 * 把「校园-班级档案」的班级数据整形为 Rhinelab 引擎要的 ArchiveContent，
 * 复用原版档案墙（列=年级、每列装一个年级的班级）。
 *
 * 与教程档案（archive-content.ts）不同，这里直接产出 ArchiveRecord，
 * 不再经过 DocInput → toEn 的英文标题推导（中文班名会被 toEn 切成乱码），
 * 由本适配器显式给定 en / department / clearance 等字段。
 *
 * 字段映射（班级 → 档案）：
 *   id         ← C-001 序号
 *   title      ← 「高一（1）班」
 *   en         ← CLASS 1-1（年级序号-班号，档案头行英文标识）
 *   department ← 年级 + 班主任
 *   category   ← 年级（决定落在哪一「列」泳道）
 *   date       ← 建班年份
 *   lead       ← 特色方向
 *   clearance  ← 班级口号（原版密级位，这里借为口号展示）
 *   abstract   ← 班级简介
 *   findings   ← 在册人数 / 特色方向 / 班徽 等要点
 *   source     ← /campus/classes/<年级>-<班号>（详情回链；由宿主 onOpen 接管）
 *   slug       ← <年级>-<班号>
 */

import type { ArchiveContent } from "./archive-content";
import type { ArchiveRecord } from "./data";

/** 班级档案定义（扩展字段） */
export interface ClassProfile {
	/** 年级，如 高一 / 高二 / 高三（同时作为三维墙的「列」） */
	grade: string;
	/** 班号，如 "1" / "2" */
	no: string;
	/** 班主任 */
	teacher: string;
	/** 班级口号 */
	slogan: string;
	/** 班徽 / 标识（emoji 或字符），无则留空 */
	emblem?: string;
	/** 在册人数 */
	members?: number;
	/** 特色方向 / 学科侧重 */
	subject?: string;
	/** 建班年份 */
	founded?: string;
	/** 主题色（hex），用于二维列表渐变与预设联动 */
	accent?: string;
	/** 班级简介（三维墙摘要位） */
	intro?: string;
	/** 标签，如 ["理科","寄宿"] */
	tags?: string[];
}

/** 班级稳定键：<年级>-<班号> */
export function classKey(c: ClassProfile): string {
	return `${c.grade}-${c.no}`;
}

/** 年级 → 序号（高一=1 / 高二=2 / 高三=3），用于英文头行 */
function gradeOrdinal(grade: string): string {
	const m = grade.match(/(\d+)/);
	return m ? m[1] : grade;
}

/**
 * 把班级列表整形为引擎可消费的档案内容。
 * 返回 null 表示没有可展示的班级。
 */
export function buildClassArchiveContent(classes: ClassProfile[]): ArchiveContent | null {
	if (!classes || classes.length === 0) return null;

	// 按年级归列，保留出现顺序作为列序
	const lanes = new Map<string, ClassProfile[]>();
	for (const c of classes) {
		if (!lanes.has(c.grade)) lanes.set(c.grade, []);
		lanes.get(c.grade)!.push(c);
	}

	const columns = [...lanes.keys()];
	const records: ArchiveRecord[] = [];
	let serial = 0;

	for (const lane of columns) {
		for (const c of lanes.get(lane)!) {
			serial += 1;
			const key = classKey(c);
			const intro = c.intro || "";

			const findings: string[] = [];
			if (c.members != null) findings.push(`在册 ${c.members} 人`);
			if (c.subject) findings.push(`特色方向 · ${c.subject}`);
			if (c.emblem) findings.push(`班徽 · ${c.emblem}`);
			if (findings.length === 0) findings.push("（班级档案待补充）");

			records.push({
				id: `C-${String(serial).padStart(3, "0")}`,
				title: `${c.grade}（${c.no}）班`,
				en: `CLASS ${gradeOrdinal(c.grade)}-${c.no}`,
				department: `年级 ${c.grade} · 班主任 ${c.teacher}`,
				category: c.grade,
				date: c.founded || "",
				lead: c.subject || "",
				clearance: c.slogan,
				abstract: intro,
				findings,
				source: `/campus/classes/${key}`,
				slug: key
			});
		}
	}

	return { records, categories: columns, columns };
}

/**
 * 把班级列表整形为「自研 archive-array 卡片墙」要的文档形状。
 * ------------------------------------------------------------------------------
 * 与上面的 buildClassArchiveContent（给 Rhinelab 简化版用）并列，二者共存：
 *   · buildClassArchiveContent → RhineArchive（rhinelab 简化版，docs/archives 在用）
 *   · buildClassDocs           → ArchiveArray（自研完整版，campus/classes 改用它）
 *
 * archive-array 内部会再用 buildArchive() 把 flat docs 切成「分组 → 文章」两级，
 * 分组键取 folder || category，因此这里把二者都设为年级，保证按年级成列。
 *
 * 字段映射（班级 → ArchiveDoc raw）：
 *   slug     ← <年级>-<班号>
 *   title    ← 「高一（1）班」
 *   excerpt  ← 口号 · 简介
 *   category ← 年级
 *   date     ← 建班年份
 *   folder   ← 年级（分组键）
 *   href     ← /campus/classes/<年级>-<班号>（详情回链，由宿主 onOpen 接管）
 */
export function buildClassDocs(classes: ClassProfile[]): any[] {
	if (!classes || classes.length === 0) return [];

	return classes.map((c) => {
		const key = classKey(c);
		const intro = c.intro || "";
		const excerptParts = [c.slogan, intro].filter(Boolean);
		return {
			slug: key,
			title: `${c.grade}（${c.no}）班`,
			excerpt: excerptParts.length ? excerptParts.join(" · ") : "（班级档案待补充）",
			category: c.grade,
			date: c.founded || "",
			folder: c.grade,
			href: `/campus/classes/${key}`
		};
	});
}
