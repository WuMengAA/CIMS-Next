import { json } from "@sveltejs/kit";
import { uploadFile, listUploads, deleteUpload } from "$lib/server/content-store.js";
import { getApiUser } from "$lib/server/api-auth.js";
import { can } from "$lib/permissions.js";

/**
 * 附件库三个方法统一走这一关（T11，2026-10-03）。
 *
 * 原先 GET/POST/DELETE 各自只判「已登录」—— 任何 viewer 都能枚举全站上传目录、
 * 往存储里塞文件、删掉别人的附件。
 * 这正是 `/api/project-board/upload` 当年为绕过「/api/media 只要求登录」而单独开一条
 * 路由的原因；现在源头收紧，两条路由的门径就一致了。
 *
 * 权限点为什么是 `manageFiles`，不是 `manageStorage`（也不是 `manageContent`）：
 * 实跑负向验证（_probe/t11-t12-gates.mjs）把两个备选都试过，结论如下 ——
 *   - `manageStorage` 只授给 **stationmaster** 称号（= admin / owner），见
 *     permissions.ts 的 stationmaster.actions。用它门控会把 **editor / moderator 当场
 *     踢出附件库**：编辑器（page-editor、content-editor 的上传框）全靠这条路由传配图，
 *     一关就是砸功能，直接违反验收③「不许改变高权用户原有行为」。
 *   - `manageContent` 语义是「内容条目」不是「附件库」；而且它和 manageFiles 的持有人
 *     完全重叠（都出自 editor 称号），换了它并不更准。
 *   - `manageFiles` 出自 editor 称号，恰好就是「附件库」这个对象的语义本体，持有权集合
 *     = editor / moderator / admin / owner，与后台附件页入口 `admin/+layout.svelte`
 *     （以 manageContent 门控该页）的可达集合一致：**进得了附件页的人都能操作附件库**，
 *     viewer / user / homeroom / teacher / techrep 一律 403。
 * 记入 T12 的「看似等价、实则某配置下会炸」清单（通用纪律 #6）：
 *   同一个端点，三个权限点能给出三种不同的持有权集合 —— 选错一个就把站长或编辑
 *   从自己的页面上踢出去，而 svelte-check 一个错都不会报。
 *
 * @returns 已通过则返回 null；未过则返回可直接返回的 401/403 响应。
 */
async function blocked(request: Request): Promise<Response | null> {
	const user = await getApiUser(request);
	if (!user) return json({ error: "未登录" }, { status: 401 });
	if (!can(user.role, "manageFiles")) {
		return json({ error: "无权管理附件库" }, { status: 403 });
	}
	return null;
}

export async function GET({ request }: { request: Request }) {
	const stop = await blocked(request);
	if (stop) return stop;
	return json(listUploads());
}

export async function POST({ request }) {
	const stop = await blocked(request);
	if (stop) return stop;
	const formData = await request.formData();
	const file = formData.get("file") as File;
	if (!file) return json({ error: "no file" }, { status: 400 });
	const buffer = Buffer.from(await file.arrayBuffer());
	const result = uploadFile(file.name, buffer);
	if (result.error) return json({ error: result.error }, { status: 400 });
	return json({ url: result.url, filename: file.name });
}

export async function DELETE({ request }) {
	const stop = await blocked(request);
	if (stop) return stop;
	const { filename } = await request.json();
	const ok = deleteUpload(filename);
	return json({ ok });
}