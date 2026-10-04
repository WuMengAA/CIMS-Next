/*
 * Stelarith P2P 连接器（面板侧 · 方案2）
 * ---------------------------------------------------------------
 * 职责：让面板也能做"面板内无感远控"。
 *   - 从信令边车自带地址懒加载 socket.io 客户端（/socket.io/socket.io.js），
 *     自身零 npm 依赖，符合面板"零依赖"铁律。
 *   - 用 billdDesk* 协议完成：join(令牌鉴权) → StartRemote → Offer/Answer/Candidate 转发。
 *   - 封装 RTCPeerConnection：自动协商 + ICE 收集 + 远端流回调。
 *
 * 事件名与信封格式统一来自 ./protocol.ts（单一事实源），与信令边车共用，
 * 不在本文件再写一份字面量，避免协议漂移。
 *
 * 用法（ES module）：
 *   import { StelarithP2P } from '$lib/console/p2p/connector';
 *   const p2p = new StelarithP2P({ signalUrl, deviceUid, secret, roomId, rtcConfig });
 *   await p2p.connect();
 *   const pc = await p2p.startController(localStream);   // 主控：发 offer
 *   p2p.on('remoteOffer', async (offer) => p2p.startControlled(offer, desktopStream)); // 被控
 *   p2p.on('track', (stream) => videoEl.srcObject = stream);
 */
import { EVENTS, envelope, roomKey, uid } from "./protocol";

// ── 浏览器全局（socket.io 客户端脚本由信令边车提供，加载后挂到 window.io）────────
/** 信令边车提供的 socket.io 客户端工厂的最小形态。 */
type IoFactory = (url: string, opts?: Record<string, unknown>) => SocketLike;
/** socket.io socket 的最小形态（只用 on/emit/disconnect）。 */
interface SocketLike {
	on(evt: string, cb: (payload: unknown) => void): void;
	emit(evt: string, data: unknown): void;
	disconnect(): void;
}
type Handler = (payload: unknown) => void;

declare global {
	interface Window {
		io?: IoFactory;
	}
}

/** billdDesk 转发负载（Offer/Answer 是 {sdp}）。 */
type SdpPayload = { sdp: RTCSessionDescription | RTCSessionDescriptionInit | null };
/** 入站事件回调负载统一按未知处理，由使用方按需收窄。 */
type AnyPayload = unknown;

export interface StelarithP2POptions {
	signalUrl?: string;
	deviceUid?: string;
	secret?: string;
	roomId?: string;
	rtcConfig?: RTCConfiguration;
}

/** 单一配置对象（归一化后的内部形态）。 */
interface NormalizedConfig {
	signalUrl: string;
	deviceUid: string;
	secret: string;
	roomId: string;
	rtcConfig: RTCConfiguration;
}

// 懒加载 socket.io 客户端（由信令边车自动提供，零额外依赖）
function ensureIo(signalUrl: string): Promise<IoFactory> {
	return new Promise((resolve, reject) => {
		if (typeof window === "undefined") {
			reject(new Error("StelarithP2P 只能在浏览器中使用"));
			return;
		}
		if (window.io) return resolve(window.io);
		const s = document.createElement("script");
		s.src = signalUrl.replace(/\/$/, "") + "/socket.io/socket.io.js";
		s.onload = () => (window.io ? resolve(window.io) : reject(new Error("socket.io client not found")));
		s.onerror = () => reject(new Error("failed to load socket.io client from " + s.src));
		document.head.appendChild(s);
	});
}

// 入站事件 → 本地回调名 的声明式映射（替代原先 6 条并列 socket.on）
// 注：CANDIDATE 需调用实例方法（addIceCandidate），单独在 connect() 里挂，避免类外 this 丢失。
const INBOUND: Record<string, string> = {
	[EVENTS.OFFER]: "remoteOffer",
	[EVENTS.ANSWER]: "remoteAnswer",
	[EVENTS.START_REMOTE]: "startRemote",
	[EVENTS.BEHAVIOR]: "behavior"
};

