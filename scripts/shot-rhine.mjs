/**
 * 视觉验证：把阵列容器滚到视野中，截图，并逐格检查卡片像素分布。
 * 用 Page.captureScreenshot + clip 只抓阵列区域，避免侧边栏干扰。
 */
const CDP_BASE = process.env.CDP_BASE || "http://127.0.0.1:9333";
const TARGET = process.env.TARGET_URL || "http://127.0.0.1:8090/docs";
const OUT = process.env.OUT_DIR || "/tmp/rhine-shots";

import fs from "node:fs";
fs.mkdirSync(OUT, { recursive: true });

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
	const page = list.find((t) => t.type === "page" && t.url.includes("8090")) || list.find((t) => t.type === "page");
	const ws = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((r) => ws.addEventListener("open", r, { once: true }));

	let id = 1;
	await rpc(ws, id++, "Runtime.enable");
	await rpc(ws, id++, "Page.enable");

	const ev = async (expr) => {
		const r = await rpc(ws, id++, "Runtime.evaluate", {
			expression: expr,
			returnByValue: true,
			awaitPromise: true
		});
		if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
		return r.result.value;
	};

	const key = async (keyName, code, vk) => {
		await rpc(ws, id++, "Input.dispatchKeyEvent", {
			type: "keyDown", key: keyName, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk
		});
		await rpc(ws, id++, "Input.dispatchKeyEvent", {
			type: "keyUp", key: keyName, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk
		});
		await new Promise((r) => setTimeout(r, 800));
	};

	// 把阵列滚进视野
	await ev(`(() => {
		const host = document.querySelector('.rhine-array');
		if (host) host.scrollIntoView({ block: 'center', behavior: 'instant' });
		return true;
	})()`);
	await new Promise((r) => setTimeout(r, 900));

	const shot = async (name, label) => {
		const box = await ev(`(() => {
			const h = document.querySelector('.rhine-array');
			if (!h) return null;
			const r = h.getBoundingClientRect();
			return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
		})()`);
		if (!box) {
			console.log(label, "-> 未找到阵列容器");
			return null;
		}
		const res = await rpc(ws, id++, "Page.captureScreenshot", {
			format: "png",
			clip: { ...box, scale: 1 }
		});
		const file = `${OUT}/${name}.png`;
		fs.writeFileSync(file, Buffer.from(res.data, "base64"));
		const state = await ev(`(() => ({
			section: document.querySelector('.rhine-hud-title')?.textContent?.trim(),
			serial: document.querySelector('.rhine-hud-detail .rhine-num')?.textContent?.trim(),
			name: document.querySelector('.rhine-hud-name')?.textContent?.trim()
		}))()`);
		console.log(`${label}  [${JSON.stringify(state)}]  -> ${file}`);
		return file;
	};

	console.log("=== 逐格截图 ===");
	await shot("a-initial", "初始 (AI 入门 / 001)");

	await key("ArrowDown", "ArrowDown", 40);
	await shot("b-down1", "下 → 002");

	await key("ArrowDown", "ArrowDown", 40);
	await shot("c-down2", "下 → 003");

	await key("ArrowRight", "ArrowRight", 39);
	await shot("d-right", "右 → 换组");

	await key("ArrowRight", "ArrowRight", 39);
	await shot("e-right2", "右 → 再换组");

	ws.close();
};

main().catch((e) => {
	console.error("失败:", e.message);
	process.exit(1);
});
