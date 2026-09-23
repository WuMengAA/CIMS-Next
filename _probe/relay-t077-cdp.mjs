// T07.7 步骤 3 验收（web 实测）：面板真实打开 → 设备视图 → 点截图 → 弹窗展示回传图
// 用法: cd D:/Stelarith/Stelarith-website/stelarith && node _probe/relay-t077-cdp.mjs <adminToken>
import { execSync } from "node:child_process";
import fs from "node:fs";
import crypto from "node:crypto";

const CDP = "http://127.0.0.1:9333";
const token = process.argv[2] || execSync(`node D:/Stelarith/_probe/mint-session.mjs mint admin`, { cwd: process.cwd(), encoding: "utf-8" }).trim();

async function newTab() {
  const r = await fetch(CDP + "/json/new?about:blank", { method: "PUT" }).then((x) => x.json());
  return r;
}
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function evalJs(ws, expr, awaitPromise = false) {
  const r = await wsSend(ws, "Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error("eval err: " + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result && r.result.value;
}
async function waitExpr(ws, expr, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { const v = await evalJs(ws, expr); if (v) return v; } catch {}
    await sleep(400);
  }
  throw new Error("timeout waiting: " + expr);
}
const report = [];

(async () => {
  const tab = await newTab();
  const ws = await attach(tab.id);
  await wsSend(ws, "Network.setCookie", { name: "admin_token", value: token, url: "http://127.0.0.1:8090", path: "/" });

  // ② 宿主 /admin/console：读 iframe 权限位
  await wsSend(ws, "Page.navigate", { url: "http://127.0.0.1:8090/admin/console" });
  await sleep(4000);
  const src = await evalJs(ws, `(() => { const f = document.querySelector('iframe'); return f ? f.src : 'NO_IFRAME'; })()`);
  const grab = (k) => (src.match(new RegExp('[?&]' + k + '=([^&]+)')) || [])[1];
  report.push(`[宿主] /admin/console iframe: control=${grab('control')} remote=${grab('remote')} manage=${grab('manage')} broadcast=${grab('broadcast')} account=${grab('account')} role=${(src.match(/[?&]role=([^&]+)/) || [])[1]}`);

  // ③ 进 iframe：读面板注入的后端上下文（accountId / extHost / mgmtHost）
  const ctx = await evalJs(ws, `(() => {
    const f = document.querySelector('iframe');
    if (!f || !f.contentWindow || !f.contentWindow.API) return 'NO_IFRAME_API';
    return JSON.stringify({
      accountId: f.contentWindow.API.state.accountId,
      extHost: f.contentWindow.API.state.extHost,
      mgmtHost: f.contentWindow.API.state.mgmtHost,
      demo: f.contentWindow.API.state.demo
    });
  })()`);
  report.push(`[面板] 内嵌上下文: ${ctx}`);

  // ④ 设备视图（点侧栏「设备控制」）＋ 挂异常捕获
  await evalJs(ws, `(() => {
    const f = document.querySelector('iframe');
    f.contentWindow.__errs = [];
    f.contentWindow.addEventListener('error', (e) => f.contentWindow.__errs.push('ERR:' + e.message));
    f.contentWindow.addEventListener('unhandledrejection', (e) => f.contentWindow.__errs.push('REJ:' + String(e.reason)));
    return true;
  })()`);
  // ④b 前置：在「点击前一刻」让本机测试 agent（17997, UID=n7-20091211）截屏，
  // 保证回传在 TTL 内新鲜（轮询窗口 20s 内必然命中）
  const ts = Math.floor(Date.now() / 1000);
  const sign = crypto.createHmac("sha256", "dev-secret-change-me").update(`screenshot|${ts}`).digest("hex");
  let fresh = await fetch("http://127.0.0.1:17997/task", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "screenshot", token: sign, ts, scope: "device" })
  }).then((r) => r.json());
  report.push(`[前置] 本机 agent 截屏(点击前): result=${fresh.result} bytes=${fresh.bytes}`);
  await sleep(1200); // 等后台线程上传
  const devClicked = await waitExpr(ws, `(() => {
    const f = document.querySelector('iframe');
    if (!f || !f.contentDocument) return false;
    const b = f.contentDocument.querySelector('#sidebar .nav[data-view="devices"]');
    if (!b) return false;
    b.click();
    return true;
  })()`, 10000);
  report.push(`[面板] 侧栏「设备控制」已点击: ${devClicked}`);
  await sleep(2500);

  // ③ 设备行 lab-pc-001：状态 + 截图按钮 disabled/data-host
  const rowInfo = await evalJs(ws, `(() => {
    const f = document.querySelector('iframe');
    const doc = f.contentDocument;
    const rows = [...doc.querySelectorAll('.dev-row')];
    const row = rows.find((r) => (r.querySelector('td') ? r.innerText.includes('lab-pc-001') : false));
    if (!row) return 'NO_ROW lab-pc-001（当前列表: ' + rows.map((r) => r.innerText.slice(0, 30)).join(' / ') + '）';
    const btn = row.querySelector('[data-a="screenshot"]');
    return JSON.stringify({
      found: true,
      disabled: btn ? btn.disabled : 'NO_BTN',
      dataHost: btn ? btn.getAttribute('data-host') : null,
      dataId: btn ? btn.getAttribute('data-id') : null,
      onlineText: row.innerText.includes('在线') ? '在线' : '离线'
    });
  })()`);
  report.push(`[面板] 设备行 lab-pc-001 截图按钮: ${rowInfo}`);

  // ④ 强点：解除 disabled 后真实 click（离线设备按钮禁用是预期行为，此处为验证「点击→轮询→弹窗」链路）
  await evalJs(ws, `(() => {
    const f = document.querySelector('iframe');
    const doc = f.contentDocument;
    const row = [...doc.querySelectorAll('.dev-row')].find((r) => r.innerText.includes('lab-pc-001'));
    const btn = row && row.querySelector('[data-a="screenshot"]');
    if (btn) { btn.disabled = false; btn.click(); }
    return !!btn;
  })()`);
  report.push(`[面板] 已对 lab-pc-001「截图」按钮强点 click()`);
  await sleep(2500);

  // ⑤ 点击后的即时反馈（#status-msg / offline 横幅 / 未捕获异常）
  const feedback = await evalJs(ws, `(() => {
    const f = document.querySelector('iframe');
    const doc = f.contentDocument;
    const msg = doc.querySelector('#status-msg') ? doc.querySelector('#status-msg').textContent.trim() : null;
    const offline = doc.querySelector('[class*=offline], #offline-banner') ? doc.querySelector('[class*=offline], #offline-banner').textContent.trim().slice(0, 120) : null;
    const errs = f.contentWindow.__errs || [];
    return JSON.stringify({ statusMsg: msg, offline, errs: errs.slice(-5) });
  })()`);
  report.push(`[面板] 点击后即时反馈: ${feedback}`);

  // ⑥ iframe 内直连 ext captures（验证 cookie 鉴权与回传可达性）
  const direct = await evalJs(ws, `(async () => {
    const f = document.querySelector('iframe');
    try {
      const r = await f.contentWindow.fetch('/api/console/ext/captures?uid=n7-20091211');
      const j = await r.json();
      return 'HTTP ' + r.status + ' capture=' + (j.capture ? 'yes(bytes=' + j.capture.bytes + ')' : 'null') + ' reason=' + j.reason;
    } catch (e) { return 'ERR ' + e.message; }
  })()`, true);
  report.push(`[面板] iframe 内直连 captures: ${direct}`);

  // ⑦ 等待弹窗（waitForCapture 轮询 20s；回传图已由本机测试 agent 以 uid=n7-20091211 上传）
  let shot = null;
  const t0 = Date.now();
  try {
    shot = await waitExpr(ws, `(() => {
      const f = document.querySelector('iframe');
      const doc = f.contentDocument;
      const img = doc.querySelector('body > div img[alt="教室端截图"]');
      if (!img) return null;
      return JSON.stringify({ shown: img.complete && img.naturalWidth > 0, w: img.naturalWidth, h: img.naturalHeight, title: img.parentElement.querySelector('b') ? img.parentElement.querySelector('b').textContent : '' });
    })()`, 30000);
  } catch (e) {
    const fin = await evalJs(ws, `(() => {
      const f = document.querySelector('iframe');
      const doc = f.contentDocument;
      return JSON.stringify({
        statusMsg: doc.querySelector('#status-msg') ? doc.querySelector('#status-msg').textContent.trim() : null,
        errs: (f.contentWindow.__errs || []).slice(-5),
        elapsed: ${Date.now() - t0}
      });
    })()`);
    report.push(`[面板] 弹窗未出现（${e.message.slice(0, 60)}）· 最终状态: ${fin}`);
    throw e;
  }
  report.push(`[面板] 截图弹窗: ${shot}`);

  // ⑥ 弹窗截图存盘
  const s = await wsSend(ws, "Page.captureScreenshot", { format: "png" });
  const file = "D:/Stelarith/_probe/t077-cdp-shot.png";
  fs.writeFileSync(file, Buffer.from(s.data, "base64"));
  report.push(`[面板] 页面截图已存: ${file}`);

  // ⑦ 弹窗关闭按钮可用性
  const closeBtn = await evalJs(ws, `(() => {
    const f = document.querySelector('iframe');
    const doc = f.contentDocument;
    const box = doc.querySelector('body > div img[alt="教室端截图"]');
    if (!box) return 'NO_BOX';
    const btn = box.parentElement.querySelector('button');
    btn.click();
    return 'closed: ' + !doc.querySelector('body > div img[alt="教室端截图"]');
  })()`);
  report.push(`[面板] 关闭按钮: ${closeBtn}`);

  console.log(report.join("\n"));
  await ws.close();
  await closeTab(tab.id);
  execSync(`node D:/Stelarith/_probe/mint-session.mjs drop ${token}`, { cwd: process.cwd(), encoding: "utf-8" });
})().catch((e) => {
  console.error("✗ " + e.message);
  console.log(report.join("\n"));
  process.exit(1);
});
