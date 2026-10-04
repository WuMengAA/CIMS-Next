// 服务端指令签名端点：为面板下发的设备指令签发 Ed25519 短时令牌。
//
// 背景（#258，2026-09-24）：
//   旧链路用「网站—设备」共享密钥 HMAC（api.js 本地签），密钥必须人工配到每台
//   教室机（面板「设置 → 指令密钥」），老师/运维漏配就整链降级成时间戳占位 → 远程
//   控制/系统级重启被代理**明确拒绝**，且过程不可见。本轮改为非对称：
//     网站服务端持私钥（.env 的 SITE_TASK_PRIVATE_KEY，base64 的 pkcs8 DER），
//     Ed25519 私钥签名；教室代理持网站公钥（出包打进 STELARITH_SITE_PUBKEY）验签。
//   公钥随包分发不算泄露，私钥永不出服务器 → 教室端零配置、密钥零分发。
//
// 契约（与 ext/stelarith-agent/src/main.rs::verify_ed25519 严格一致，改必对）：
//   message = `${action}|${ts}`（ts 为 Unix 秒）
//   token   = base64url(Ed25519_sign(message))（64 字节）
//   代理侧 |now - ts| <= 60 防重放（面板每次下发都会重新签名，tcaching 无关）
//
// 鉴权：能进面板（viewConsole）的登录用户，再按 **action 精准分档** 判设备能力
//   （见下方分档表：process_list→apps_view / process_stop→apps_stop / log_tail→logs_view / 其余→control）。
//   签名令牌 = 对该指令动作的授权凭证，门槛必须与 cims 代理里的动作级裁决一致，
//   否则任意登录用户可在控制台绕过 UI 手工签发任意指令。
import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import crypto from "node:crypto";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { canDevice, canDeviceAction, userCan } from "$lib/permissions.js";

export async function POST(event: RequestEvent) {
	// ---- 鉴权（与 cims 代理同一模式：cookie admin_token 优先，其次 Bearer）----
	const cookieToken = event.cookies.get("admin_token");
	let u = cookieToken ? verifyToken(cookieToken) : null;
	if (!u) {
		const authH = event.request.headers.get("authorization") ?? "";
		if (authH.toLowerCase().startsWith("bearer ")) {
			u = verifyToken(authH.slice(7).trim());
		}
	}
	if (!u) return json({ error: "请先登录" }, { status: 401 });
	if (!userCan(u, "viewConsole")) {
		return json({ error: "无权限" }, { status: 403 });
	}

	// ---- 私钥 ----
	const privB64 = (env.SITE_TASK_PRIVATE_KEY || "").trim();
	if (!privB64) {
		return json(
			{ error: "服务端未配置签名私钥（.env 缺 SITE_TASK_PRIVATE_KEY）" },
			{ status: 500 }
		);
	}

	// ---- 请求体 ----
	const body = await event.request.json().catch(() => null);
	const action = String(body?.action ?? "").trim();
	if (!action || !/^[A-Za-z0-9_]{1,64}$/.test(action)) {
		return json({ error: "action 非法" }, { status: 400 });
	}
	const ts = Number(body?.ts) || Math.floor(Date.now() / 1000);

	// ---- 设备档位：按 action 精准分档（绝不整体放宽）----
	// 签名令牌 = 对该动作的授权凭证，因此这里的门槛必须与 cims 代理里的动作级裁决一致。
	// 曾经一律要求 control：任课老师/电教委员的 ROLE_DEVICE_ACTIONS 里没有 control，
	// 于是老师点「刷新软件列表」在**签名这一步**就 403，与「任课老师能看软件」的定案冲突。
	// 现在逐动作对照（见 src/lib/permissions.ts 的 ROLE_DEVICE_ACTIONS）：
	//   · process_list（查看运行软件）→ apps_view：站长/管理员/班主任/任课老师/电教委员都签得出
	//   · process_stop（关闭运行软件）→ apps_stop：只有能关的角色才签得出
	//   · log_tail（查看设备日志）   → logs_view：与「能进面板看设备」同集，任课老师/电教委员也签得出
	//   · 其余**所有** action           → control：与改造前完全一致，一个字都没放宽
	//     （刻意不用 "有 apps_view 或 apps_stop 就放行" 那种写法——那会让 teacher
	//      给 shutdown 也签得出名，比粗档更危险）。
	// ⚠️ 顺序铁律：必须排在 action 解析**之后**，否则又退回「一律 control」的粗档。
	let allowed = false;
	let denyMsg = "角色无设备控制权限，无法签发指令";
	if (action === "process_list") {
		allowed = canDeviceAction(u.role, "apps_view");
		denyMsg = "当前角色没有「查看运行软件」能力";
	} else if (action === "process_stop") {
		allowed = canDeviceAction(u.role, "apps_stop");
		denyMsg = "当前角色没有「关闭运行软件」能力";
	} else if (action === "log_tail") {
		allowed = canDeviceAction(u.role, "logs_view");
		denyMsg = "当前角色没有「查看设备日志」能力";
	} else {
		allowed = canDevice(u.role as never, "control");
	}
	if (!allowed) return json({ error: denyMsg }, { status: 403 });

	// ---- 签名 ----
	let key: crypto.KeyObject;
	try {
		key = crypto.createPrivateKey({
			key: Buffer.from(privB64, "base64"),
			format: "der",
			type: "pkcs8",
		});
	} catch (e) {
		return json({ error: "私钥解析失败：" + String(e) }, { status: 500 });
	}
	const sig = crypto.sign(null, Buffer.from(`${action}|${ts}`, "utf8"), key);
	const token = sig.toString("base64url");

	return json({ ok: true, token, ts, alg: "ed25519" });
}