// 星集控 · 统一 API 层（对接真实 CIMS 接口）
//
// 接口来源（已在 CIMS-backend 源码中核实）：
//   · management 端口（MGMT）：账户/客户端控制/资源写，Bearer token 认证
//       POST /user/auth
//       GET  /account/list
//       GET  /account/{acct}/client/list            -> uid 数组
//       GET  /account/{acct}/client/{uid}           -> {uid,name,status,...}
//       GET  /account/{acct}/client/{uid}/status
//       POST /account/{acct}/client/{uid}/command/restart
//       POST /account/{acct}/client/{uid}/command/update-data
//       POST /account/{acct}/client/{uid}/command/send-notification   body: NotificationPayload
//       POST /account/{acct}/{type}/write?name=xxx  (type∈ClassPlan|TimeLayout|Subjects|Policy|DefaultSettings|Components|Credentials)
//       GET  /account/{acct}/{type}/list
//   · client 端口（CLIENT）：终端配置拉取
//       GET  /v1/client/{uid}/manifest
//       GET  /v1/client/{type}?name=xxx             -> 资源内容
//   · 扩展网关（EXT，可选）：CIMS 不存储协作/上报数据，可由部署方自建轻量服务
//       /notices  /chat(?room=)  /reports  /bugs  /audit   —— /chat 支持房间隔离（跨班互通）
//
// 设计原则：单一出口、可换后端、请求失败/无后端/演示模式一律降级为演示数据，面板永不白屏。
(function (global) {
  const K_MGMT = "cims_mgmt";
  const K_CLIENT = "cims_client";
  const K_EXT = "cims_ext";
  const K_TOKEN = "cims_token";
  const K_CLASS = "cims_class";
  const K_DEMO = "cims_demo";
  const K_VHUB_HOST = "cims_vhub_host";
  const K_VHUB_KEY = "cims_vhub_key";
  const K_SITE = "cims_site_host";
  const K_NOVNC = "cims_novnc_url";
  const K_TASK_SECRET = "cims_task_secret";

  const state = {
    mgmtHost: localStorage.getItem(K_MGMT) || "",
    clientHost: localStorage.getItem(K_CLIENT) || "",
    extHost: localStorage.getItem(K_EXT) || "",
    token: localStorage.getItem(K_TOKEN) || "",
    accountId: "",
    classId: localStorage.getItem(K_CLASS) || "",
    demo: localStorage.getItem(K_DEMO) === "1",
    voicehubHost: localStorage.getItem(K_VHUB_HOST) || "",
    voicehubKey: localStorage.getItem(K_VHUB_KEY) || "",
    siteHost: localStorage.getItem(K_SITE) || "",
    noVncUrl: localStorage.getItem(K_NOVNC) || "",
    taskSecret: localStorage.getItem(K_TASK_SECRET) || "",
    embedded: false,
    timeout: 8000,
  };

  function setMgmtHost(v) { state.mgmtHost = (v || "").replace(/\/+$/, ""); localStorage.setItem(K_MGMT, state.mgmtHost); }
  function setClientHost(v) { state.clientHost = (v || "").replace(/\/+$/, ""); localStorage.setItem(K_CLIENT, state.clientHost); }
  function setExtHost(v) { state.extHost = (v || "").replace(/\/+$/, ""); localStorage.setItem(K_EXT, state.extHost); }
  function setVoicehubHost(v) { state.voicehubHost = (v || "").replace(/\/+$/, ""); localStorage.setItem(K_VHUB_HOST, state.voicehubHost); }
  function setVoicehubKey(v) { state.voicehubKey = v || ""; localStorage.setItem(K_VHUB_KEY, state.voicehubKey); }
  function setSiteHost(v) { state.siteHost = (v || "").replace(/\/+$/, ""); localStorage.setItem(K_SITE, state.siteHost); }
  function setNoVncUrl(v) { state.noVncUrl = (v || "").replace(/\/+$/, ""); localStorage.setItem(K_NOVNC, state.noVncUrl); }
  function setTaskSecret(v) { state.taskSecret = v || ""; localStorage.setItem(K_TASK_SECRET, state.taskSecret); }
  function setEmbedded(on) { state.embedded = !!on; }
  function setHost(v) { setMgmtHost(v); } // 兼容旧调用：host 视作 management 端口
  function setToken(v) { state.token = v || ""; localStorage.setItem(K_TOKEN, state.token); }
  function setClass(v) { state.classId = v || ""; localStorage.setItem(K_CLASS, state.classId); }
  function setDemo(on) { state.demo = !!on; localStorage.setItem(K_DEMO, state.demo ? "1" : "0"); }
  function clearAuth() { state.token = ""; state.accountId = ""; localStorage.removeItem(K_TOKEN); }
  function acct() { return state.accountId; }

  async function reqTo(host, path, opts = {}) {
    if (!host) throw new Error("未配置后端地址");
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), state.timeout);
    try {
      const res = await fetch(host + path, {
        ...opts,
        signal: ctl.signal,
        headers: {
          "Content-Type": "application/json",
          ...(state.token ? { Authorization: "Bearer " + state.token } : {}),
          ...(opts.headers || {}),
        },
      });
      if (res.status === 401) { clearAuth(); throw new Error("未授权，请重新登录"); }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const txt = await res.text();
      return txt ? JSON.parse(txt) : {};
    } finally { clearTimeout(t); }
  }

  // 走 management 端口；失败或有降级键时回落演示数据
  async function cims(path, opts, demoKey) {
    if (state.demo || !state.mgmtHost) return D[demoKey] ? D[demoKey]() : {};
    try { return await reqTo(state.mgmtHost, path, opts); }
    catch (e) { if (demoKey && D[demoKey]) return D[demoKey](); throw e; }
  }

  // 走 stelarith-website（同源或 siteHost）：协作/上报类数据落地网站，复用其反馈模型
  async function siteFetch(path, opts = {}) {
    const base = state.siteHost ? state.siteHost.replace(/\/+$/, "") : "";
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), state.timeout);
    try {
      const res = await fetch(base + path, {
        ...opts,
        credentials: "include",
        signal: ctl.signal,
        headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const txt = await res.text();
      return txt ? JSON.parse(txt) : {};
    } finally { clearTimeout(t); }
  }
  // 走 client 端口（配置拉取）
  async function cli(path, opts, demoKey) {
    if (state.demo || !state.clientHost) return D[demoKey] ? D[demoKey]() : {};
    try { return await reqTo(state.clientHost, path, opts); }
    catch (e) { if (demoKey && D[demoKey]) return D[demoKey](); throw e; }
  }
  // 走扩展网关（协作/上报）；未配置则演示降级
  async function ext(path, opts, demoKey) {
    if (state.demo || !state.extHost) return D[demoKey] ? D[demoKey]() : {};
    try { return await reqTo(state.extHost, path, opts); }
    catch (e) { if (demoKey && D[demoKey]) return D[demoKey](); throw e; }
  }

  // ---- 校园点歌（voicehub）独立客户端 ----
  // 鉴权：x-api-key 请求头（voicehub 开放 API 要求，与 CIMS Bearer 不同）
  // 契约（已在 voicehub 源码 server/api/open/* 核实）：
  //   GET  /api/open/songs?played=true|false&sortBy=...&sortOrder=...&limit=   -> {success,data:{songs:[...]}}
  //   POST /api/open/songs/request  body:{title,artist,...}                   -> 点歌（需 songs:request 权限）
  async function vhubReq(path, opts = {}) {
    if (!state.voicehubHost) throw new Error("未配置点歌站地址");
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), state.timeout);
    try {
      const res = await fetch(state.voicehubHost + path, {
        ...opts,
        signal: ctl.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": state.voicehubKey || "",
          ...(opts.headers || {}),
        },
      });
      if (res.status === 401) throw new Error("点歌站 API Key 无效或未授权");
      if (!res.ok) throw new Error("点歌站 HTTP " + res.status);
      const txt = await res.text();
      return txt ? JSON.parse(txt) : {};
    } finally { clearTimeout(t); }
  }

  // 取「正在播放」（最近已播一首）与「待播队列」（未播、按提交时间升序）
  async function vhubList() {
    if (state.demo || !state.voicehubHost) return { now: null, queue: D.voicehub() };
    try {
      const [nowR, qR] = await Promise.all([
        vhubReq("/api/open/songs?played=true&sortBy=playedAt&sortOrder=desc&limit=1"),
        vhubReq("/api/open/songs?played=false&sortBy=createdAt&sortOrder=asc&limit=10"),
      ]);
      const nowRaw = nowR?.data?.songs?.[0] || null;
      const now = nowRaw
        ? { id: nowRaw.id, title: nowRaw.title, artist: nowRaw.artist, by: nowRaw.requester, at: nowRaw.playedAtFormatted }
        : null;
      const queue = (qR?.data?.songs || []).map((s) => ({
        id: s.id, title: s.title, artist: s.artist, by: s.requester, votes: s.voteCount, at: s.requestedAt,
      }));
      return { now, queue };
    } catch (e) { return { now: null, queue: D.voicehub(), error: e.message }; }
  }

  async function vhubRequest(title, artist) {
    if (state.demo || !state.voicehubHost) return { success: true, demo: true };
    return vhubReq("/api/open/songs/request", {
      method: "POST",
      body: JSON.stringify({ title, artist }),
    });
  }

  // 把当前播放 + 待播队列写入 CIMS Components/songboard（真实接口，已核实）。
  // 与 ext/voicehub-sync/voicehub-adapter.mjs 写同一资源，由 ClassIsland 点歌看板插件拉取上屏。
  // 契约：POST /account/{acct}/Components/write?name=songboard   (Bearer token)
  async function vhubPush(now, queue) {
    if (state.demo || !state.mgmtHost) return { demo: true };
    let accountId = state.accountId;
    if (!accountId) {
      try {
        const list = await reqTo(state.mgmtHost, "/account/list");
        if (Array.isArray(list) && list.length) accountId = list[0].id || list[0];
      } catch (_) {}
    }
    if (!accountId) return { demo: true };
    return reqTo(state.mgmtHost, `/account/${accountId}/Components/write?name=songboard`, {
      method: "POST",
      body: JSON.stringify({ name: "songboard", now: now || null, queue: queue || [], pushedAt: Date.now() }),
    });
  }

  // ---- 演示数据（无后端或请求失败时兜底，保证面板始终可用/可演示） ----
  const D = {
    classes: () => ([
      { id: "default_classplan", name: "高一(1)班" }, { id: "classplan_702", name: "高一(2)班" },
      { id: "classplan_703", name: "高一(3)班" }, { id: "classplan_801", name: "高二(1)班" },
    ]),
    devices: () => ([
      { id: "uid-d1", name: "前门一体机", online: true, ip: "10.0.7.11", ver: "1.6.2", last: "刚刚" },
      { id: "uid-d2", name: "后墙班牌", online: true, ip: "10.0.7.12", ver: "1.6.2", last: "1 分钟前" },
      { id: "uid-d3", name: "备用投影盒", online: false, ip: "10.0.7.13", ver: "1.5.9", last: "3 小时前" },
    ]),
    schedule: () => ({
      name: state.classId || "default_classplan",
      days: [
        { day: 1, name: "周一", items: ["语文", "数学", "英语", "物理", "体育"] },
        { day: 2, name: "周二", items: ["数学", "语文", "化学", "英语", "自习"] },
        { day: 3, name: "周三", items: ["英语", "物理", "数学", "历史", "体育"] },
        { day: 4, name: "周四", items: ["语文", "化学", "数学", "地理", "自习"] },
        { day: 5, name: "周五", items: ["数学", "英语", "物理", "语文", "班会"] },
      ],
    }),
    config: () => ({
      name: state.classId || "default_components",
      components: ["课表", "倒计时", "天气", "通知"],
      autoHide: { inClass: true, exam: true, projection: true },
      updateChannel: "http://update.example.edu/",
    }),
    plugins: () => ([
      { id: "components_p1", name: "课表增强", ver: "2.1.0", enabled: true },
      { id: "components_p2", name: "天气插件", ver: "1.4.3", enabled: true },
      { id: "components_p3", name: "打铃扩展", ver: "0.9.1", enabled: false },
      { id: "components_p4", name: "值日轮播", ver: "1.0.2", enabled: false },
    ]),
    notices: () => ([
      { id: "n1", title: "期中考试时间调整", scope: "全校", at: "09-05 08:12" },
      { id: "n2", title: "本班周一换课通知", scope: "本班", at: "09-04 17:40" },
    ]),
    chat: () => ([
      { from: "高一(2)班", text: "你们投影闪屏修好了吗？", at: "10:02", mine: false },
      { from: "我", text: "换了 HDMI 线，好了", at: "10:04", mine: true },
      { from: "高二(1)班", text: "求推荐稳定版插件", at: "10:11", mine: false },
    ]),
    reports: () => ([
      { id: "r1", title: "一体机无法开机", level: "高", status: "处理中", at: "09-06 14:20" },
      { id: "r2", title: "班牌时间不同步", level: "低", status: "已解决", at: "09-03 09:15" },
    ]),
    bugs: () => ([
      { id: "b1", title: "课表组件跨天不刷新", status: "已受理", at: "09-05 21:33" },
      { id: "b2", title: "通知弹窗遮挡倒计时", status: "待复现", at: "09-02 11:02" },
    ]),
    audit: () => ([
      { at: "09-06 16:02", who: "我", act: "下发课表配置", target: "高一(1)班" },
      { at: "09-06 15:41", who: "我", act: "重启设备 d2", target: "高一(1)班" },
      { at: "09-05 10:20", who: "管理员", act: "更新组件 打铃扩展", target: "全校" },
    ]),
    voicehub: () => ([
      { id: "s1", song: "孤勇者", by: "高一(3)班 王同学", at: "10:21", status: "播放中" },
      { id: "s2", song: "起风了", by: "高二(1)班 李同学", at: "10:18", status: "排队 1" },
      { id: "s3", song: "晴天", by: "高一(2)班 张同学", at: "10:15", status: "排队 2" },
    ]),
  };

  // 把 CIMS 资源列表响应归一化为 {id,name}
  function normResources(list) {
    if (!Array.isArray(list)) return [];
    return list.map((x) => {
      if (typeof x === "string") return { id: x, name: x };
      const n = x.name || x.id || x.slug || "";
      return { id: n, name: n };
    });
  }

  // ---- stelarith_task 令牌签名（HMAC-SHA256，浏览器原生实现，无依赖）----
  // 与 ext/stelarith-agent 的 verify() 对齐：token = hex(HMAC_SHA256(action + "|" + ts, secret))。
  // 生产环境：secret 为「网站—设备」共享密钥；更高安全用网站私钥 Ed25519 签名（见 sync/sign-task.mjs），
  // 代理侧持网站公钥验签。未配置 secret 时退回时间戳占位（仅联调用，不可用于生产）。
  async function signTask(action, ts) {
    if (!state.taskSecret) return String(Date.now());
    const data = action + "|" + ts;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(state.taskSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  const API = {
    state, setHost, setMgmtHost, setClientHost, setExtHost, setVoicehubHost, setVoicehubKey, setSiteHost, setNoVncUrl, setTaskSecret, setEmbedded, setToken, setClass, setDemo, clearAuth, acct,
    voicehubList, voicehubRequest, voicehubPush,

    // ---- 认证（CIMS 原生）----
    async login(host, email, password) {
      setMgmtHost(host);
      if (!host) { state.demo = true; localStorage.setItem(K_DEMO, "1"); return { token: "demo" }; }
      const r = await reqTo(state.mgmtHost, "/user/auth", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (r.requires_2fa) throw new Error("后端启用了 2FA，当前面板未支持，请用非 2FA 账户或扩展网关处理");
      setToken(r.token || "");
      // 自动选择首个账户作为操作上下文
      try {
        const accts = await reqTo(state.mgmtHost, "/account/list");
        if (Array.isArray(accts) && accts.length) state.accountId = accts[0].id;
      } catch (_) { /* 登录成功但取账户失败，后续真实调用会降级 */ }
      return r;
    },

    // ---- 班级（= 课表资源名）----
    listClasses: async () => {
      const r = await cims(`/account/${acct()}/ClassPlan/list`, {}, "classes");
      return Array.isArray(r) ? normResources(r) : D.classes();
    },

    // ---- 课表（ClassPlan 资源）----
    getSchedule: async (cls) => {
      const name = cls || state.classId || "default_classplan";
      return cli(`/v1/client/ClassPlan?name=${encodeURIComponent(name)}`, {}, "schedule");
    },
    putSchedule: async (cls, payload) => {
      const name = cls || state.classId || "default_classplan";
      return cims(`/account/${acct()}/ClassPlan/write?name=${encodeURIComponent(name)}`,
        { method: "POST", body: JSON.stringify(payload) }, "schedule");
    },

    // ---- ClassIsland 组件配置（Components 资源）----
    getConfig: async (cls) => {
      const name = cls || state.classId || "default_components";
      return cli(`/v1/client/Components?name=${encodeURIComponent(name)}`, {}, "config");
    },
    putConfig: async (cls, payload) => {
      const name = cls || state.classId || "default_components";
      return cims(`/account/${acct()}/Components/write?name=${encodeURIComponent(name)}`,
        { method: "POST", body: JSON.stringify(payload) }, "config");
    },

    // ---- 插件/组件（Components 资源）----
    listPlugins: async () => {
      const r = await cims(`/account/${acct()}/Components/list`, {}, "plugins");
      return Array.isArray(r) ? normResources(r) : D.plugins();
    },
    setPlugin: async (id, enabled) => {
      return cims(`/account/${acct()}/Components/write?name=${encodeURIComponent(id)}`,
        { method: "POST", body: JSON.stringify({ enabled }) }, "plugins");
    },

    // ---- 设备（客户端控制，CIMS 原生）----
    listDevices: async () => {
      if (state.demo || !state.mgmtHost) return D.devices();
      try {
        const uids = await reqTo(state.mgmtHost, `/account/${acct()}/client/list`);
        if (!Array.isArray(uids)) return D.devices();
        const details = await Promise.all(uids.map((uid) =>
          reqTo(state.mgmtHost, `/account/${acct()}/client/${uid}`).catch(() => ({ uid, status: "offline" }))
        ));
        return details.map((d) => ({
          id: d.uid,
          name: d.name || d.uid,
          online: d.status === "online",
          ip: d.mac || "",
          ver: "",
          last: d.registered_at || "",
        }));
      } catch (e) { return D.devices(); }
    },
    deviceAction: async (id, action) => {
      if (state.demo || !state.mgmtHost) return { status: "success", message: "（演示）指令已模拟下发" };
      const ep = { restart: "restart", sync: "update-data", notify: "send-notification" }[action];
      if (!ep) return { status: "success", message: "（演示）该动作无后端对应，已模拟" };
      const body = action === "notify"
        ? JSON.stringify({ MessageContent: "来自集控面板的提醒" })
        : undefined;
      return reqTo(state.mgmtHost, `/account/${acct()}/client/${id}/command/${ep}`,
        { method: "POST", body });
    },

    // ---- 远程屏幕控制（经 CIMS 通知下发 stelarith_task，触发设备侧代理按需启 VNC）----
    // 真实：POST /account/{acct}/client/{uid}/command/send-notification
    //   NotificationPayload.MessageContent = JSON({ stelarith_task:{action,token,scope,ts} })
    // token 由 signTask() 用共享密钥 HMAC 签名（未配密钥则时间戳占位）；代理侧验签后启 VNC，
    // 并把 {ip,port,token} 回报到扩展网关 /vnc-session（见 ext/stelarith-ext-gateway）。面板用
    // deviceRemoteStatus(uid) 轮询该回执，拿到后内嵌 noVNC。
    deviceRemoteStart: async (uid, scope) => {
      if (state.demo || !state.mgmtHost) return { status: "demo", message: "（演示）已模拟请求远程控制" };
      const ts = Math.floor(Date.now() / 1000);
      const token = await signTask("remote_control_start", ts);
      const task = { action: "remote_control_start", token, scope: scope || "class", ts };
      const body = JSON.stringify({ MessageContent: JSON.stringify({ stelarith_task: task }) });
      return reqTo(state.mgmtHost, `/account/${acct()}/client/${uid}/command/send-notification`, { method: "POST", body });
    },
    deviceRemoteStop: async (uid, scope) => {
      if (state.demo || !state.mgmtHost) return { status: "demo", message: "（演示）已模拟结束会话" };
      const ts = Math.floor(Date.now() / 1000);
      const token = await signTask("remote_control_stop", ts);
      const task = { action: "remote_control_stop", token, scope: scope || "class", ts };
      const body = JSON.stringify({ MessageContent: JSON.stringify({ stelarith_task: task }) });
      const out = await reqTo(state.mgmtHost, `/account/${acct()}/client/${uid}/command/send-notification`, { method: "POST", body });
      // 控制结束：顺手清掉扩展网关里的 VNC 会话回执
      try { await ext(`/vnc-session?uid=${encodeURIComponent(uid)}`, { method: "DELETE" }); } catch (_) {}
      return out;
    },
    // 轮询扩展网关，取设备最新 VNC 会话回执：{ip, port, token} 或 null
    deviceRemoteStatus: async (uid) => {
      try {
        const r = await ext(`/vnc-session?uid=${encodeURIComponent(uid)}`);
        return r && r.session ? r.session : null;
      } catch (_) { return null; }
    },

    // ---- 通知广播 ----
    // 真实：向所有在线设备下发桌面通知（CIMS send-notification）
    // 历史列表：CIMS 不存储，走扩展网关，未配置则演示
    listNotices: () => ext("/notices", {}, "notices"),
    sendNotice: async (title, scope) => {
      if (state.demo || !state.mgmtHost) {
        const list = D.notices(); list.unshift({ id: "n" + Date.now(), title, scope: scope || "本班", at: "刚刚" });
        return { status: "success", sent: 1 };
      }
      const uids = await reqTo(state.mgmtHost, `/account/${acct()}/client/list`);
      let sent = 0;
      if (Array.isArray(uids)) {
        for (const uid of uids) {
          try {
            await reqTo(state.mgmtHost, `/account/${acct()}/client/${uid}/command/send-notification`,
              { method: "POST", body: JSON.stringify({ MessageContent: title }) });
            sent++;
          } catch (_) { /* 单台失败忽略 */ }
        }
      }
      // 可选：写入扩展网关留痕
      try { await ext("/notices", { method: "POST", body: JSON.stringify({ title, scope }) }); } catch (_) {}
      return { status: "success", sent };
    },

    // ---- 班级交流（扩展网关，支持房间/班级隔离，跨班互通）----
    // room 缺省 "techrep-global"（全校电教委员群）；各班级用自身 classId 作房间。
    listChat: (room) => ext("/chat?room=" + encodeURIComponent(room || "techrep-global"), {}, "chat"),
    sendChat: async (text, from, room) => ext("/chat", {
      method: "POST",
      body: JSON.stringify({ text, from: from || (state.classId || "电教委员"), room: room || "techrep-global" }),
    }, "chat"),
    CHAT_ROOM_GLOBAL: "techrep-global",

    // ---- 故障上报 / Bug（实名站：stelarith-website /api/feedback，复用反馈模型）----
    // 嵌入网站（/admin/console）或配置了 siteHost 时走网站；否则演示降级 / 扩展网关。
    async listReports() {
      if (state.demo) return D.reports();
      if (!state.embedded && !state.siteHost) return ext("/reports", {}, "reports");
      try {
        const items = await siteFetch("/api/feedback");
        return (Array.isArray(items) ? items : []).filter((x) => (x.labels || []).includes("report"))
          .map((x) => ({ id: x.id, title: x.title, level: (x.labels || []).find((l) => ["高", "中", "低"].includes(l)) || "-", status: x.status || "待处理", at: x.createdAt || "" }));
      } catch (_) { return D.reports(); }
    },
    async submitReport(r) {
      if (state.demo) return { ok: true, demo: true };
      if (!state.embedded && !state.siteHost) return ext("/reports", { method: "POST", body: JSON.stringify(r) }, "reports");
      return siteFetch("/api/feedback", { method: "POST", body: JSON.stringify({ title: r.title, content: r.desc || "", labels: ["report", r.level].filter(Boolean) }) });
    },
    async listBugs() {
      if (state.demo) return D.bugs();
      if (!state.embedded && !state.siteHost) return ext("/bugs", {}, "bugs");
      try {
        const items = await siteFetch("/api/feedback");
        return (Array.isArray(items) ? items : []).filter((x) => (x.labels || []).includes("bug"))
          .map((x) => ({ id: x.id, title: x.title, status: x.status || "待受理", at: x.createdAt || "" }));
      } catch (_) { return D.bugs(); }
    },
    async submitBug(b) {
      if (state.demo) return { ok: true, demo: true };
      if (!state.embedded && !state.siteHost) return ext("/bugs", { method: "POST", body: JSON.stringify(b) }, "bugs");
      const content = ["复现步骤：", b.steps || "", "日志：", b.log || ""].join("\n");
      return siteFetch("/api/feedback", { method: "POST", body: JSON.stringify({ title: b.title, content, labels: ["bug"] }) });
    },

    // ---- 审计（扩展网关）----
    listAudit: () => ext("/audit", {}, "audit"),
  };

  global.API = API;
})(window);
