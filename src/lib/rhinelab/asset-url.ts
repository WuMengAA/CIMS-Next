/** Public resources work at the origin root and at a static-hosting subpath. */
// 原引擎用 vite define 的 __RHINE_MODELS__ 做版本化资产映射。我们在 SvelteKit
// 里把 glb 放在 static/rhinelab/，由框架按 BASE_URL 统一托管，无需版本哈希。
// 去掉对 __RHINE_MODELS__ 的依赖，直接基于 BASE_URL 解析。
export const assetUrl = (path: string) => {
  const key = path.replace(/^\//, "");
  return `${import.meta.env.BASE_URL}${key}`;
};