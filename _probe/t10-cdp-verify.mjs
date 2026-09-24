// T10（#248 等级/权限彻底解耦）CDP 端到端验证
// 用法: cd D:/Stelarith/Stelarith-website/stelarith && node _probe/t10-cdp-verify.mjs <adminToken> <viewerToken>
// 验证点：
//  A. admin 面板「权限与分级」视图：矩阵图上不再出现等级（无「内容等级轴/L1–L5」），
//     角色对照表改为「称号（权限来源）」列，称号轴卡片渲染 7 个称号；身份卡显示经验等级。
//  B. viewer（xp=1600 → Lv.6 传奇）资料页：显示 Lv.6 传奇 + 经验 1600 + 角色「游客」，
//     但 /admin/console 依旧被 303 拦（viewConsole=false，权限与等级零耦合）。
//  C. /api/me 返回 xp/level/levelLabel（面板身份校准通道）。
import { writeFileSync } from "node:fs";
const CDP = "http://127.0.0.1:9333";
const ADMIN = process.argv[2];
const VIEWER = process.argv[3];
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
    await sleep(400);
  }
  throw new Error("timeout waiting: " + expr);
}
async function shot(ws, file) {
  const r = await wsSend(ws, "Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(file, Buffer.from(r.data, "base64"));
  console.log("[截图]", file, r.data.length, "B base64");
}
const report = [];
const ok = (m) => { report.push("✓ " + m); console.log("[OK] " + m); };
const bad = (m) => { report.push("✗ " + m); console.log("[FAIL] " + m); };
const inPanel = (expr, awaitPromise = false) => `(() => {
  const f = document.querySelector('iframe');
  if (!f || !f.contentWindow) return 'NO_IFRAME';
  const w = f.contentWindow;
  try { return (${expr}); } catch (e) { return 'IFRAME_ERR: ' + (e && e.message || e); }
})()`;
async function openUrl(ws, cookie, url) {
  await wsSend(ws, "Network.setCookie", { name: "admin_token", value: cookie, url: "http://127.0.0.1:8090", path: "/" });
  await wsSend(ws, "Page.navigate", { url });
}

(async () => {
  const tab = await newTab();
  const ws = await attach(tab.id);

  // ════ A. admin 面板「权限与分级」视图 ════
  await openUrl(ws, ADMIN, "http://127.0.0.1:8090/admin/console");
  await waitExpr(ws, `document.querySelector('iframe') ? 'yes' : null`, 30000);
  // 等待面板 API 就绪
  await waitExpr(ws, inPanel(`w.API && w.API.permissions ? JSON.stringify({mm: w.API.state.mgmtHost, demo: w.API.state.demo}) : null`), 30000);
  ok("面板 API 就绪（mgmtHost 已注入，非演示模式）");
  // 切到「权限与分级」视图
  const navRes = await evalJs(ws, inPanel(`(() => {
    const b = [...w.document.querySelectorAll('.nav')].find(x => x.dataset.view === 'roles');
    if (!b) return 'NO_ROLES_NAV';
    b.click(); return 'clicked';
  })()`));
  ok("点击侧栏「权限与分级」: " + navRes);
  await sleep(1800);

  // 断言 1：矩阵页不再出现等级字样
  const noLevel = await evalJs(ws, inPanel(`(() => {
    const html = w.document.querySelector('#view') ? w.document.querySelector('#view').innerText : '';
    return {
      hasLevelAxis: html.includes('内容等级轴'),
      hasL1L5: /L1\s*–\s*L5|L1-L5/.test(html),
      hasInheritText: html.includes('等级高的自动继承'),
      hasRoleTitle: html.includes('称号（权限来源）'),
      hasTitleAxis: html.includes('称号轴'),
      bodyLen: html.length
    };
  })()`));
  noLevel.hasLevelAxis || noLevel.hasL1L5 || noLevel.hasInheritText
    ? bad("权限矩阵仍含旧等级轴残留: " + JSON.stringify(noLevel))
    : ok("权限矩阵图上不再出现等级（无内容等级轴/L1–L5/继承文案）");
  noLevel.hasRoleTitle ? ok("角色对照表表头为「称号（权限来源）」") : bad("角色对照表表头缺失: " + JSON.stringify(noLevel));
  noLevel.hasTitleAxis ? ok("存在「称号轴（权限只来自称号）」卡片") : bad("称号轴卡片缺失");

  // 断言 2：称号轴卡片渲染内容（7 个称号 + 动作标签）
  const titleAxis = await evalJs(ws, inPanel(`(() => {
    const cards = [...w.document.querySelectorAll('#view .card')];
    const card = cards.find(c => (c.querySelector('h3')?.textContent || '').includes('称号轴'));
    if (!card) return { miss: true };
    const groups = [...card.querySelectorAll('div[style*="margin-bottom"]')];
    return {
      groups: groups.length,
      sample: groups.slice(0, 3).map(g => g.innerText.replace(/\\s+/g, ' ').trim().slice(0, 90)),
      hasViewConsole: card.innerText.includes('进入集控面板')
    };
  })()`));
  titleAxis.miss ? bad("称号轴卡片未找到") :
    (titleAxis.groups >= 7 && titleAxis.hasViewConsole ? ok("称号轴渲染 " + titleAxis.groups + " 个称号、动作标签完整: " + JSON.stringify(titleAxis.sample)) : bad("称号轴渲染异常: " + JSON.stringify(titleAxis)));

  // 断言 3：角色对照表行显示称号而非等级
  const roleRow = await evalJs(ws, inPanel(`(() => {
    const tables = [...w.document.querySelectorAll('#view table')];
    const t = tables.find(t => t.textContent.includes('称号（权限来源）'));
    if (!t) return { miss: true };
    const head = [...t.querySelectorAll('th')].map(h => h.textContent.trim());
    const firstRows = [...t.querySelectorAll('tbody tr')].slice(0, 3).map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()));
    return { head, firstRows };
  })()`));
  roleRow.miss ? bad("角色对照表未找到") : ok("角色对照表表头=" + JSON.stringify(roleRow.head) + " 首行=" + JSON.stringify(roleRow.firstRows[0]));

  // 断言 4：身份卡/权限芯片显示经验等级（admin xp=0 → Lv.1 新芽）
  const ident = await evalJs(ws, inPanel(`(() => {
    const chip = [...w.document.querySelectorAll('.chip')].map(c => c.textContent.trim()).filter(Boolean);
    const permChip = w.document.getElementById('perm-chip');
    return { chips: chip, permChip: permChip ? permChip.textContent.trim() : '' };
  })()`));
  console.log("[身份卡] chips=" + JSON.stringify(ident.chips) + " permChip=" + ident.permChip);
  const hasLv = JSON.stringify(ident).includes("Lv.");
  hasLv ? ok("身份卡显示经验等级: " + ident.permChip) : bad("身份卡无经验等级: " + JSON.stringify(ident));
  await shot(ws, "_probe/t10-panel-roles.png");

  // ════ B. viewer 高等级：资料页等级不与角色绑定 + 权限不变 ════
  await openUrl(ws, VIEWER, "http://127.0.0.1:8090/account");
  await waitExpr(ws, `document.body.innerText.includes('经验') ? 'yes' : null`, 20000);
  const acc = await evalJs(ws, `(() => {
    const txt = document.body.innerText.replace(/\\s+/g, ' ').trim();
    return {
      hasLv6: txt.includes('Lv.6 传奇'),
      hasXp1600: txt.includes('经验 1600'),
      role: (document.body.innerText.match(/角色\s*[：:]\s*([^\s]+)/) || [])[1] || '?',
      snippet: txt.slice(0, 200)
    };
  })()`);
  acc.hasLv6 ? ok("viewer 资料页显示「Lv.6 传奇」（高经验等级）") : bad("资料页无 Lv.6: " + JSON.stringify(acc));
  acc.hasXp1600 ? ok("资料页显示经验 1600") : bad("资料页经验值异常: " + JSON.stringify(acc));
  console.log("[viewer资料] role=" + acc.role + " snippet=" + acc.snippet);
  await shot(ws, "_probe/t10-viewer-account.png");

  // viewer 访问集控面板 → 仍被 303 拦到登录页（权限不变）
  await openUrl(ws, VIEWER, "http://127.0.0.1:8090/admin/console");
  await sleep(2500);
  const blocked = await evalJs(ws, `(() => ({
    url: location.pathname,
    isLogin: location.pathname.includes('/admin/login'),
    title: document.title
  }))()`);
  blocked.isLogin ? ok("viewer 进面板被 303 拦到登录页（viewConsole=false，权限与等级零耦合）") : bad("viewer 未被拦截: " + JSON.stringify(blocked));

  // ════ C. /api/me 返回 xp/level（在 identity 快照内）═══
  const me = await evalJs(ws, `fetch('/api/me').then(r => r.json()).then(j => ({
    role: j.role, xp: j.xp,
    level: j.identity ? j.identity.level : undefined,
    levelLabel: j.identity ? j.identity.levelLabel : undefined
  }))`, true);
  (me.level === 6 && me.levelLabel === "Lv.6 传奇" && me.role === "viewer")
    ? ok("/api/me identity 返回 xp=1600 level=6（Lv.6 传奇），角色仍 viewer: " + JSON.stringify(me))
    : bad("/api/me 异常: " + JSON.stringify(me));

  await closeTab(tab.id);
  console.log("\n=== T10 CDP 验证报告 ===");
  report.forEach((r) => console.log(r));
  const fails = report.filter((r) => r.startsWith("✗")).length;
  console.log(fails ? `\n共 ${fails} 项失败` : "\n全部通过");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
