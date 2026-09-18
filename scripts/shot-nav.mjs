/**
 * 导航逐格截图 —— 切分组、切文章、边界回卷各截一张。
 *
 * 光看一张首屏截图无法判断「左右切列、上下切卡」是否真的生效，
 * 所以这里模拟真实按键序列，每一步都留一张图与一份状态快照。
 */
const CDP = process.env.CDP_BASE ?? "http://127.0.0.1:9333";
const URL_TARGET = process.env.TARGET_URL ?? "http://127.0.0.1:8090/docs";
const OUT_DIR = process.env.OUT_DIR ?? "/tmp/rhine-nav";
const THEME = process.env.THEME ?? "dark";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 一次按键：dispatchKeyEvent 需要 rawKeyDown 才带得住方向键 */
async function pressKey(send, key, code, keyCode) {
	await send("Input.dispatchKeyEvent", {
		type: "rawKeyDown",
		windowsVirtualKeyCode: keyCode,
		code,
		key,
		nativeVirtualKeyCode: keyCode
	});
	await send("Input.dispatchKeyEvent", { type: "keyUp", windowsVirtualKeyCode: keyCode, code, key });
}

async function main() {
	const fs = await import("node:fs/promises");
	await fs.mkdir(OUT_DIR, { recursive: true });

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

	// 主题：mode-watcher 把主题记在 localStorage，重载后仍然生效
	if (THEME === "light" || THEME === "dark") {
		await send("Runtime.evaluate", {
			expression: `localStorage.setItem('mode-watcher-mode', '${THEME}'); location.reload();`
		});
		await sleep(4600);
	}

	const evalJs = async (expr) => {
		const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
		if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
		return r.result.value;
	};

	const state = async () => {
		const cam = await evalJs("JSON.stringify(window.__rhineDebug?.() ?? null)");
		const dom = await evalJs(`JSON.stringify({
			section: document.querySelector('.rhine-hud-title')?.textContent?.trim(),
			serial: document.querySelector('.rhine-hud-detail .rhine-num')?.textContent?.trim(),
			name: document.querySelector('.rhine-hud-name')?.textContent?.trim(),
			activeDot: [...document.querySelectorAll('.rhine-hud-dot')].findIndex(d => d.dataset.on === 'true')
		})`);
		return { ...(cam ? JSON.parse(cam) : {}), ...JSON.parse(dom) };
	};

	const shot = async (name) => {
		const r = await send("Page.captureScreenshot", { format: "png" });
		await fs.writeFile(`${OUT_DIR}/${name}.png`, Buffer.from(r.data, "base64"));
	};

	const log = (label, s) => {
		console.log(
			`  ${label.padEnd(22)} ${String(s.section ?? "-").padEnd(12)} ` +
				`#${String(s.serial ?? "---").padEnd(4)} lane${s.cell?.lane}/${s.cell?.row}  ` +
				`aim=(${s.aim?.x}, ${s.aim?.y})  ` +
				`${(s.name ?? "-").slice(0, 22)}`
		);
	};

	console.log(`== 导航逐格验证 (主题 ${THEME}) ==\n`);

	const steps = [
		{ name: "01-初始", keys: [] },
		{ name: "02-下移一行", keys: [["ArrowDown", "ArrowDown", 40]] },
		{ name: "03-再下移一行", keys: [["ArrowDown", "ArrowDown", 40]] },
		{ name: "04-右切分组", keys: [["ArrowRight", "ArrowRight", 39]] },
		{ name: "05-该组下移", keys: [["ArrowDown", "ArrowDown", 40]] },
		{ name: "06-再右切分组", keys: [["ArrowRight", "ArrowRight", 39]] },
		{ name: "07-左切回退", keys: [["ArrowLeft", "ArrowLeft", 37]] },
		{ name: "08-左切到边界", keys: [["ArrowLeft", "ArrowLeft", 37]] },
		{ name: "09-上移到顶", keys: [["ArrowUp", "ArrowUp", 38]] }
	];

	for (const st of steps) {
		for (const [k, c, kc] of st.keys) {
			await pressKey(send, k, c, kc);
			await sleep(240);
		}
		await sleep(420);
		const s = await state();
		log(st.name, s);
		await shot(st.name);
	}

	console.log(`\n截图 -> ${OUT_DIR}/`);
	ws.close();
}

main().catch((e) => {
	console.error("导航验证失败:", e.message);
	process.exit(1);
});
