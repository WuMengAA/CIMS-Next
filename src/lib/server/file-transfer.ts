/**
 * 文件传输 v1（2026-09-25 班级系统 v2 配套）。
 *
 * 旧链路只发元数据（name/size/sha256），**文件本体从未离开发送机**：
 * Flutter 端注释写着「文件实体上传依赖部署包扩展的文件服务端点，V1 先打通命令链路」，
 * 而那个端点从来没被实现 —— 设备端自然永远收不到文件，更别提提示。
 * 本模块补齐缺失的三环：
 *   ① 文件实体上传落盘（content/files/，gitignore 运行时数据）+ file_objects 登记；
 *   ② file_push 指令代推（服务端持 CIMS 特权令牌，走 send-notification 通道，
 *      与 broadcast.ts 同款信封：MessageContent = {"stelarith_task": {...}}）；
 *   ③ 送达回执（file_deliveries：pending → acked/failed，设备下载后回报）。
 *
 * 安全边界：
 *   · 上传需用户会话 + 传文件能力 + 目标班级在范围内（路由层判定）；
 *   · 下载需设备密钥（x-stelarith-device-secret，与截图回传同通道鉴权）；
 *   · ⚠️ stelarith_task 的 HMAC 签名仍是占位（任务密钥收口是独立待办）——
 *     设备端 file_push 执行前会校验「文件 id 确实存在于本站 file_objects」，
 *     且下载必须持设备密钥，伪造指令拿不到文件本体。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "$env/dynamic/private";
import { getDb, nowIso } from "./db.js";
import { getCimsAccount } from "./cims-account.js";
import { cimsToken } from "./cims-client.js";

const MGMT_URL = (env.CIMS_MANAGEMENT_URL ?? "http://127.0.0.1:8097").replace(/\/$/, "");
const FILES_DIR = path.join(path.resolve("content"), "files");
/** 单文件上限：课堂教学文件（PPT/视频切片）绝大多数 < 100MB。 */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export interface FileObject {
	id: string;
	name: string;
	size: number;
	sha256: string;
	kind: string;
	uploader: string;
	created_at: string;
}

