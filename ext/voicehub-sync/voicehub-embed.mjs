// 校园点歌 · 即插即用嵌入模块（浏览器 ESM，零依赖）
//
// 定位：把「集控面板内嵌点歌模块」做成一个可独立分发的浏览器模块，供集控面板 / stelarith-website
//       任意页面 `import` 后直接使用，无需重复实现。与 admin-console/src/api.js 的 voicehubXxx
//       契约完全一致（同一组真实端点），可视为面板实现的「权威参考版」。
//
// 真实契约（已在 voicehub 源码 server/api/open/* 核实）：
//   GET  /api/open/songs?played=true&sortBy=playedAt&sortOrder=desc&limit=1  -> 当前播放
//   GET  /api/open/songs?played=false&sortBy=createdAt&sortOrder=asc&limit=N -> 待播队列
//   POST /api/open/songs/request   body:{title,artist}                       -> 点歌（需 songs:request 权限）
// 推上屏（写 CIMS Components/songboard，已核实）：
//   POST /account/{acct}/Components/write?name=songboard   (Bearer token)
//
// 用法：
//   import { VoicehubEmbed } from "./voicehub-embed.mjs";
//   const vh = new VoicehubEmbed({ host: "https://voicehub.245959623.xyz", apiKey: "vhub_...",
//                                  mgmt: "https://cims.example.edu:9000", token: "CIMS_BEARER", accountId: "acc_1" });
//   vh.render(document.getElementById("songboard"));   // 自动渲染迷你 UI（拉队列/点歌/推上屏）
//   const { now, queue } = await vh.list();            // 或自行取数据自定义 UI

export class VoicehubEmbed {
  constructor(cfg = {}) {
    this.host = (cfg.host || "").replace(/\/+$/, "");
    this.apiKey = cfg.apiKey || "";
    this.mgmt = (cfg.mgmt || "").replace(/\/+$/, "");
    this.token = cfg.token || "";
    this.accountId = cfg.accountId || "";
    this.demo = !!cfg.demo;
    this.onError = cfg.onError || ((m) => console.warn("[voicehub-embed]", m));
  }

  _demoQueue() {
    return [
      { id: "s1", title: "孤勇者", artist: "", by: "高一(3)班 王同学", votes: 12, at: "10:21" },
      { id: "s2", title: "起风了", artist: "", by: "高二(1)班 李同学", votes: 8, at: "10:18" },
      { id: "s3", title: "晴天", artist: "", by: "高一(2)班 张同学", votes: 5, at: "10:15" },
    ];
  }

  async list() {
    if (this.demo || !this.host) return { now: null, queue: this._demoQueue() };
    try {
      const [nowR, qR] = await Promise.all([
        fetch(this.host + "/api/open/songs?played=true&sortBy=playedAt&sortOrder=desc&limit=1", {
          headers: { "x-api-key": this.apiKey, "Content-Type": "application/json" },
        }),
        fetch(this.host + "/api/open/songs?played=false&sortBy=createdAt&sortOrder=asc&limit=10", {
          headers: { "x-api-key": this.apiKey, "Content-Type": "application/json" },
        }),
      ]);
      if (!nowR.ok || !qR.ok) throw new Error("点歌站 HTTP " + nowR.status);
      const nowRaw = (await nowR.json())?.data?.songs?.[0] || null;
      const now = nowRaw
        ? { id: nowRaw.id, title: nowRaw.title, artist: nowRaw.artist, by: nowRaw.requester, at: nowRaw.playedAtFormatted }
        : null;
      const queue = ((await qR.json())?.data?.songs || []).map((s) => ({
        id: s.id, title: s.title, artist: s.artist, by: s.requester, votes: s.voteCount, at: s.requestedAt,
      }));
      return { now, queue };
    } catch (e) {
      this.onError(e.message);
      return { now: null, queue: this._demoQueue(), error: e.message };
    }
  }

