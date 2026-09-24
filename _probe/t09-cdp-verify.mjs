// T09 第二步 CDP 端到端验证（移动端套壳：宿主浮动二维码入口 + 老师页扫码弹窗 + 重试按钮 + 窄屏）
// 用法: cd D:/Stelarith/Stelarith-website/stelarith && node _probe/t09-cdp-verify.mjs <adminToken>
import { writeFileSync } from "node:fs";
const CDP = "http://127.0.0.1:9333";
const TOKEN = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newTab() { return await fetch(CDP + "/json/new?about:blank", { method: "PUT" }).then((x) => x.json()); }
async function closeTab(id) { try { await fetch(CDP + "/json/close/" + id); } catch {} }
function wsSend(ws, method, params) {
  return new Promise((resolve, reject) => {
    const id = ++ws._seq;
    const handler = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      ws.removeEventListener("message", handler);
      if (m.error) reject(new Error(method + ": " + JSON.stringify(m.error)));
      else resolve(m.result);
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}
async function attach(id) {
  const info = await fetch(CDP + "/json/list").then((x) => x.json());
  const t = info.find((p) => p.id === id);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  ws._seq = 0;
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  for (const m of ["Page", "Runtime", "Network"]) await wsSend(ws, m + ".enable");
  return ws;
}
async function evalJs(ws, expr, awaitPromise = false) {
  const r = await wsSend(ws, "Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error("eval err: " + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result && r.result.value;
}
async function waitExpr(ws, expr, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { const v = await evalJs(ws, expr); if (v) return v; } catch {}
    await sleep(350);
  }
  throw new Error("timeout waiting: " + expr);
}
async function shot(ws, file) {
  const r = await wsSend(ws, "Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(file, Buffer.from(r.data, "base64"));
  console.log("[截图]", file, r.data.length, "B base64");
}
// 弹窗二维码 canvas 信息：非白像素占比（真实二维码 = 有黑块）
async function qrInfo(ws, exprRoot) {
  return await evalJs(ws, `(() => {
    const box = document.querySelector('.qr-mask .qr-canvas canvas');
    if (!box) return { canvas: false };
    const ctx = box.getContext('2d');
    const img = ctx.getImageData(0, 0, box.width, box.height).data;
    let dark = 0, total = 0;
    for (let i = 0; i < img.length; i += 4) {
      const lum = img[i] * 0.3 + img[i + 1] * 0.6 + img[i + 2] * 0.1;
      if (lum < 128) dark++;
      total++;
    }
    return { canvas: true, w: box.width, h: box.height, darkPct: +(dark / total * 100).toFixed(2) };
  })()`);
}
async function qrDataUrl(ws) {
  return await evalJs(ws, `(() => { const c = document.querySelector('.qr-mask .qr-canvas canvas'); return c ? c.toDataURL() : ''; })()`);
}

(async () => {
  const tab = await newTab();
  const ws = await attach(tab.id);
  await wsSend(ws, "Network.setCookie", { name: "admin_token", value: TOKEN, url: "http://127.0.0.1:8090", path: "/" });

  // ── ① 宿主页 /admin/console：浮动入口 + 弹窗二维码 ──────────────────────────
  await wsSend(ws, "Page.navigate", { url: "http://127.0.0.1:8090/admin/console" });
  await waitExpr(ws, `document.querySelector('.teacher-qr-btn') ? 'yes' : null`, 30000);
  const entry = await evalJs(ws, `(() => {
    const b = document.querySelector('.teacher-qr-btn');
    const r = b.getBoundingClientRect();
    return { text: b.textContent.trim(), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  })()`);
  console.log("[①宿主] 浮动按钮:", JSON.stringify(entry));
  await evalJs(ws, `document.querySelector('.teacher-qr-btn').click(); 'clicked'`);
  await waitExpr(ws, `document.querySelector('.qr-mask .qr-canvas canvas') ? 'yes' : null`, 15000);
  const hostQr = await qrInfo(ws);
  const hostUrl = await evalJs(ws, `document.querySelector('.qr-url').value`);
  console.log("[①宿主] 弹窗二维码:", JSON.stringify(hostQr), "内容=", hostUrl);
  const hostD1 = await qrDataUrl(ws);
  // 编辑输入框 → 二维码重绘（内容变化）
  await evalJs(ws, `(() => { const i = document.querySelector('.qr-url'); i.value = 'https://example.com/teacher?x=2'; i.dispatchEvent(new Event('input', { bubbles: true })); return 'edited'; })()`);
  await sleep(600);
  const hostD2 = await qrDataUrl(ws);
  console.log("[①宿主] 编辑后二维码重绘(内容变):", hostD1 !== hostD2);
  // 还原内容并截图
  await evalJs(ws, `(() => { const i = document.querySelector('.qr-url'); i.value = ${JSON.stringify(hostUrl)}; i.dispatchEvent(new Event('input', { bubbles: true })); return 'restored'; })()`);
  await sleep(600);
  await shot(ws, "_probe/t09-qr-console.png");
  await evalJs(ws, `document.querySelector('.qr-x').click(); 'closed'`);
  await sleep(400);

  // ── ② 老师页 /teacher（375×667 手机视口）：manifest + footer 扫码 + 弹窗 ────
  await wsSend(ws, "Emulation.setDeviceMetricsOverride", { width: 375, height: 667, deviceScaleFactor: 1, mobile: true });
  await wsSend(ws, "Page.navigate", { url: "http://127.0.0.1:8090/teacher" });
  await waitExpr(ws, `document.querySelector('.teacher-page') ? 'yes' : null`, 30000);
  const tHead = await evalJs(ws, `(() => ({
    manifest: !!document.querySelector('link[rel="manifest"]'),
    themeColor: (document.querySelector('meta[name="theme-color"]') || {}).content || '',
    title: document.title,
    devCount: document.querySelectorAll('.tp-dev').length,
    bigButtons: [...document.querySelectorAll('.tp-big')].map(b => ({ label: b.querySelector('.tp-big-label')?.textContent, disabled: b.disabled })),
    footText: (document.querySelector('.tp-foot')?.textContent || '').replace(/\\s+/g, ' ').trim()
  }))()`);
  console.log("[②老师页] 视口375×667:", JSON.stringify(tHead, null, 1));
  const btnRect = await evalJs(ws, `(() => { const r = document.querySelector('.tp-big').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }; })()`);
  console.log("[②老师页] 三个按钮一屏内(三按钮 bottom 应<667):", JSON.stringify(btnRect));
  await shot(ws, "_probe/t09-teacher-mobile.png");
  // footer 扫码 → 弹窗二维码
  await evalJs(ws, `(() => { const b = [...document.querySelectorAll('.tp-foot button')].find(x => x.textContent.includes('手机扫码')); if (!b) return 'NO_BTN'; b.click(); return 'clicked'; })()`);
  await waitExpr(ws, `document.querySelector('.qr-mask .qr-canvas canvas') ? 'yes' : null`, 15000);
  const tQr = await qrInfo(ws);
  const tUrl = await evalJs(ws, `document.querySelector('.qr-url').value`);
  console.log("[②老师页] 弹窗二维码:", JSON.stringify(tQr), "内容=", tUrl);
  await shot(ws, "_probe/t09-qr-teacher.png");
  await evalJs(ws, `document.querySelector('.qr-x').click(); 'closed'`);

  // ── ③ 重试按钮：注入设备请求失败 → 错误态出现重试 → 恢复后重试成功 ──────────
  const injected = await wsSend(ws, "Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__blockDevices = true;
    const __orig = window.fetch.bind(window);
    window.fetch = function (url, opts) {
      const u = String(url);
      if (window.__blockDevices && u.includes('/class/device-status')) {
        return Promise.resolve(new Response(JSON.stringify({ error: 'injected-fail' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
      }
      return __orig(url, opts);
    };`
  });
  await wsSend(ws, "Page.navigate", { url: "http://127.0.0.1:8090/teacher" });
  await waitExpr(ws, `document.querySelector('.tp-err') ? 'yes' : null`, 20000);
  const errState = await evalJs(ws, `(() => {
    const err = document.querySelector('.tp-err');
    const retry = [...document.querySelectorAll('.tp-link-btn')].map(b => b.textContent.trim());
    return { errText: (err?.textContent || '').replace(/\\s+/g, ' ').trim(), retryBtns: retry };
  })()`);
  console.log("[③重试] 设备错误态:", JSON.stringify(errState));
  await shot(ws, "_probe/t09-teacher-retry.png");
  // 解除拦截 → 点重试 → 设备列表恢复
  await evalJs(ws, `window.__blockDevices = false; 'unblocked'`);
  await evalJs(ws, `(() => { const b = [...document.querySelectorAll('.tp-link-btn')].find(x => x.textContent.includes('重试')); if (!b) return 'NO_RETRY'; b.click(); return 'retry-clicked'; })()`);
  await waitExpr(ws, `document.querySelectorAll('.tp-dev').length > 0 ? 'devices' : null`, 25000);
  const devCount = await evalJs(ws, `document.querySelectorAll('.tp-dev').length`);
  console.log("[③重试] 恢复后设备数:", devCount);
  await wsSend(ws, "Page.removeScriptToEvaluateOnNewDocument", { identifier: injected.identifier });

  // ── ④ 超窄屏 320px 走查 ─────────────────────────────────────────────────────
  await wsSend(ws, "Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 1, mobile: true });
  await wsSend(ws, "Page.navigate", { url: "http://127.0.0.1:8090/teacher" });
  await waitExpr(ws, `document.querySelector('.teacher-page') ? 'yes' : null`, 30000);
  const narrow = await evalJs(ws, `(() => {
    const btns = [...document.querySelectorAll('.tp-big')].map(b => { const r = b.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; });
    const bodyScroll = document.body.scrollHeight;
    return { btns, bodyScroll, viewport: window.innerHeight, overflow: document.documentElement.scrollWidth > window.innerWidth };
  })()`);
  console.log("[④窄屏320] 按钮位置与溢出:", JSON.stringify(narrow));
  await shot(ws, "_probe/t09-teacher-narrow.png");

  await closeTab(tab.id);
  console.log("=== T09 第二步 CDP 验证完成 ===");
  process.exit(0);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
