/**
 * 卡片网格共面性核查。
 *
 * 三维构图出问题时，截图只能说明「看着不对」。这个脚本直接读每张卡的
 * 真实世界坐标，验证「第 r 行的 y 是否等于 -r × ROW_SPACING」——
 * 这是卡片形成规整矩阵的唯一几何前提。
 */
const CDP = process.env.CDP_BASE ?? "http://127.0.0.1:9333";
const URL_TARGET = process.env.TARGET_URL ?? "http://127.0.0.1:8090/docs";

const ROW_SPACING = 4.32;
const COLUMN_SPACING = 5.2;

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
	await sleep(4200);

	const evalJs = async (expr) => {
		const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
		if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
		return r.result.value;
	};

	const raw = await evalJs("JSON.stringify(window.__rhineCards?.() ?? null)");
	if (raw === "null") {
		console.log("✘ __rhineCards 不可用");
		ws.close();
		return;
	}
	const cards = JSON.parse(raw);

	console.log(`== 卡片网格核查（共 ${cards.length} 张可见）==\n`);
	console.log("slug                                   lane row    x      y       z");
	const byRow = new Map();
	for (const c of cards.sort((a, b) => a.lane - b.lane || a.row - b.row)) {
		const slug = (c.slug ?? "-").slice(0, 34).padEnd(36);
		console.log(
			`${slug} ${String(c.lane).padEnd(4)} ${String(c.row).padEnd(4)} ` +
				`${c.x.toFixed(2).padStart(6)} ${c.y.toFixed(2).padStart(7)} ${c.z.toFixed(3).padStart(7)}`
		);
		if (!byRow.has(c.row)) byRow.set(c.row, []);
		byRow.get(c.row).push(c);
	}

	console.log("\n== 共面性判定 ==");
	let allOk = true;
	for (const [row, list] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
		const expectY = -row * ROW_SPACING;
		const ys = list.map((c) => c.y);
		const maxDev = Math.max(...ys.map((y) => Math.abs(y - expectY)));
		const ok = maxDev < 0.001;
		if (!ok) allOk = false;
		console.log(
			`  row ${String(row).padEnd(3)} 期望 y=${expectY.toFixed(3).padStart(7)}  ` +
				`实际 ${ys.map((y) => y.toFixed(3)).join(", ").padEnd(30)}  ` +
				`偏差 ${maxDev.toFixed(4)}  ${ok ? "✔" : "✘ 不共面"}`
		);
	}

	// 列方向也查一遍
	console.log("\n== 列对齐判定 ==");
	const byLane = new Map();
	for (const c of cards) {
		if (!byLane.has(c.lane)) byLane.set(c.lane, []);
		byLane.get(c.lane).push(c);
	}
	for (const [lane, list] of [...byLane.entries()].sort((a, b) => a[0] - b[0])) {
		const expectX = lane * COLUMN_SPACING;
		const xs = list.map((c) => c.x);
		const maxDev = Math.max(...xs.map((x) => Math.abs(x - expectX)));
		const ok = maxDev < 0.001;
		if (!ok) allOk = false;
		console.log(
			`  lane ${String(lane).padEnd(3)} 期望 x=${expectX.toFixed(3).padStart(7)}  ` +
				`实际 ${xs.map((x) => x.toFixed(2)).join(", ").padEnd(30)}  ` +
				`偏差 ${maxDev.toFixed(4)}  ${ok ? "✔" : "✘ 未对齐"}`
		);
	}

	console.log(`\n总结：${allOk ? "✔ 网格规整，所有卡片共面且按行列对齐" : "✘ 网格有偏差，见上方标记"}`);
	ws.close();
}

main().catch((e) => {
	console.error("核查失败:", e.message);
	process.exit(1);
});
