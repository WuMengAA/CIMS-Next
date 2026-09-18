/**
 * 强制刷新后检查阵列是否真的活着，并诊断导航为何卡住。
 */
const CDP_BASE = process.env.CDP_BASE || "http://127.0.0.1:9333";
const TARGET = process.env.TARGET_URL || "http://127.0.0.1:8090/docs";

function rpc(ws, id, method, params = {}) {
	return new Promise((resolve, reject) => {
		const onMsg = (ev) => {
			let m;
			try {
				m = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
			} catch {
				return;
			}
			if (m.id !== id) return;
			ws.removeEventListener("message", onMsg);
			if (m.error) reject(new Error(method + ": " + JSON.stringify(m.error)));
			else resolve(m.result);
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
	const pg = list.find((t) => t.type === "page" && t.url.includes("8090")) || list.find((t) => t.type === "page");
	const ws = new WebSocket(pg.webSocketDebuggerUrl);
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
			logs.push("[" + m.params.type + "] " + (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" "));
		}
		if (m.method === "Runtime.exceptionThrown") {
			const d = m.params.exceptionDetails;
			logs.push("[exception] " + (d.exception?.description || d.text));
		}
	});

	await rpc(ws, id++, "Runtime.enable");
	await rpc(ws, id++, "Page.enable");

	// 强制硬刷新
	await rpc(ws, id++, "Page.reload", { ignoreCache: true });
	await new Promise((r) => setTimeout(r, 6000));

	const ev = async (expr) => {
		const r = await rpc(ws, id++, "Runtime.evaluate", {
			expression: expr,
			returnByValue: true,
			awaitPromise: true
		});
		if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception?.description || r.exceptionDetails.text || "").split("\n")[0] };
		return r.result.value;
	};

	console.log("== 刷新后 canvas/engine 状态 ==");
	console.log(
		JSON.stringify(
			await ev(`(() => {
		const c = document.querySelector('.rhine-array-canvas');
		const host = document.querySelector('.rhine-array');
		if (!c) return { canvas: false };
		const gl = c.getContext('webgl2') || c.getContext('webgl');
		return {
			canvas: true,
			w: c.width, h: c.height,
			hostH: host ? Math.round(host.getBoundingClientRect().height) : null,
			hostTop: host ? Math.round(host.getBoundingClientRect().top) : null,
			winH: window.innerHeight,
			scrollY: Math.round(window.scrollY),
			docH: document.documentElement.scrollHeight,
			hasGL: !!gl
		};
	})()`)
		)
	);

	// 滚到阵列
	await ev(`(() => { const h=document.querySelector('.rhine-array'); if(h) h.scrollIntoView({block:'center',behavior:'instant'}); return true; })()`);
	await new Promise((r) => setTimeout(r, 1200));

	console.log("\n== 滚动后 host 位置 ==");
	console.log(
		JSON.stringify(
			await ev(`(() => {
		const h = document.querySelector('.rhine-array');
		const r = h.getBoundingClientRect();
		return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), winH: window.innerHeight, scrollY: Math.round(window.scrollY) };
	})()`)
		)
	);

	console.log("\n== 键盘导航测试（每次读 HUD）==");
	for (const k of ["ArrowDown", "ArrowDown", "ArrowRight", "ArrowRight"]) {
		const vk = k === "ArrowDown" ? 40 : 39;
		await rpc(ws, id++, "Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
		await rpc(ws, id++, "Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
		await new Promise((r) => setTimeout(r, 900));
		const s = await ev(`(() => ({
			section: document.querySelector('.rhine-hud-title')?.textContent?.trim(),
			serial: document.querySelector('.rhine-hud-detail .rhine-num')?.textContent?.trim(),
			name: (document.querySelector('.rhine-hud-name')?.textContent?.trim() || '').slice(0, 26)
		}))()`);
		console.log("  " + k + " ->", JSON.stringify(s));
	}

	console.log("\n== console 日志 ==");
	for (const l of logs.slice(0, 20)) console.log("  " + l);

	ws.close();
};

main().catch((e) => {
	console.error("失败:", e.message);
	process.exit(1);
});
