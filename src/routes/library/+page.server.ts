/**
 * /library —— 个人附件库 / 图床。
 *
 * 页面对登录用户开放；存储没配好时**不隐藏页面**，而是展示一份「怎么配」的清单——
 * 页面 404 或白屏只会让人更困惑，直接告诉他缺哪四个变量要快得多。
 */
import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { sessionUser } from "$lib/server/session.js";
import {
	ensureRootFolders,
	listFiles,
	listFolders,
	usageOf
} from "$lib/server/attachment-library.js";
import { r2Configured } from "$lib/server/storage/r2.js";
import { QUOTA_MIB, QUOTA_MAX_MIB } from "$lib/storage-quota.js";

export const load: PageServerLoad = ({ cookies }) => {
	const user = sessionUser({ cookies });
	if (!user) throw redirect(303, "/admin/login");

	const id = user.id;
	ensureRootFolders(id);

	const configured = r2Configured();

	return {
		me: { username: user.username, displayName: user.displayName || user.username },
		usage: usageOf(id),
		folders: listFolders(id),
		files: listFiles(id),
		storage: {
			configured,
			provider: configured ? "cloudflare-r2" : "unconfigured"
		},
		// 配额阶梯一次下发，前端画容量条上的刻度不用再算一遍
		quotaCurve: (Object.keys(QUOTA_MIB) as unknown as number[])
			.map((lv) => ({ level: lv, mib: QUOTA_MIB[lv as keyof typeof QUOTA_MIB] }))
			.sort((a, b) => a.level - b.level),
		quotaMaxMib: QUOTA_MAX_MIB
		// 注意：别把 formatBytes 这类函数塞进 load 的返回值——
		// SSR 会把 load 的结果序列化给浏览器，函数直接报 "not serializable"。
		// $lib/storage-quota.js 是前后端共用的纯函数模块，前端自己 import 即可。
	};
};
