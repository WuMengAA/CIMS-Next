/**
 * 相机与取景诊断 —— 把组件内部的真实数值掏出来看。
 *
 * 为什么需要它：取景/机位的问题在截图上只能看出「不对劲」，
 * 但看不出是 framingHeight 算错、还是 aspect 没生效、还是相机没被调用。
 * 这里把三者的实际值一次性打出来，配合截图定位。
 */
const CDP = process.env.CDP_BASE ?? "http://127.0.0.1:9333";
const URL_TARGET = process.env.TARGET_URL ?? "http://127.0.0.1:8090/docs";
const OUT = process.env.OUT ?? "/tmp/diag-viewport.png";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
	const list = await (await fetch(`${CDP}/json/list`)).json();
	let page = list.find((t) => t.type === "page" && t.url.includes("8090"));
	if (!page) page = list.find((t) => t.type === "page");
	if (!page) throw new Error("没有可用页面");

	const ws = new WebSocket(page.webSocketDebuggerUrl);
	let id = 0;
	const pending = new Map();

	ws.onmessage = (e) => {
		const msg = JSON.parse(e.data);
		if (msg.id && pending.has(msg.id)) {
			const { resolve, reject } = pending.get(msg.id);
			pending.delete(msg.id);
			msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
		}
	};
	await new Promise((r) => (ws.onopen = r));

	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const mid = ++id;
			pending.set(mid, { resolve, reject });
			ws.send(JSON.stringify({ id: mid, method, params }));
		});

	await send("Page.enable");
	await send("Runtime.enable");
	await send("Emulation.setDeviceMetricsOverride", {
		width: 1600,
		height: 900,
		deviceScaleFactor: 1,
		mobile: false
	});

	await send("Page.navigate", { url: URL_TARGET });
	await sleep(4200);

	const evalJs = async (expr) => {
		const r = await send("Runtime.evaluate", {
			expression: expr,
			returnByValue: true,
			awaitPromise: true
		});
		if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
		return r.result.value;
	};

	// 帧循环活性
	const f1 = await evalJs("window.__rhineFrames ?? -1");
	await sleep(1000);
	const f2 = await evalJs("window.__rhineFrames ?? -1");
	console.log("== 帧循环活性 ==");
	console.log(`  帧数 ${f1} -> ${f2}  (${f2 > f1 ? "循环在跑 ✔" : "未在跑 ✘"})`);

	// 组件内部的取景数学 —— 这是诊断三维构图的关键，截图看不出哪一步算错
	const cam = await evalJs("JSON.stringify(window.__rhineDebug?.() ?? null)");
	console.log("\n== 取景数学 ==");
	if (cam === "null") {
		console.log("  ✘ __rhineDebug 不可用（组件未就绪或未挂载）");
	} else {
		const d = JSON.parse(cam);
		console.log(`  fov=${d.fov}°  距离=${d.distance}  取景高=${d.framingHeight}  取景宽=${d.framedWidth}`);
		console.log(`  宽高比=${d.aspect.toFixed(3)}  分组=${d.lanes}  当前格=lane${d.cell.lane}/row${d.cell.row}`);
		console.log(`  注视偏移=(${d.aim.x}, ${d.aim.y})  机位=(${d.camPos.x}, ${d.camPos.y}, ${d.camPos.z})`);
		// 卡片在屏幕上的理论像素宽度（画布 1270 宽、卡宽 5 世界单位）
		const colPx = 1270 / (d.framedWidth / 5.2);
		console.log(`  → 每列约 ${colPx.toFixed(0)}px，卡片正面约 ${(colPx * 5 / 5.2).toFixed(0)}px`);
	}

	const info = await evalJs(`(() => {
		const c = document.querySelector('.rhine-array-canvas');
		const host = document.querySelector('.rhine-array');
		if (!c || !host) return { error: 'no canvas' };
		const r = c.getBoundingClientRect();
		const hr = host.getBoundingClientRect();
		const gl = c.getContext('webgl2') || c.getContext('webgl');
		const box = gl ? gl.getParameter(gl.VIEWPORT) : null;
		return {
			canvasCss: { w: Math.round(r.width), h: Math.round(r.height) },
			hostCss: { w: Math.round(hr.width), h: Math.round(hr.height) },
			aspect: +(r.width / r.height).toFixed(4),
			backingStore: { w: c.width, h: c.height },
			glViewport: box ? [box[0], box[1], box[2], box[3]] : null,
			pixelRatio: window.devicePixelRatio,
			dots: document.querySelectorAll('.rhine-hud-dot').length,
			activeDot: [...document.querySelectorAll('.rhine-hud-dot')].findIndex(d => d.dataset.on === 'true'),
			hudTitle: document.querySelector('.rhine-hud-title')?.textContent?.trim(),
			// 档案编号取 HUD 底部信息条里的 .rhine-num，不能用裸 querySelector ——
			// 顶部统计条也有 .rhine-num，会先命中那个滚动数字
			hudSerial: document.querySelector('.rhine-hud-detail .rhine-num')?.textContent?.trim(),
			hudName: document.querySelector('.rhine-hud-name')?.textContent?.trim(),
			veilReady: document.querySelector('.rhine-array-veil')?.dataset.ready
		};
	})()`);
	console.log("\n== DOM / WebGL 状态 ==");
	console.log(JSON.stringify(info, null, 2));

	const shot = await send("Page.captureScreenshot", { format: "png" });
	const fs = await import("node:fs/promises");
	await fs.writeFile(OUT, Buffer.from(shot.data, "base64"));
	console.log(`\n  截图 -> ${OUT}`);

	ws.close();
}

main().catch((e) => {
	console.error("诊断失败:", e.message);
	process.exit(1);
});
