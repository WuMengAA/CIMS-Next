/**
 * 深度诊断：为什么 canvas 是空的。
 */
const CDP_BASE = process.env.CDP_BASE || "http://127.0.0.1:9333";
const TARGET = process.env.TARGET_URL || "http://127.0.0.1:8090/docs";

function rpc(ws, id, method, params = {}) {
	return new Promise((resolve, reject) => {
		const onMsg = (ev) => {
			let msg;
			try {
				msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
			} catch {
				return;
			}
			if (msg.id !== id) return;
			ws.removeEventListener("message", onMsg);
			if (msg.error) reject(new Error(method + ": " + JSON.stringify(msg.error)));
			else resolve(msg.result);
		};
		ws.addEventListener("message", onMsg);
		ws.send(JSON.stringify({ id, method, params }));
		setTimeout(() => {
			ws.removeEventListener("message", onMsg);
			reject(new Error(method + " timeout"));
		}, 30000);
	});
}

const main = async () => {
	const list = await (await fetch(CDP_BASE + "/json/list")).json();
	const page = list.find((t) => t.type === "page" && t.url.includes("8090")) || list.find((t) => t.type === "page");
	const ws = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((r) => ws.addEventListener("open", r, { once: true }));

	let id = 1;
	const logs = [];
	ws.addEventListener("message", (ev) => {
		let m;
		try {
			m = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
		} catch {
			return;
		}
		if (m.method === "Runtime.consoleAPICalled") {
			logs.push(
				"[" + m.params.type + "] " +
					(m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ")
			);
		}
		if (m.method === "Runtime.exceptionThrown") {
			logs.push("[exception] " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
		}
	});
	await rpc(ws, id++, "Runtime.enable");
	await rpc(ws, id++, "Log.enable");

	const ev = async (expr) => {
		const r = await rpc(ws, id++, "Runtime.evaluate", {
			expression: expr,
			returnByValue: true,
			awaitPromise: true
		});
		if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
		return r.result.value;
	};

	console.log("== WebGL 能力 ==");
	console.log(
		JSON.stringify(
			await ev(`(() => {
		const t = document.createElement('canvas');
		const gl = t.getContext('webgl2') || t.getContext('webgl');
		if (!gl) return { webgl: false };
		const dbg = gl.getExtension('WEBGL_debug_renderer_info');
		return {
			webgl: true,
			version: gl.getParameter(gl.VERSION),
			renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '(masked)',
			maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE)
		};
	})()`)
		)
	);

	console.log("\n== canvas 实际状态 ==");
	console.log(
		JSON.stringify(
			await ev(`(() => {
		const c = document.querySelector('.rhine-array-canvas');
		if (!c) return { found: false };
		const gl = c.getContext('webgl2') || c.getContext('webgl');
		const r = c.getBoundingClientRect();
		const cs = getComputedStyle(c);
		return {
			found: true,
			attrW: c.width, attrH: c.height,
			rectW: Math.round(r.width), rectH: Math.round(r.height),
			display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
			zIndex: cs.zIndex,
			glCtxAcquired: !!gl,
			glError: gl ? gl.getError() : null,
			glViewport: gl ? Array.from(gl.getParameter(gl.VIEWPORT)) : null,
			glClearColor: gl ? Array.from(gl.getParameter(gl.COLOR_CLEAR_VALUE)) : null,
			canvasInDom: document.body.contains(c)
		};
	})()`)
		)
	);

	console.log("\n== 循环是否在跑（采样两次 renderer.info）==");
	console.log(JSON.stringify(await ev(`window.__rhineDebug ?? 'no debug hook'`)));

	console.log("\n== 容器与遮挡 ==");
	console.log(
		JSON.stringify(
			await ev(`(() => {
		const host = document.querySelector('.rhine-array');
		const c = document.querySelector('.rhine-array-canvas');
		if (!host || !c) return { found: false };
		const hr = host.getBoundingClientRect();
		const top = document.elementFromPoint(hr.left + hr.width/2, hr.top + hr.height/2);
		return {
			hostRect: { w: Math.round(hr.width), h: Math.round(hr.height), top: Math.round(hr.top) },
			elementAtCenter: top ? (top.className || top.tagName) : null,
			hostOverflow: getComputedStyle(host).overflow,
			hostHeight: getComputedStyle(host).height
		};
	})()`)
		)
	);

	console.log("\n== 像素读数（多种方式）==");
	console.log(
		JSON.stringify(
			await ev(`(() => {
		const c = document.querySelector('.rhine-array-canvas');
		if (!c) return { found: false };
		const out = {};
		// 方式 A: toDataURL
		out.dataUrlLen = c.toDataURL('image/png').length;
		// 方式 B: 尝试 preserveDrawingBuffer 之外的 readPixels（借用同一个 context 不可行，
		// 所以换个思路：检查 canvas 是否有非零内容 —— 用 captureStream 不可用，改用 ImageBitmap）
		return out;
	})()`)
		)
	);

	// 用 Page.captureScreenshot 抓整页，看阵列区域是否有内容
	const shot = await rpc(ws, id++, "Page.captureScreenshot", { format: "png" });
	const fs = await import("node:fs");
	fs.writeFileSync("/tmp/rhine-page.png", Buffer.from(shot.data, "base64"));
	console.log("\n[screenshot] 已保存 /tmp/rhine-page.png, base64 长度:", shot.data.length);

	console.log("\n== 页面 console 日志 ==");
	for (const l of logs.slice(0, 25)) console.log("  " + l);

	ws.close();
};

main().catch((e) => {
	console.error("失败:", e.message);
	process.exit(1);
});
