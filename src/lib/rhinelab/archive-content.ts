/**
 * 档案内容适配器 —— 把我们站内的教程 docs 整形为原版引擎要的档案内容。
 *
 * 原引擎（data.ts）期望三类数据：
 *   records|ArchiveRecord[]   —— 平面档案列表
 *   categories: string[]      —— 全量分类（用于 HUD / 过滤）
 *   columns: string[]         —— 「泳道」分类，决定档案墙有几列、每列装哪类档案
 *
 * 映射（教程 → 档案）：
 *   title      ← 教程标题
 *   en         ← 标题的大写/缩略（档案头行，原版显示英文名）
 *   department ← 教程的分组(folder)或分类(category)
 *   category   ← 归入哪一「列」（我们直接用分组=列，语义清晰）
 *   date       ← 教程日期
 *   lead       ← 教程的 category 作为关联词
 *   clearance  ← 固定档案化文案「REFERENCE AREA」
 *   abstract   ← 教程摘要(excerpt)
 *   findings   ← 把摘要拆成 1–3 条研究记录要点（对空则生成占位）
 *   source     ← 我们的 slug（用于打开详情跳回 /docs/[slug]）
 *   slug       ← 教程 slug（扩展字段，详情回链用）
 *
 * 列的数量来自 docs 实际的分组数（不是对外部列的猜测）。
 */
import type { ArchiveRecord } from "./data";

export type ArchiveContent = {
  records: ArchiveRecord[];
  categories: string[];
  columns: string[];
};

/** 取分组名：folder > category > 未分类 */
export function groupName(doc: { folder?: string; category?: string }): string {
  return doc.folder || doc.category || "未分类";
}

/** 摘要 → 研究记录要点（最多 3 条，无则占位） */
function toFindings(excerpt: string): string[] {
  const clean = (excerpt || "").trim();
  if (!clean) return ["（本档案尚未撰写摘要。）"];
  const sentences = clean
    .split(/[。；;！？\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (sentences.length === 0) return [clean.slice(0, 60)];
  return sentences.map((s) => (s.length > 48 ? s.slice(0, 48) + "…" : s));
}

/** 英文标题行：取前 3–4 个词的大写，或 slug 兜底 */
function toEn(title: string, slug: string): string {
  const words = (title || "").split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words.slice(0, 4).join(" ").toUpperCase();
  return (slug || "FILE").replace(/-/g, " ").toUpperCase().slice(0, 24) || "FILE";
}

export type DocInput = {
  slug: string;
  title: string;
  excerpt?: string;
  category?: string;
  date?: string;
  folder?: string;
};

/**
 * 把扁平教程列表整形为引擎可消费的档案内容。
 * 返回 null 表示没有可展示的文档。
 */
export function buildArchiveContent(docs: DocInput[]): ArchiveContent | null {
  if (!docs || docs.length === 0) return null;

  // 先按「原分组名」归列，保留 docs 的出现顺序作为列序
  const lanes = new Map<string, DocInput[]>();
  for (const doc of docs) {
    const key = groupName(doc);
    if (!lanes.has(key)) lanes.set(key, []);
    lanes.get(key)!.push(doc);
  }

  const columns = [...lanes.keys()];
  const records: ArchiveRecord[] = [];
  let serial = 0;

  for (const lane of columns) {
    for (const doc of lanes.get(lane)!) {
      serial += 1;
      const id = `F-${String(serial).padStart(3, "0")}`;
      const excerpt = doc.excerpt || "";
      records.push({
        id,
        title: doc.title || "(无标题)",
        en: toEn(doc.title || "", doc.slug),
        department: lane,
        category: lane,
        date: doc.date || "",
        lead: doc.category || "",
        clearance: "REFERENCE AREA",
        abstract: excerpt,
        findings: toFindings(excerpt),
        source: `/docs/${doc.slug}`,
        slug: doc.slug
      });
    }
  }

  return { records, categories: columns, columns };
}