  async request(title, artist) {
    if (this.demo || !this.host) return { success: true, demo: true };
    const r = await fetch(this.host + "/api/open/songs/request", {
      method: "POST",
      headers: { "x-api-key": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ title, artist }),
    });
    if (!r.ok) throw new Error("点歌站 HTTP " + r.status);
    return r.json();
  }

  // 把当前播放 + 待播队列写入 CIMS Components/songboard（真实接口，已核实）。
  // 与 admin-console/src/api.js 的 vhubPush 写同一资源，由 ClassIsland 点歌看板插件拉取上屏。
  async pushToScreen(now, queue) {
    if (this.demo || !this.mgmt) return { demo: true };
    let accountId = this.accountId;
    if (!accountId) {
      const list = await fetch(this.mgmt + "/account/list", {
        headers: { Authorization: "Bearer " + this.token },
      });
      if (!list.ok) throw new Error("CIMS HTTP " + list.status);
      const arr = await list.json();
      if (Array.isArray(arr) && arr.length) accountId = arr[0].id || arr[0];
    }
    if (!accountId) return { demo: true };
    const r = await fetch(`${this.mgmt}/account/${accountId}/Components/write?name=songboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + this.token },
      body: JSON.stringify({ name: "songboard", now: now || null, queue: queue || [], pushedAt: Date.now() }),
    });
    if (!r.ok) throw new Error("CIMS HTTP " + r.status);
    return r.json();
  }

  // 生成可嵌入迷你 UI：当前播放 + 队列 + 点歌表单 + 推上屏按钮（零依赖，事件委托真实方法）
  render(container, opts = {}) {
    if (typeof document === "undefined") throw new Error("render() 仅浏览器环境可用");
    container.innerHTML = `
      <div class="vh-embed">
        <div class="vh-now" data-role="now"><span class="muted">（暂无播放）</span></div>
        <table class="vh-queue"><thead><tr><th>歌曲</th><th>点歌人</th><th>票数</th></tr></thead>
          <tbody data-role="queue"></tbody></table>
        <div class="vh-form">
          <input data-role="title" placeholder="歌曲名" />
          <input data-role="artist" placeholder="歌手（可选）" />
          <button data-role="request">提交点歌</button>
          <button data-role="push">推送到本班屏幕</button>
          <button data-role="refresh">刷新</button>
        </div>
      </div>`;
    const qBody = container.querySelector('[data-role="queue"]');
    const nowEl = container.querySelector('[data-role="now"]');
    const tEl = container.querySelector('[data-role="title"]');
    const aEl = container.querySelector('[data-role="artist"]');

    const refresh = async () => {
      const { now, queue } = await this.list();
      nowEl.innerHTML = now
        ? `正在播放：<b>${esc(now.title)}</b> ${now.artist ? "— " + esc(now.artist) : ""}（${esc(now.by || "")}）`
        : '<span class="muted">（暂无播放）</span>';
      qBody.innerHTML = (queue || [])
        .map((s) => `<tr><td>${esc(s.title)}</td><td>${esc(s.by || "")}</td><td>${s.votes ?? 0}</td></tr>`)
        .join("");
    };
    container.querySelector('[data-role="refresh"]').addEventListener("click", refresh);
    container.querySelector('[data-role="request"]').addEventListener("click", async () => {
      try {
        await this.request(tEl.value.trim(), aEl.value.trim());
        toast("点歌已提交");
        await refresh();
      } catch (e) { this.onError(e.message); }
    });
    container.querySelector('[data-role="push"]').addEventListener("click", async () => {
      try {
        const { now, queue } = await this.list();
        const r = await this.pushToScreen(now, queue);
        toast(r && r.demo ? "演示：已模拟推送" : "已推送到本班屏幕（CIMS songboard）");
      } catch (e) { this.onError(e.message); }
    });
    refresh();
  }
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function toast(m) {
  if (typeof window !== "undefined" && typeof window.toast === "function") window.toast(m);
  else console.log("[voicehub-embed]", m);
}

export default VoicehubEmbed;
