// 原引擎按「编译期静态 JSON」加载档案。我们把它改成「运行时注入」：
// 组件拿到服务端下发的 docs 后，调用 setContent() 一次性替换 records 与分列。
// 后面的 columnFiles / fileLocation / fileAtSlot 读的都是活数组，引擎无需改动。
import type { ArchiveContent } from "./archive-content";

let _records: ArchiveRecord[] = [];
let _categories: string[] = ["全部档案"];
let _columns: string[] = [];

export interface ArchiveRecord {
  id: string;
  title: string;
  en: string;
  department: string;
  category: string;
  date: string;
  lead: string;
  clearance: string;
  abstract: string;
  findings: string[];
  source: string;
  /** 我们扩展的字段：映射回网站内详情页 slug */
  slug?: string;
}

export const records: ArchiveRecord[] = _records;
export const categories = _categories;
export const archiveColumns = _columns;

export function setContent(content: ArchiveContent) {
  _records = content.records;
  _categories = ["全部档案", ...content.categories];
  _columns = content.columns;
  // 数组引用替换后，让 module 层读到新数组（records/categories/archiveColumns 是活引用）
  (records as ArchiveRecord[]).length = 0;
  (records as ArchiveRecord[]).push(..._records);
  (categories as string[]).length = 0;
  (categories as string[]).push(..._categories);
  (archiveColumns as string[]).length = 0;
  (archiveColumns as string[]).push(..._columns);
}

export function columnFiles(lane: number) {
  return records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.category === archiveColumns[lane])
    .map(({ index }) => index);
}
export function fileLocation(index: number) {
  const lane = archiveColumns.indexOf(records[index].category);
  const row = 12 + columnFiles(lane).indexOf(index);
  return { lane, row, slot: lane * 32 + row };
}
export function fileAtSlot(slot: number) {
  const files = columnFiles(Math.floor(slot / 32));
  return files[Math.max(0, Math.min(files.length - 1, (slot % 32) - 12))];
}
