/**
 * 交互热度验证 —— 点击射线拾取 + 悬停 + 滚轮。
 *
 * 键盘导航已有 shot-nav.mjs 覆盖，这里补上鼠标路径：
 * 点击卡片是否真的拾取到正确的那张（射线求交 / NDC 换算最容易错），
 * 悬停是否给出 cursor:pointer 反馈，滚轮是否切卡。
 */
const CDP = process.env.CDP_BASE ?? "http://127.0.0.1:9333";
const URL_TARGET = process.env.TARGET_URL ?? "http://127.0.0.1:8090/docs";

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
		const m = JSON.parse(e.data);
		if (m.id && pending.has(m.id)) {
			const { resolve, reject } = pending.get(m.id);
			pending.delete(m.id);
			m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
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
	await sleep(4600);

	const evalJs = async (expr) => {
		const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
		if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
		return r.result.value;
	};

	const state = async () =>
		JSON.parse(
			await evalJs(`JSON.stringify({
				section: document.querySelector('.rhine-hud-title')?.textContent?.trim(),
				serial: document.querySelector('.rhine-hud-detail .rhine-num')?.textContent?.trim(),
				name: document.querySelector('.rhine-hud-name')?.textContent?.trim(),
				cursor: document.querySelector('.rhine-array-canvas')?.style.cursor
			})`)
		);

	// 卡片在屏幕上的实际位置：用组件的射线反向验证太绕，
	// 改为直接问 canvas 的边界，再按「已知的取景数学」取样点
	const probe = async (label, x, y) => {
		await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
		await sleep(260);
		const s = await state();
		console.log(`  ${label.padEnd(20)} cursor=${String(s.cursor || "default").padEnd(9)} 选中 #${s.serial ?? "---"} ${s.name ?? ""}`);
		return s;
	};

	console.log("== 悬停反馈（cursor 应变 pointer）==");
	const canvasBox = JSON.parse(
		await evalJs(`JSON.stringify((() => {
			const r = document.querySelector('.rhine-array-canvas').getBoundingClientRect();
			return { x: r.x, y: r.y, w: r.width, h: r.height };
		})())`)
	);
	const cx = Math.round(canvasBox.x + canvasBox.w / 2);
	const cy = Math.round(canvasBox.y + canvasBox.h / 2);

	await probe("画布正中（应命中卡）", cx, cy);
	await probe("画布左上角（应空白）", Math.round(canvasBox.x + 20), Math.round(canvasBox.y + 20));

	console.log("\n== 点击拾取（点非当前卡 → 应切换而非跳转）==");
	const before = await state();
	console.log(`  点击前 #${before.serial} ${before.name}`);

	// 点到「右侧那一列」的卡片。注意：点「当前已选中的卡」会打开文章并跳转，
	// 所以必须点另一张卡才能验证「切卡」这条路径。
	const rightX = Math.round(canvasBox.x + canvasBox.w * 0.78);
	await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rightX, y: cy, button: "none" });
	await sleep(260);
	const hovered = await state();
	console.log(`  悬停右列 cursor=${hovered.cursor || "default"}`);

	await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rightX, y: cy, button: "left", clickCount: 1 });
	await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rightX, y: cy, button: "left", clickCount: 1 });
	await sleep(800);
	const after = await state();

	const url = await evalJs("location.pathname");
	if (url !== "/docs") {
		console.log(`  ✘ 点击触发了跳转（${url}）—— 但本应只切换选中`);
	} else if (before.serial !== after.serial) {
		console.log(`  点击后   #${after.serial} ${after.name}  (section ${after.section})`);
		console.log("  ✔ 拾取生效且未跳转，选中已切换");
	} else {
		console.log("  △ 未切换（可能点到了空白或当前卡本身）");
	}

	// 再点一次「刚选中的卡」→ 这次应当打开文章
	console.log("\n== 再次点击当前卡（应打开文章）==");
	await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rightX, y: cy, button: "left", clickCount: 1 });
	await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rightX, y: cy, button: "left", clickCount: 1 });
	await sleep(900);
	const url2 = await evalJs("location.pathname");
	console.log(`  路径现在 ${url2}  ${url2.startsWith("/docs/") ? "✔ 打开档案成功" : "△ 未跳转"}`);

	// 回到列表页继续测滚轮
	await send("Page.navigate", { url: URL_TARGET });
	await sleep(4600);

	console.log("\n== 滚轮切卡 ==");
	const wBefore = await state();
	await send("Input.dispatchMouseEvent", {
		type: "mouseWheel",
		x: cx,
		y: cy,
		deltaX: 0,
		deltaY: 120
	});
	await sleep(800);
	const wAfter = await state();
	console.log(`  #${wBefore.serial} → #${wAfter.serial}  ${wBefore.serial !== wAfter.serial ? "✔ 滚轮生效" : "△ 无变化"}`);

	ws.close();
}

main().catch((e) => {
	console.error("交互验证失败:", e.message);
	process.exit(1);
});