/** 保存一个上传的文件：写盘 + 登记。返回登记行；超限/空文件抛错（路由层转 400）。 */
export function saveUpload(fileName: string, bytes: Buffer, kind: string, uploader: string): FileObject {
	const name = String(fileName ?? "").trim() || "未命名文件";
	if (!bytes || bytes.length === 0) throw new Error("文件内容为空");
	if (bytes.length > MAX_FILE_BYTES) {
		throw new Error(`文件超过大小上限（${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB）`);
	}
	const cleanKind = kind === "voice" ? "voice" : "file";
	const id = crypto.randomUUID();
	fs.mkdirSync(FILES_DIR, { recursive: true });
	// 磁盘文件名一律用 id（原文件名只存库）—— 避免任意扩展名/路径注入落到文件系统。
	const disk = path.join(FILES_DIR, id);
	fs.writeFileSync(disk, bytes);
	const sha = crypto.createHash("sha256").update(bytes).digest("hex");
	const ts = nowIso();
	getDb()
		.prepare(
			`INSERT INTO file_objects (id, name, size, sha256, kind, path, uploader, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(id, name.slice(0, 200), bytes.length, sha, cleanKind, disk, uploader.slice(0, 80), ts);
	return { id, name: name.slice(0, 200), size: bytes.length, sha256: sha, kind: cleanKind, uploader, created_at: ts };
}

export function getFileObject(id: string): FileObject | null {
	const key = String(id ?? "").trim();
	if (!key) return null;
	const row = getDb()
		.prepare(`SELECT id, name, size, sha256, kind, path, uploader, created_at FROM file_objects WHERE id = ?`)
		.get(key) as
		| { id: string; name: string; size: number; sha256: string; kind: string; path: string; uploader: string; created_at: string }
		| undefined;
	if (!row) return null;
	return {
		id: row.id,
		name: row.name,
		size: row.size,
		sha256: row.sha256,
		kind: row.kind,
		uploader: row.uploader,
		created_at: row.created_at
	};
}

/** 读文件本体；盘上文件被清理时返回 null。 */
export function readFileBytes(obj: FileObject): Buffer | null {
	try {
		const b = fs.readFileSync(obj.path ?? path.join(FILES_DIR, obj.id));
		return b.length > 0 ? b : null;
	} catch {
		return null;
	}
}

export interface DeliveryRow {
	id: number;
	file_id: string;
	uid: string;
	class_id: string;
	state: string;
	detail: string;
	created_at: string;
	updated_at: string;
}

export function listDeliveries(fileId: string): DeliveryRow[] {
	return getDb()
		.prepare(
			`SELECT id, file_id, uid, class_id, state, detail, created_at, updated_at
			 FROM file_deliveries WHERE file_id = ? ORDER BY created_at ASC`
		)
		.all(String(fileId ?? "").trim()) as unknown as DeliveryRow[];
}

/** 设备侧回报下载/播放结果（file-ack）。未找到行时返回 false（比如指令是重放的）。 */
export function updateDelivery(fileId: string, uid: string, state: string, detail: string): boolean {
	const f = String(fileId ?? "").trim();
	const u = String(uid ?? "").trim().toLowerCase();
	if (!f || !u) return false;
	const st = ["acked", "failed", "pending"].includes(state) ? state : "pending";
	const r = getDb()
		.prepare(
			`UPDATE file_deliveries SET state = ?, detail = ?, updated_at = ?
			 WHERE file_id = ? AND LOWER(uid) = ?`
		)
		.run(st, String(detail ?? "").slice(0, 300), nowIso(), f, u);
	return Number(r.changes) > 0;
}

/**
 * 把 file_push 任务推给一批设备（服务端代推，走 CIMS send-notification 通道）。
 * 每台设备落一行 pending 回执；单台失败不影响其余（失败行直接标 failed）。
 *
 * ⚠️ 任务令牌为占位（见文件头安全边界）——与 Flutter 端 sendTask 未配密钥时的
 * 行为一致，验签收口在「任务密钥」待办里统一解决。
 */
export async function pushFileToDevices(
	file: FileObject,
	uids: string[],
	/** uid → class_id（用于回执留档；解析不到留空串） */
	classOf: (uid: string) => string
): Promise<{ uid: string; ok: boolean; detail: string }[]> {
	const acct = await getCimsAccount();
	const token = await cimsToken();
	if (!acct || !token) {
		return uids.map((uid) => {
			markDelivery(file.id, uid, classOf(uid), "failed", "CIMS 未配置/不可达，指令未下发");
			return { uid, ok: false, detail: "CIMS 不可达" };
		});
	}
	const ts = Math.floor(Date.now() / 1000);
	const task = {
		action: "file_push",
		token: ts.toString(36),
		scope: "device",
		ts,
		payload: {
			file_id: file.id,
			name: file.name,
			sha256: file.sha256,
			kind: file.kind,
			size: file.size
		}
	};
	const out: { uid: string; ok: boolean; detail: string }[] = new Array(uids.length);

	// 并发代推：串行的话 20 台 × 5s 超时 = 100s，调用方（Flutter/面板）早超时了。
	// 单台失败只影响自己那行回执（标 failed），不拖累其余设备。
	await Promise.all(
		uids.map(async (uidRaw, i) => {
			const uid = String(uidRaw).trim();
			if (!uid) return;
			try {
				const r = await fetch(
					`${MGMT_URL}/account/${acct.id}/client/${encodeURIComponent(uid)}/command/send-notification`,
					{
						method: "POST",
						headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
						body: JSON.stringify({ MessageContent: JSON.stringify({ stelarith_task: task }) }),
						signal: AbortSignal.timeout(5000)
					}
				);
				if (r.ok) {
					markDelivery(file.id, uid, classOf(uid), "pending", "指令已下发，等待设备下载回报");
					out[i] = { uid, ok: true, detail: "已下发" };
				} else {
					const why = (await r.text()).slice(0, 120);
					markDelivery(file.id, uid, classOf(uid), "failed", `HTTP ${r.status} ${why}`);
					out[i] = { uid, ok: false, detail: `HTTP ${r.status}` };
				}
			} catch (e) {
				markDelivery(file.id, uid, classOf(uid), "failed", String(e).slice(0, 200));
				out[i] = { uid, ok: false, detail: String(e).slice(0, 80) };
			}
		})
	);
	return out.filter(Boolean);
}

function markDelivery(fileId: string, uid: string, classId: string, state: string, detail: string): void {
	const ts = nowIso();
	getDb()
		.prepare(
			`INSERT INTO file_deliveries (file_id, uid, class_id, state, detail, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.run(fileId, uid.toLowerCase(), classId ?? "", state, detail.slice(0, 300), ts, ts);
}
