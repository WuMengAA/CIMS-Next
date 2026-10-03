import { json } from "@sveltejs/kit";
import { getLinkApplications, addLinkApplication, setLinkApplicationStatus } from "$lib/server/content-store.js";
import { verifyToken as verifyAuth } from "$lib/server/auth.js";
import { userCan } from "$lib/permissions.js";

// 后台审批队列：列表必须过内容管理权，否则任何登录用户都能拉取全站待审申请。
export async function GET({ url, request }) {
  const user = verifyAuth(request.headers.get("cookie")?.match(/admin_token=([^;]+)/)?.[1] || "");
  if (!user) return json({ error: "未登录" }, { status: 401 });
  if (!userCan(user, "manageContent")) return json({ error: "无权查看友链申请" }, { status: 403 });
  const status = url.searchParams.get("status") || undefined;
  return json(getLinkApplications(status));
}

export async function POST({ request }) {
  const body = await request.json();
  const action = body.action || "submit";

  // 公开投稿：不校验登录，但**不能**自证（verified 只有审批人能给，见下方 approve）。
  if (action === "submit") {
    const { name, url, description, email } = body;
    if (!name?.trim() || !url?.trim()) return json({ error: "请填写站点名称和网址" }, { status: 400 });
    if (!/^https?:\/\//.test(url.trim())) return json({ error: "网址需以 http(s):// 开头" }, { status: 400 });
    const app = addLinkApplication({ name: name.trim(), url: url.trim(), description: description?.trim(), email: email?.trim(), verified: false });
    return json(app);
  }

  // 后台审批：原先只判「已登录」—— 任何 viewer 都能批准友链，直接把陌生人站点挂进全站友链区。
  // 与 admin/+layout.svelte 里该页面的 need: "manageContent" 对齐（审批属于内容轴）。
  const user = verifyAuth(request.headers.get("cookie")?.match(/admin_token=([^;]+)/)?.[1] || "");
  if (!user) return json({ error: "未登录" }, { status: 401 });
  if (!userCan(user, "manageContent")) return json({ error: "无权审批友链申请" }, { status: 403 });
  if (action === "approve") {
    const app = setLinkApplicationStatus(body.id, "approved", body.verified === true);
    return app ? json({ ok: true, app }) : json({ error: "申请不存在" }, { status: 404 });
  }
  if (action === "reject") {
    const app = setLinkApplicationStatus(body.id, "rejected");
    return app ? json({ ok: true }) : json({ error: "申请不存在" }, { status: 404 });
  }
  return json({ error: "unknown action" }, { status: 400 });
}