export class StelarithP2P {
	config: NormalizedConfig;
	// 便捷别名（公共 API），均派生自 config，不改单一来源
	signalUrl: string;
	deviceUid: string;
	secret: string;
	roomId: string;
	rtcConfig: RTCConfiguration;

	socket: SocketLike | null = null;
	pc: RTCPeerConnection | null = null;
	_dataChannel: RTCDataChannel | null = null;
	_handlers: Record<string, Handler[]> = {};

	constructor(opts: StelarithP2POptions) {
		// 单一配置对象：归一化一次，内部统一取用，避免散落字段
		this.config = {
			signalUrl: String(opts.signalUrl || ""),
			deviceUid: String(opts.deviceUid || ""), // 设备码（lab-pc-001）
			secret: String(opts.secret || ""), // 媒体令牌（星集控 media_token）
			roomId: String(opts.roomId || roomKey(String(opts.deviceUid || ""))),
			rtcConfig: opts.rtcConfig || { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }
		};
		this.signalUrl = this.config.signalUrl;
		this.deviceUid = this.config.deviceUid;
		this.secret = this.config.secret;
		this.roomId = this.config.roomId;
		this.rtcConfig = this.config.rtcConfig;
	}

	on(evt: string, fn: Handler): this {
		(this._handlers[evt] || (this._handlers[evt] = [])).push(fn);
		return this;
	}

	emitLocal(evt: string, payload: AnyPayload): void {
		(this._handlers[evt] || []).forEach((f) => {
			try {
				f(payload);
			} catch (e) {
				console.error(e);
			}
		});
	}

	// 统一信封发送：所有出站消息走这里，消除各方法里重复的 request_id/time/data 样板
	_send(event: string, payload: Record<string, unknown>): void {
		if (!this.socket) return;
		this.socket.emit(event, envelope({ roomId: this.roomId, ...payload }));
	}

	async connect(): Promise<unknown> {
		const io = await ensureIo(this.signalUrl);
		this.socket = io(this.signalUrl, { transports: ["websocket"], forceNew: true });
		return new Promise((resolve, reject) => {
			const to = setTimeout(() => reject(new Error("join timeout")), 8000);
			this.socket!.on("connect", () => {
				this._send(EVENTS.JOIN, {
					deskUserUuid: this.deviceUid,
					deskUserPassword: this.secret,
					live_room_id: this.roomId
				});
			});
			this.socket!.on(EVENTS.JOINED, (resp) => {
				clearTimeout(to);
				const r = resp as { code?: number; msg?: string } | null;
				if (r && r.code === 0) {
					this.emitLocal("joined", resp);
					resolve(resp);
				} else {
					reject(new Error("join rejected: " + (r && r.msg)));
					this.socket?.disconnect();
				}
			});
			this.socket!.on("connect_error", (e) => reject(e));
			// 声明式入站映射（INBOUND）替代 6 条并列 socket.on
			for (const [evt, localEvt] of Object.entries(INBOUND)) {
				this.socket!.on(evt, (p) => this.emitLocal(localEvt, (p as { data?: unknown } | null)?.data));
			}
			// CANDIDATE 需调用实例方法，单独挂（避免类外 this 捕获问题）
			this.socket!.on(EVENTS.CANDIDATE, (p) =>
				void this._onRemoteCandidate((p as { data?: unknown } | null)?.data)
			);
		});
	}

	_newPc(): RTCPeerConnection {
		const pc = new RTCPeerConnection(this.rtcConfig);
		this.pc = pc;
		pc.onicecandidate = (e) => {
			if (e.candidate) this._send(EVENTS.CANDIDATE, { candidate: e.candidate });
		};
		pc.ontrack = (e) => this.emitLocal("track", e.streams[0]);
		return pc;
	}

