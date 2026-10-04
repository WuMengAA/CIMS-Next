/**
 * 2028届八班 · 个人学业曲线（仅登录本人可看）。
 * 隐私红线：不公开个人排名 —— 这里只返回与登录账号绑定成员同名的数据。
 */
import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { memberCurve } from "$lib/server/class8/class8-service.js";

function resolveUser(event: RequestEvent) {
  const t = event.cookies.get("admin_token") || (event.request.headers.get("authorization") ?? "").replace(/^Bearer /i, "");
  return t ? verifyToken(t) : null;
}

export async function GET(event: RequestEvent) {
  const me = resolveUser(event);
  if (!me) return json({ error: "未登录" }, { status: 401 });
  // 取登录账号的显示名；若与班级成员同名则返回曲线，否则返回空。
  const name = me.displayName || me.username;
  const curve = memberCurve(name);
  const hasData = curve.points.some(function (v) { return v !== null; });
  return json({ me: name, hasData: hasData, curve: curve });
}
