/**
 * 无头 Edge + CDP 探针：验证 /docs 的三维卡片阵列是否真的在渲染。
 *
 * 检查项：
 *   1. WebGL 上下文是否创建成功（无降级遮罩）
 *   2. canvas 是否被真实绘制（读像素，全透明/全同色 = 没画东西）
 *   3. three 的懒加载 chunk 是否被抓取
 *   4. 方向键是否改变 HUD 上的分组/档案标题
 *   5. 页面是否有 console 错误
 */
const CDP_BASE = process.env.CDP_BASE || "http://127.0.0.1:9222";
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
			if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`));
			else resolve(msg.result);
		};
		ws.addEventListener("message", onMsg);
		ws.send(JSON.stringify({ id, method, params }));
		setTimeout(() => {
			ws.removeEventListener("message", onMsg);
			reject(new Error(`${method} timeout`));
		}, 30000);
	});
}

async function main() {
	// 找到可用的 page target
	const list = await (await fetch(`${CDP_BASE}/json/list`)).json();
	let page = list.find((t) => t.type === "page");
	if (!page) {
		const created = await (await fetch(`${CDP_BASE}/json/new?about:blank`, { method: "PUT" })).json();
		page = created;
	}
	console.log("[probe] target:", page.id, page.url);

	const ws = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((res, rej) => {
		ws.addEventListener("open", res, { once: true });
		ws.addEventListener("error", rej, { once: true });
	});

	let id = 1;
	const errors = [];
	const requests = [];

	ws.addEventListener("message", (ev) => {
		let msg;
		try {
			msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
		} catch {
			return;
		}
		if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
			errors.push(
				(msg.params.args || [])
					.map((a) => a.value ?? a.description ?? a.type)
					.join(" ")
			);
		}
		if (msg.method === "Runtime.exceptionThrown") {
			const d = msg.params.exceptionDetails;
			errors.push(d.exception?.description || d.text);
		}
		if (msg.method === "Network.requestWillBeSent") {
			requests.push(msg.params.request.url);
		}
	});

	await rpc(ws, id++, "Runtime.enable");
	await rpc(ws, id++, "Page.enable");
	await rpc(ws, id++, "Network.enable");
	await rpc(ws, id++, "Emulation.setDeviceMetricsOverride", {
		width: 1440,
		height: 900,
		deviceScaleFactor: 1,
		mobile: false
	});

	// 先清干净再访问，避免复用旧页面
	await rpc(ws, id++, "Page.navigate", { url: "about:blank" });
	await new Promise((r) => setTimeout(r, 300));
	const loaded = new Promise((resolve) => {
		const h = (ev) => {
			const m = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
			if (m.method === "Page.loadEventFired") {
				ws.removeEventListener("message", h);
				resolve();
			}
		};
		ws.addEventListener("message", h);
	});
	await rpc(ws, id++, "Page.navigate", { url: TARGET });
	await loaded;
	await new Promise((r) => setTimeout(r, 4500)); // 等 three 懒加载 + 进场动画

	async function evaluate(expr) {
		const r = await rpc(ws, id++, "Runtime.evaluate", {
			expression: expr,
			returnByValue: true,
			awaitPromise: true
		});
		if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
		return r.result.value;
	}

	// ── 1. canvas / WebGL 状态 ─────────────────────────────────────
	const canvasInfo = await evaluate(`(() => {
		const c = document.querySelector('.rhine-array-canvas');
		if (!c) return { found: false };
		const fallback = !!document.querySelector('.rhine-array-fallback');
		const veil = document.querySelector('.rhine-array-veil');
		return {
			found: true,
			w: c.width, h: c.height,
			cssW: Math.round(c.getBoundingClientRect().width),
			cssH: Math.round(c.getBoundingClientRect().height),
			fallback,
			veilReady: veil ? veil.getAttribute('data-ready') : null
		};
	})()`);
	console.log("[probe] canvas:", JSON.stringify(canvasInfo));

	// ── 2. 读画布像素，判断是否真的画了东西 ────────────────────────
	const pixels = await evaluate(`(() => {
		const c = document.querySelector('.rhine-array-canvas');
		if (!c) return { ok: false };
		// WebGL canvas 不能直接 getImageData，走 toDataURL 再解码
		const url = c.toDataURL('image/png');
		if (!url || url.length < 2000) return { ok: false, reason: 'canvas blank', len: url ? url.length : 0 };
		// 用离屏 2D canvas 采样中心区域的颜色多样性
		return new Promise((resolve) => {
			const img = new Image();
			img.onload = () => {
				const off = document.createElement('canvas');
				off.width = 200; off.height = 120;
				const ctx = off.getContext('2d');
				ctx.drawImage(img, img.width*0.3, img.height*0.3, img.width*0.4, img.height*0.4, 0, 0, 200, 120);
				const d = ctx.getImageData(0,0,200,120).data;
				const set = new Set();
				let nonTransparent = 0;
				for (let i=0;i<d.length;i+=4) {
					if (d[i+3] > 8) nonTransparent++;
					set.add((d[i]>>4)+','+(d[i+1]>>4)+','+(d[i+2]>>4));
				}
				resolve({ ok: true, dataUrlLen: url.length, uniqueColors: set.size, nonTransparent, total: d.length/4 });
			};
			img.onerror = () => resolve({ ok: false, reason: 'decode failed' });
			img.src = url;
		});
	})()`);
	console.log("[probe] pixels:", JSON.stringify(pixels));

	// ── 3. three 懒加载 chunk ──────────────────────────────────────
	const threeChunks = requests.filter((u) => /immutable\/chunks\/[^/]+\.js$/.test(u));
	console.log("[probe] 加载的 JS chunk 数:", threeChunks.length);
	console.log("[probe] 是否抓到 340KB 级别的 three 块:", threeChunks.length >= 3 ? "是" : "存疑");

	// ── 4. HUD 状态与键盘导航 ──────────────────────────────────────
	const hudBefore = await evaluate(`(() => ({
		section: document.querySelector('.rhine-hud-title')?.textContent?.trim(),
		serial: document.querySelector('.rhine-hud-detail .rhine-num')?.textContent?.trim(),
		name: document.querySelector('.rhine-hud-name')?.textContent?.trim(),
		activeDot: [...document.querySelectorAll('.rhine-hud-dot')].findIndex(d => d.getAttribute('data-on')==='true')
	}))()`);
	console.log("[probe] HUD 初始:", JSON.stringify(hudBefore));

	// 按方向键切分组
	async function press(key, code, keyCode) {
		await rpc(ws, id++, "Input.dispatchKeyEvent", {
			type: "keyDown",
			key,
			code,
			windowsVirtualKeyCode: keyCode,
			nativeVirtualKeyCode: keyCode
		});
		await rpc(ws, id++, "Input.dispatchKeyEvent", {
			type: "keyUp",
			key,
			code,
			windowsVirtualKeyCode: keyCode,
			nativeVirtualKeyCode: keyCode
		});
		await new Promise((r) => setTimeout(r, 700));
	}

	await press("ArrowRight", "ArrowRight", 39);
	const hudRight = await evaluate(`(() => ({
		section: document.querySelector('.rhine-hud-title')?.textContent?.trim(),
		serial: document.querySelector('.rhine-hud-detail .rhine-num')?.textContent?.trim(),
		name: document.querySelector('.rhine-hud-name')?.textContent?.trim(),
		activeDot: [...document.querySelectorAll('.rhine-hud-dot')].findIndex(d => d.getAttribute('data-on')==='true')
	}))()`);
	console.log("[probe] 右方向键后:", JSON.stringify(hudRight));

	await press("ArrowDown", "ArrowDown", 40);
	const hudDown = await evaluate(`(() => ({
		section: document.querySelector('.rhine-hud-title')?.textContent?.trim(),
		serial: document.querySelector('.rhine-hud-detail .rhine-num')?.textContent?.trim(),
		name: document.querySelector('.rhine-hud-name')?.textContent?.trim()
	}))()`);
	console.log("[probe] 下方向键后:", JSON.stringify(hudDown));

	// 再次采样像素，确认切分组后画面确实变了
	const pixelsAfter = await evaluate(`(() => {
		const c = document.querySelector('.rhine-array-canvas');
		const url = c.toDataURL('image/png');
		return { len: url.length };
	})()`);
	console.log("[probe] 切换后画布字节数:", pixelsAfter.len);

	// ── 5. 错误汇总 ────────────────────────────────────────────────
	console.log("[probe] console 错误数:", errors.length);
	for (const e of errors.slice(0, 8)) console.log("   ! " + String(e).split("\n")[0]);

	const verdict = {
		canvasPresent: canvasInfo.found === true,
		notFallback: canvasInfo.fallback === false,
		hasPixels: pixels.ok === true && (pixels.uniqueColors ?? 0) > 12,
		veilLifted: canvasInfo.veilReady === "true",
		navWorksSection: hudBefore.section !== hudRight.section,
		navWorksRow: hudRight.serial !== hudDown.serial || hudRight.name !== hudDown.name,
		noErrors: errors.filter((e) => !/favicon|404/.test(String(e))).length === 0
	};
	console.log("\n[probe] ==== 判定 ====");
	console.log(JSON.stringify(verdict, null, 2));
	console.log("[probe] 结论:", Object.values(verdict).every(Boolean) ? "全部通过 ✔" : "存在未通过项 ✘");

	ws.close();
}

main().catch((e) => {
	console.error("[probe] 失败:", e.message);
	process.exit(1);
});
