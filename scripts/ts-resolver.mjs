/**
 * 让 Node 直接 import 本站的 .ts 源文件 —— 只给 scripts/*.mjs 用，生产运行时无关。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────────
 * 本站的源码是 TypeScript，但模块之间写的是 SvelteKit 要求的 `../paths.js`
 * 这种带 .js 后缀的写法（TS 项目里 .js 指向的是同名的 .ts 文件）。
 * Node 的 type-stripping 只剥离类型、不做 import 重写，于是 `import "../paths.js"`
 * 会被它老老实实地去找 paths.js 并报 ERR_MODULE_NOT_FOUND。
 *
 * ── 为什么不在源码里把 .js 改写成 .ts ────────────────────────────────────────
 * 那样 src/ 下的模块就再也跑不起来（SvelteKit 的构建不认 `../paths.ts`）。
 * 为了一个离线脚本去动全工程的 import 写法，是这个工程最不该做的那种改动。
 *
 * ── 为什么不在脚本里复制一份签名实现 ──────────────────────────────────────────
 * 备份脚本需要往 R2 / B2 上传。R2 那套 SigV4 已经有一个经过线上验证的实现
 * （src/lib/server/storage/r2.ts）。若在此处复制第二份，将来修签名 bug 就要改两处，
 * 而漏改一处的表现是"备份时不时成功时不时失败" —— 一种最难排查的失败形态。
 * 宁可多一层钩子，也不要两套真相。
 *
 * 用法（脚本内部自己注册，调用方无需任何额外参数）：
 *   import { register } from "node:module";
 *   register("./ts-resolver.mjs", import.meta.url);
 *   const { putObject } = await import("../src/lib/server/storage/r2.ts");
 */

/** @param {string} specifier @param {any} context @param {any} nextResolve */
export async function resolve(specifier, context, nextResolve) {
	try {
		return await nextResolve(specifier, context);
	} catch (err) {
		// 只有"真的找不到"才尝试换扩展名，避免掩盖真正的拼写错误。
		if (err && err.code === "ERR_MODULE_NOT_FOUND" && /\.js$/.test(specifier) && !specifier.startsWith("node:")) {
			const swapped = specifier.slice(0, -3) + ".ts";
			if (swapped !== specifier) {
				try {
					return await nextResolve(swapped, context);
				} catch {
					/* 换完也不行，就抛出最初那个错误 */
				}
			}
		}
		throw err;
	}
}
