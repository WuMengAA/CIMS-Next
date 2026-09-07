// 学校多媒体统一集控 · 管理面板前端
// 纯静态 vanilla JS，对接 CIMS Management API（经 nginx /mgmt/ 反代，同源避免 CORS）
// 端点依据 CIMS-backend/app/api/management/* 探查结果（登录 /user/auth、账户 /account/* 等）

const API_BASE = "/mgmt"; // nginx 反代到 CIMS management 端口
let TOKEN = localStorage.getItem("cims_token") || "";

function authHeader() {
  return { "Content-Type": "application/json", Authorization: TOKEN };
}

async function api(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    ...opts,
    headers: { ...authHeader(), ...(opts.headers || {}) },
  });
  if (res.status === 401) {
    doLogout();
    throw new Error("未授权，请重新登录");
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // 部分端点返回空体
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function doLogin() {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const msg = document.getElementById("login-msg");
  msg.textContent = "登录中…";
  try {
    const data = await api("/user/auth", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (data.requires_2fa) {
      msg.textContent = "需要 2FA，当前原型未实现，请用支持 2FA 的客户端或临时关闭。";
      return;
    }
    TOKEN = data.token;
    localStorage.setItem("cims_token", TOKEN);
    enterApp();
  } catch (e) {
    msg.textContent = "登录失败：" + e.message;
  }
}

function doLogout() {
  TOKEN = "";
  localStorage.removeItem("cims_token");
  document.getElementById("app").classList.add("hidden");
  document.getElementById("login").classList.remove("hidden");
}

function enterApp() {
  document.getElementById("login").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  switchTab("accounts");
}

function switchTab(tab) {
  document.querySelectorAll(".tabs button").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === tab)
  );
  if (tab === "accounts") loadAccounts();
  else if (tab === "invitations") loadInvitations();
  else if (tab === "pairings") loadPairings();
  else if (tab === "clients") loadClients();
}

function table(headers, rows) {
  const h = headers.map((x) => `<th>${x}</th>`).join("");
  const b = rows
    .map(
      (r) =>
        `<tr>${r.map((c) => `<td>${c == null ? "" : c}</td>`).join("")}</tr>`
    )
    .join("");
  return `<table><thead><tr>${h}</tr></thead><tbody>${b}</tbody></table>`;
}

async function loadAccounts() {
  const el = document.getElementById("content");
  el.innerHTML = `<p class="muted">加载账户列表…</p>`;
  try {
    const list = await api("/account/list");
    const rows = (list || []).map((a) => [
      a.slug,
      a.name,
      a.id,
      `<span class="tag">${a.is_active ? "启用" : "禁用"}</span>`,
    ]);
    el.innerHTML =
      `<div class="card"><b>学校/校区账户</b><p class="muted">对应 CIMS 多租户账户，每个学校/校区一个。</p></div>` +
      table(["标识", "名称", "ID", "状态"], rows);
  } catch (e) {
    el.innerHTML = `<p class="muted">加载失败：${e.message}</p>`;
  }
}

async function loadInvitations() {
  const el = document.getElementById("content");
  el.innerHTML = `<p class="muted">加载邀请列表…</p>`;
  try {
    const list = await api("/account/invitation/list");
    const rows = (list || []).map((i) => [i.id, i.email || i.account, i.status || ""]);
    el.innerHTML =
      `<div class="card"><b>邀请</b><p class="muted">向教师/管理员发送集控账户邀请。</p></div>` +
      table(["ID", "对象", "状态"], rows);
  } catch (e) {
    el.innerHTML = `<p class="muted">加载失败：${e.message}</p>`;
  }
}

async function loadPairings() {
  const el = document.getElementById("content");
  el.innerHTML = `<p class="muted">加载配对列表…</p>`;
  try {
    const list = await api("/account/pairing/list");
    const rows = (list || []).map((p) => [p.id, p.code || "", p.status || ""]);
    el.innerHTML =
      `<div class="card"><b>设备配对</b><p class="muted">客户端设备与账户的配对码管理。</p></div>` +
      table(["ID", "配对码", "状态"], rows);
  } catch (e) {
    el.innerHTML = `<p class="muted">加载失败：${e.message}</p>`;
  }
}

async function loadClients() {
  const el = document.getElementById("content");
  el.innerHTML = `
    <div class="card">
      <b>客户端（设备）管理</b>
      <p class="muted">客户端实时状态/重启/通知当前走 <b>gRPC command</b>（CIMS 未暴露对应 HTTP 端点）。
      本面板展示组织层（账户/分组）；实时控制请见 <code>GRPC_COMMAND_PROXY.md</code> 的对接方案，
      或等待 bidi 流在 grpcio 修复/降级后启用。</p>
      <p>客户端连接数、在线状态可通过 Management 的账户级客户端接口（如 <code>/account/{id}/client</code>）扩展获取。</p>
    </div>`;
}

// 启动：若已有 token 直接进
if (TOKEN) enterApp();
