import { json } from "@sveltejs/kit";
import { getLinkApplications, addLinkApplication, setLinkApplicationStatus } from "$lib/server/content-store.js";
import { verifyToken as verifyAuth } from "$lib/server/auth.js";

// GET — public: count of pending? No. Use POST for submit. Admin list via GET with auth
export async function GET({ url, request }) {
  const user = verifyAuth(request.headers.get("cookie")?.match(/admin_token=([^;]+)/)?.[1] || "");
  if (!user) return json({ error: "未登录" }, { status: 401 });
  const status = url.searchParams.get("status") || undefined;
  return json(getLinkApplications(status));
}

export async function POST({ request }) {
  const body = await request.json();
  const action = body.action || "submit";

  if (action === "submit") {
    const { name, url, description, email } = body;
    if (!name?.trim() || !url?.trim()) return json({ error: "请填写站点名称和网址" }, { status: 400 });
    if (!/^https?:\/\//.test(url.trim())) return json({ error: "网址需以 http(s):// 开头" }, { status: 400 });
    const app = addLinkApplication({ name: name.trim(), url: url.trim(), description: description?.trim(), email: email?.trim() });
    return json(app);
  }

  // Admin actions
  const user = verifyAuth(request.headers.get("cookie")?.match(/admin_token=([^;]+)/)?.[1] || "");
  if (!user) return json({ error: "未登录" }, { status: 401 });
  if (action === "approve") {
    const app = setLinkApplicationStatus(body.id, "approved");
    return app ? json({ ok: true }) : json({ error: "申请不存在" }, { status: 404 });
  }
  if (action === "reject") {
    const app = setLinkApplicationStatus(body.id, "rejected");
    return app ? json({ ok: true }) : json({ error: "申请不存在" }, { status: 404 });
  }
  return json({ error: "unknown action" }, { status: 400 });
}