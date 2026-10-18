/**
 * 2028届八班 · 服务端数据加载（layout 共用）。
 * 公开快照不含个人成绩 —— 隐私安全由 service 层保证。
 */
import { seedClass8IfEmpty, ensureRealClass8Data, ensureSportsTimeline } from "$lib/server/class8/class8-seed.js";
import { fullSnapshot } from "$lib/server/class8/class8-service.js";

export const load = async () => {
  await seedClass8IfEmpty();
  await ensureRealClass8Data();
  await ensureSportsTimeline();
  return await fullSnapshot();
};