	async _onRemoteCandidate(data: AnyPayload): Promise<void> {
		const d = data as { candidate?: RTCIceCandidateInit } | null;
		if (!d || !d.candidate || !this.pc) return;
		// agent(webrtc 0.21 candidate.to_json) 会带 sdpMid:"" / usernameFragment:null，
		// 浏览器 addIceCandidate 对空 sdpMid 报 "Media section for sdpMid was not found"，
		// 导致 ICE 永远连不通。这里清洗后再投递（2026-09-27 实测）。
		const c: RTCIceCandidateInit = { ...d.candidate };
		if (!c.sdpMid) delete c.sdpMid;
		if (c.usernameFragment == null) delete c.usernameFragment;
		try {
			await this.pc.addIceCandidate(c);
		} catch (e) {
			console.error("addIceCandidate", e);
		}
	}

	// 主控：发 offer（localStream 可选，用于反向音视频/无则仅数据通道）
	async startController(localStream: MediaStream | null): Promise<RTCPeerConnection> {
		const pc = this._newPc();
		if (localStream) localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
		this._dataChannel = pc.createDataChannel("stelarith-ctrl");
		this._wireDataChannel();
		// 主控必须自订阅 answer：INBOUND 把 billdDeskAnswer 映射为 remoteAnswer 事件，
		// 若不在这里 acceptAnswer()，setRemoteDescription(answer) 永不执行，
		// ICE 会一直报 "The remote description was null"（2026-09-27 实测根因）。
		this.on("remoteAnswer", (ans) => {
			void this.acceptAnswer(ans as SdpPayload);
		});
		const offer = await pc.createOffer();
		await pc.setLocalDescription(offer);
		this._send(EVENTS.OFFER, { sdp: pc.localDescription });
		return pc;
	}

	// 被控：收到 offer → 回 answer，并发送桌面流
	async startControlled(remoteOffer: SdpPayload, desktopStream: MediaStream | null): Promise<RTCPeerConnection> {
		const pc = this._newPc();
		if (desktopStream) desktopStream.getTracks().forEach((t) => pc.addTrack(t, desktopStream));
		pc.ondatachannel = (e) => {
			this._dataChannel = e.channel;
			this._wireDataChannel();
		};
		await pc.setRemoteDescription(remoteOffer.sdp as RTCSessionDescriptionInit);
		const answer = await pc.createAnswer();
		await pc.setLocalDescription(answer);
		this._send(EVENTS.ANSWER, { sdp: pc.localDescription });
		return pc;
	}

	// 主控收到 answer
	async acceptAnswer(remoteAnswer: SdpPayload): Promise<void> {
		if (this.pc && remoteAnswer && remoteAnswer.sdp) {
			await this.pc.setRemoteDescription(remoteAnswer.sdp as RTCSessionDescriptionInit);
		}
	}

	_wireDataChannel(): void {
		const dc = this._dataChannel;
		if (!dc) return;
		dc.onopen = () => this.emitLocal("dataOpen", dc);
		dc.onmessage = (e) => this.emitLocal("data", e.data);
	}

	// 主控下发键鼠控制（billdDeskBehavior，与数据通道互补）
	sendBehavior(behavior: Record<string, unknown>): void {
		this._send(EVENTS.BEHAVIOR, behavior);
	}

	sendData(msg: string | Record<string, unknown>): void {
		if (this._dataChannel && this._dataChannel.readyState === "open")
			this._dataChannel.send(typeof msg === "string" ? msg : JSON.stringify(msg));
	}

	close(): void {
		try {
			if (this.pc) this.pc.close();
		} catch {
			/* 忽略 */
		}
		try {
			if (this.socket) this.socket.disconnect();
		} catch {
			/* 忽略 */
		}
	}
}

// 与旧 UMD 连接器的差异（有意为之，A4.3 迁移说明）：
// 旧版 p2p-connector.js 用 IIFE 同时把 StelarithP2P 挂到 window 并支持 CommonJS，
// 是为了服务 static/console 那一套零构建的 <script> 面板。新版是打包进 SvelteKit 的
// ES module，使用方 `import { StelarithP2P }` 即可，无需全局挂载与 CommonJS 分支，
// 故只保留 ESM 具名导出。uid 仍具名重导出，保持与旧文件的公共成员一致。
export { uid };
