import { json } from "@sveltejs/kit";
import crypto from "node:crypto";
import { listItems, getComments } from "$lib/server/content-store.js";
import { getApiUser, canManage } from "$lib/server/api-auth.js";

export async function GET({ request }) {
	const user = getApiUser(request);
	if (!user) return json({ error: "未登录" }, { status: 401 });

	// Collect all content this user can access
	const data: Record<string, unknown> = {
		exportedAt: new Date().toISOString(),
		user: user.username,
		posts: listItems("posts").filter(p => canManage(user, p.owner)),
		projects: listItems("projects").filter(p => canManage(user, p.owner)),
		docs: listItems("docs").filter(p => canManage(user, p.owner))
	};

	const pass = request.headers.get("x-encrypt-pass");
	let payload: string;
	let encrypted = false;

	if (pass) {
		// AES-256-GCM encryption with password-derived key
		const salt = crypto.randomBytes(16);
		const key = crypto.scryptSync(pass, salt, 32);
		const iv = crypto.randomBytes(12);
		const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
		const plaintext = JSON.stringify(data);
		const enc = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
		const tag = cipher.getAuthTag();
		payload = JSON.stringify({
			encrypted: true,
			algorithm: "aes-256-gcm",
			salt: salt.toString("base64"),
			iv: iv.toString("base64"),
			tag: tag.toString("base64"),
			data: enc.toString("base64")
		});
		encrypted = true;
	} else {
		payload = JSON.stringify(data, null, 2);
	}

	return new Response(payload, {
		headers: {
			"Content-Type": "application/json",
			"Content-Disposition": `attachment; filename="stelarith-backup-${user.username}-${new Date().toISOString().slice(0,10)}${encrypted ? ".enc.json" : ".json"}"`
		}
	});
}