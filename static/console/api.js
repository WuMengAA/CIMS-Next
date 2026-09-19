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
  /**
   * 持久化设置项的统一声明（单一事实源）。
   *
   * 每项声明 key 名、状态默认值与“是否去除尾斜杠”，state 与 getter/setter
   * 全部由此表驱动 —— 消除原先 12 组「const K_x + state.x + setXxx + localStorage]
   * 五行样板」的重复，也让「该字段要不要 trim 尾斜杠」的策略集中到一处可查。
   * 语义不需要持久化的运行时项（embedded/offline/lastError/timeout）保持独立 state。
   */
  const FIELDS = {
    mgmtHost: { pkey: "cims_mgmt", trimSlash: 1 },
    clientHost: { pkey: "cims_client", trimSlash: 1 },
    extHost: { pkey: "cims_ext", trimSlash: 1 },
    siteHost: { pkey: "cims_site_host", trimSlash: 1 },
    // noVncUrl 是 URL 而非 host，但过去也统一 trimSlash；保留行为以避免跨版本差异。
    noVncUrl: { pkey: "cims_novnc_url", trimSlash: 1 },
    voicehubHost: { pkey: "cims_vhub_host", trimSlash: 1 },
    voicehubKey: { pkey: "cims_vhub_key", trimSlash: 0 },
    taskSecret: { pkey: "cims_task_secret", trimSlash: 0 },
    token: { pkey: "cims_token", trimSlash: 0 },
    accountId: { pkey: "cims_account_id", trimSlash: 0 },
    classId: { pkey: "cims_class", trimSlash: 0 },
    demo: { pkey: "cims_demo", trimSlash: 0, bool: 1 },
  };

  // 由 FIELDS 表生成 state 初始值；运行时项在下方显式补上。
  const state = {};
  for (const key in FIELDS) {
    const f = FIELDS[key];
    const raw = localStorage.getItem(f.pkey) || "";
    state[key] = f.bool ? raw === "1" : raw;
  }
  // 运行时（非持久化）状态
  state.offline = false;
  state.lastError = "";
  state.embedded = false;
  state.timeout = 8000;

  /**
   * 按字段名写值并持久化；bool 项转 "1"/"0"，trimSlash 项去尾斜杠。
   * 所有持久化 setter 的公共实现 —— 调用处仍可用 setMgmtHost(v) 等具名函数
   * （各自定义为薄别名，见下），本函数只在类型与归一化逻辑变化时改一处。
   */
  function setField(key, v) {
    const f = FIELDS[key];
    if (!f) return;
    if (f.bool) { state[key] = !!v; localStorage.setItem(f.pkey, state[key] ? "1" : "0"); return; }
    const next = f.trimSlash ? String(v || "").replace(/\/+$/, "") : String(v || "");
    state[key] = next;
    localStorage.setItem(f.pkey, next);
  }

  // ---- 持久化 setter：由 setField 派生的薄别名，保持既有成员名与调用处兼容 ----
  function setMgmtHost(v) { setField("mgmtHost", v); }
  function setClientHost(v) { setField("clientHost", v); }
  function setExtHost(v) { setField("extHost", v); }
  function setVoicehubHost(v) { setField("voicehubHost", v); }
  function setVoicehubKey(v) { setField("voicehubKey", v); }
  function setSiteHost(v) { setField("siteHost", v); }
  function setNoVncUrl(v) { setField("noVncUrl", v); }   // 语义是“noVNC 页面地址（URL）”
  function setTaskSecret(v) { setField("taskSecret", v); }
  function setToken(v) { setField("token", v); }
  function setAccountId(v) { setField("accountId", v); }
  function setClass(v) { setField("classId", v); }
  function setDemo(on) {
    setField("demo", on);
    // 切回真实模式时清掉离线标记，否则横幅会赖着不走。
    if (!state.demo) { state.offline = false; state.lastError = ""; }
  }
  // 兼容旧调用：裸 host 视作 management 端口。名称保留以不破坏既有调用；
  // 新代码请直接用 setMgmtHost，从名字即可分辨目标端点，避免 “setHost” 该指哪个端点的模糊。
  function setHost(v) { setMgmtHost(v); }
  function setEmbedded(on) { state.embedded = !!on; }
  function clearAuth() {
    state.token = ""; state.accountId = "";
    localStorage.removeItem(FIELDS.token.pkey); localStorage.removeItem(FIELDS.accountId.pkey);
  }
  function acct() { return state.accountId; }

  /**
   * 是否「用户主动要演示数据」。
   *
   * 与 canUseBackend() 严格分开 —— 这两个概念被混用正是「假设备混进真机列表」的根因：
   *   canUseBackend() = 现在能不能发真实请求（能力判断）
   *   wantDemo()      = 用户有没有主动选择看演示数据（意愿判断）
   * 后端不可用只说明「拿不到真数据」，绝不意味着「可以拿假数据顶上」。
   * 在集控场景里，运维照着演示设备去下发指令 = 对着不存在的机器操作，
   * 所以这里的原则是：**宁可显示「未连接后端」，也不静默造假**。
   */
  function wantDemo() { return state.demo === true; }

  /** 标记后端不可用（非演示模式下）。UI 据此显示红色横幅。 */
  function markOffline(msg) {
    if (state.demo) return; // 演示模式下不存在"离线"这个概念
    if (!state.offline) { state.offline = true; state.lastError = msg || ""; }
    else if (msg && !state.lastError) state.lastError = msg;
  }
  function markOnline() { state.offline = false; state.lastError = ""; }

  // 是否具备「真实账户上下文」：非演示模式 + 配了 mgmt 后端 + 已选定账户。
  // 三者缺一，/account//... 就是畸形路径（后端 404、控制台持续刷错误）。
  // 统一判定为「没有真实后端可用」，让各调用方走既有演示/空数据分支，
  // 而不是把畸形请求发出去。
  function canUseBackend() { return !state.demo && !!state.mgmtHost && !!state.accountId; }

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

  // 走 management 端口。
  //
  // 降级规则（2026-09-19 重写，原实现有 fail-silent 缺陷）：
  //   ① 用户**主动**开了演示模式 → 给演示数据（这是他要的，且 UI 有角标）。
  //   ② 拿不到真实数据（没配后端 / 没账户 / 请求失败）→ 给**空**并置 offline 标记，
  //      由 UI 显示红色横幅。**不再**静默回落到演示数据。
  //
  // 为什么不能有"请求失败就给演示数据"：后端挂掉时，面板会照样显示一屏设备，
  // 运维对着这些**不存在的机器**下发指令、改课表、远程控制 —— 失败被伪装成成功。
  // 集控面板的可信度全靠"看不见就是真没有"，这条一旦破，整个面板都不能信。
  async function cims(path, opts, demoKey) {
    if (wantDemo()) return D[demoKey] ? D[demoKey]() : {};
    if (!canUseBackend()) {
      // 区分「没配地址」（真配置问题）与「地址在但账户归属空」——后者几乎总是
      // CIMS 此刻不可达导致 accountId 没解析出来（getCimsAccount 返回 null），
      // 提示"请重新登录"会误导用户去折腾账号，实际是 CIMS 服务暂时连不上。
      markOffline(
        state.mgmtHost
          ? `后端 ${state.mgmtHost} 已配置但账户归属为空 —— 后端此刻可能不可达，请稍后刷新重试`
          : "未连接后端：缺少后端地址。留空可自动使用本站同源代理；或到设置页填写后端地址后重新登录"
      );
      return {};
    }
    try {
      const r = await reqTo(state.mgmtHost, path, opts);
      markOnline();
      return r;
    } catch (e) {
      markOffline((e && e.message) ? e.message : String(e));
      return {};
    }
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
  // 走站点侧协作接口（通知历史 / 班级交流 / 操作日志）。
  // 注意：只有在「完全没配后端」（纯演示模式）时才返回内置演示数据；
  // 一旦配了 extHost，请求失败就如实抛错，绝不静默回退假数据——
  // 否则权限不足/服务异常会伪装成「有数据」，是最难排查的一类问题。
  async function ext(path, opts, demoKey) {
    if (state.demo || !state.extHost) return D[demoKey] ? D[demoKey]() : {};
    return reqTo(state.extHost, path, opts);
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
        if (Array.isArray(list) && list.length) { accountId = list[0].id || list[0]; setAccountId(accountId); }
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

  // ---- 协作数据归一化（站点后端返回 createdAt 等原始字段，这里转成面板展示形态）----
  // 对内嵌真实后端：请求失败一律返回空数组，**不再回退演示数据**——
  // 之前失败时静默显示假数据，让人误以为「后端通了」，反而更难排查。
  function fmtTime(v) {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function normNotices(r) {
    if (!Array.isArray(r)) return [];
    return r.map((n) => ({
      id: n.id,
      title: n.title != null ? n.title : "",
      scope: n.scope != null ? n.scope : "",
      author: n.author || "",
      // 目标班级（服务端存逗号串或数组，这里统一成数组），用于「历史通知分班级」展示
      classes: Array.isArray(n.classes)
        ? n.classes
        : String(n.classes || "").split(",").map((s) => s.trim()).filter(Boolean),
      // 来源通道：notice / chat / announcement —— 让同一条内容走过多条通道时一眼可辨
      channel: n.channel || "",
      sent: Number.isFinite(n.sent) ? n.sent : (n.sent != null ? Number(n.sent) || 0 : 0),
      at: n.at || fmtTime(n.createdAt),
    }));
  }
  function normChat(r, me) {
    if (!Array.isArray(r)) return [];
    return r.map((m) => ({
      id: m.id,
      from: m.from != null ? m.from : (m.sender || ""),
      text: m.text != null ? m.text : (m.body || ""),
      room: m.room || "",
      at: m.at || fmtTime(m.createdAt),
      mine: (m.from != null ? m.from : m.sender) === me,
    }));
  }
  // 审计动作的中文名（操作日志页展示用）。
  //
  // 命名以 2026-09-17 从**真实库**（content/stelarith.db → console_audit）取到的分布为准，
  // 不靠猜：当初按猜测写 `notice.publish`，实际服务端记的是 `broadcast_notice`。
  //
  // ⚠️ 未登记的 action **一律原样显示原始 key**，不要显示"未知动作"或空白 ——
  // 面板版本总会落后于后端/插件新增的动作，此时宁可让人看到 `xxx.yyy`，
  // 也胜过把一整条记录变成看不懂的废纸（与 MODULE_CATALOG 同一条原则）。
  // 原始 key 同时保留在 title 悬浮提示里，排查时不受这层翻译影响。
  const AUDIT_ACTION_LABELS = {
    "schedule.push": "下发课表",
    "plugin.toggle": "启停插件组件",
    "device.restart": "重启设备",
    "device.refresh": "刷新设备",
    "device.lock": "设备锁屏",
    "device.screenshot": "设备截屏",
    "classisland.switch_class": "远程切班",
    "classisland.module": "调整功能模块",
    "classisland.sync_now": "立即同步资源",
    "classisland.refresh_profile": "刷新宿主档案",
    "classisland.show_message": "弹出最近广播",
    "classisland.lock": "锁屏",
    "classisland.screenshot": "截图",
    "classisland.restart": "重启 ClassIsland",
    "classisland.restart_island": "宿主进程重启",
    "remote.start": "发起远程控制",
    notice: "通知仅留痕（未推送）",
    friend_request: "发起好友申请",
    friend_accept: "接受好友",
    friend_reject: "拒绝好友",
    friend_remove: "删除好友",
  };

  // `broadcast_<source>` 中 source 的显示名 —— 服务端广播内部把来源拼进动作名
  // （见 src/lib/server/broadcast.ts），故这里用展开 source 的写法而非穷举，
  // 以后服务端新增一个来源，界面上也不会突然露出英文 key。
  const AUDIT_BROADCAST_SOURCES = {
    notice: "面板通知",
    chat: "群内喊话",
    announcement: "网站公告",
    manual: "手动下发",
  };

  function auditActionLabel(raw) {
    if (!raw) return "";
    if (AUDIT_ACTION_LABELS[raw]) return AUDIT_ACTION_LABELS[raw];
    if (raw.indexOf("broadcast_") === 0) {
      const src = raw.slice("broadcast_".length);
      return "广播至教室大屏（" + (AUDIT_BROADCAST_SOURCES[src] || src || "未标注来源") + "）";
    }
    return raw;
  }

  function normAudit(r) {
    if (!Array.isArray(r)) return [];
    return r.map((a) => {
      const raw = a.act != null ? a.act : (a.action || "");
      return {
        id: a.id,
        at: a.at || fmtTime(a.createdAt),
        who: a.who != null ? a.who : (a.actor || ""),
        act: auditActionLabel(raw),
        rawAct: raw,
        target: a.target || "",
        detail: a.detail || "",
      };
    });
  }

  // 把 CIMS 资源列表响应归一化为 {id,name}
  function normResources(list) {
    if (!Array.isArray(list)) return [];
    return list.map((x) => {
      if (typeof x === "string") return { id: x, name: x };
      const n = x.name || x.id || x.slug || "";
      return { id: n, name: n };
    });
  }

  // ---- 星璃功能模块目录（面板展示用） ----
  //
  // 与插件端 `StelarithModules.All` 一一对应（id 必须完全一致 —— 三处共用同一套字符串：
  // 插件 C#、本文件、面板渲染）。这里冗余一份 label/描述 是因为心跳上报为了省带宽
  // 只发 `{moduleId: bool}`，不含文案；若面板依赖插件发文案，插件旧版本就会渲染出空白。
  // 未知 id 一律按「未登记模块」展示，不隐藏 —— 新插件加了模块但面板没更新时，
  // 用户仍能看到并操控它，而不是"开关神秘消失"。
  const MODULE_CATALOG = [
    { id: "heartbeat", label: "状态心跳上报", core: true, desc: "定期上报在线状态、插件清单与模块开关。关闭后面板将看不到这台设备。" },
    { id: "command_poll", label: "集控指令通道", core: true, desc: "轮询并执行集控下发的指令（锁屏/截图/切班/广播）。关闭后本机将失去远程控制能力。" },
    { id: "sync", label: "资源主动同步", core: false, desc: "定时从集控拉取课表 / 作息 / 科目 / 组件配置。" },
    { id: "writeback", label: "写回 ClassIsland 档案", core: false, desc: "把同步到的资源写入本机档案，使大屏真正显示新配置。" },
    { id: "notification", label: "集控播报", core: false, desc: "把集控广播落到 ClassIsland 官方提醒系统，在大屏播放遮罩播报。" },
    { id: "os_actions", label: "本机动作（锁屏 / 截图）", core: false, desc: "允许集控对这台机器执行锁屏与截屏。" },
    { id: "remote_control", label: "远程控制转发", core: false, desc: "允许集控经本地代理发起远程控制（VNC）会话。" },
    { id: "class_switch", label: "远程切班", core: false, desc: "允许集控把本班大屏切到指定课表群。考试/重要活动期间可临时关闭。" },
    { id: "camera_capture", label: "摄像头抓拍与录像", core: false, desc: "允许集控抓取本机摄像头画面（抓拍/短录像）。关闭后摄像头类指令一律拒绝。" },
    { id: "media_p2p", label: "P2P 媒体直连", core: false, desc: "允许本机作为点对点端点被直连观看（高带宽画面走设备之间，不经服务器）。" },
    { id: "message_feed", label: "岛内消息中心", core: false, desc: "在 ClassIsland 设置页 / 托盘里查看本机最近的广播与通知。" },
  ];
  const MODULE_BY_ID = MODULE_CATALOG.reduce((m, x) => (m[x.id] = x, m), {});

  /** 秒 → 人话（心跳间隔通常是几十秒，粒度到"刚刚/分钟"即可）。 */
  function ago(sec) {
    if (sec == null || isNaN(sec)) return "从未上报";
    if (sec < 60) return "刚刚";
    if (sec < 3600) return Math.floor(sec / 60) + " 分钟前";
    if (sec < 86400) return Math.floor(sec / 3600) + " 小时前";
    return Math.floor(sec / 86400) + " 天前";
  }

  /**
   * `/class/device-status` 的一条 → 面板统一设备结构。
   *
   * 关键语义：
   *   · `reported=false` 与 `online=false` 是**两件事** ——
   *     前者="从未接上集控"，后者="接上过但现在掉线"。混为一谈会让
   *     "端点配错"和"教室断电"看起来一样，排查时没有方向。
   *   · `ver` 为空时显示 "—" 而不是空字符串：空表格单元格看起来像渲染失败。
   */
  function normDevice(d) {
    const online = !!d.online;
    const reported = !!d.reported;
    return {
      id: d.client_id,
      name: d.host || d.client_id,
      host: d.host || "",
      online,
      reported,
      ageSec: typeof d.age_seconds === "number" ? d.age_seconds : null,
      // last 是**真实心跳**推导出的相对时间，不再是"注册时间"冒充
      last: reported ? ago(d.age_seconds) : "从未上报",
      reportedAt: d.reported_at || "",
      ip: d.ip || "",
      ver: d.version || "—",
      classId: d.class_id || "",
      className: d.class_name || "",
      activeGroup: d.active_class_group || "",
      modules: d.modules && typeof d.modules === "object" ? d.modules : {},
      plugins: Array.isArray(d.plugins) ? d.plugins : [],
      extra: d.extra && typeof d.extra === "object" ? d.extra : {},
      // 状态文案三分：未接入 / 在线 / 离线
      stateLabel: !reported ? "尚未接入" : online ? "在线" : "离线",
      stateKind: !reported ? "warn" : online ? "ok" : "err",
    };
  }

  /** 演示设备补齐新字段（无后端时面板结构仍完整，不报 undefined）。 */
  function demoDevice(d) {
    return Object.assign({
      host: d.name, reported: true, ageSec: 12, reportedAt: "", classId: "", className: "",
      activeGroup: "", modules: {}, plugins: [], extra: {}, stateLabel: d.online ? "在线" : "离线",
      stateKind: d.online ? "ok" : "err",
    }, d, { online: !!d.online });
  }

  /** 模块快照（{id:bool}）→ 有序数组，带上目录里的文案；未知 id 也保留。 */
  function normModules(snap) {
    const map = snap && typeof snap === "object" ? snap : {};
    const known = MODULE_CATALOG.map((m) => Object.assign({}, m, { enabled: !!map[m.id] }));
    const extra = Object.keys(map)
      .filter((k) => !MODULE_BY_ID[k])
      .map((k) => ({ id: k, label: k + "（未登记）", core: false, desc: "插件上报了本面板不认识的模块。", enabled: !!map[k] }));
    return known.concat(extra);
  }


  //
  // 为什么必须有这一层：CIMS 下发的 ClassPlan 是**官方「Profile 信封」**——
  //   { Name, ClassPlans:{<planGuid>:{TimeRule:{WeekDay},Classes:[{SubjectId,...}]}},
  //     ClassPlanGroups:{...} }
  // 而面板视图（dashboard/schedule）读的是 `sched.days[0].items`。
  // 两者结构完全不同：直接透传时 `sched.days` 为 undefined，
  // `sched.days[0]` 立刻抛
  //   TypeError: Cannot read properties of undefined (reading '0')
  // 症状是「总览/操作日志整页显示『加载失败』」——因为 dashboard 与 audit
  // 同属一次 go() 渲染链，dashboard 先炸就把 view 整块替换成错误卡。
  //
  // 关键映射：
  //   · 一个 ClassPlan = 一天（信封里 6 个 plan 对应周一~周六）；
  //     天序取 `TimeRule.WeekDay`（0=周日 … 6=周六），不能靠对象键顺序。
  //   · `Classes[].SubjectId` 是 GUID，必须用 Subjects 资源
  //     （{Subjects:{<guid>:{Name}}}) 反查成「语文/数学」这类可读名。
  //     查不到就退回短 GUID，绝不显示空白。
  //   · 科目表取不到不应让整页失败 —— 降级为「显示 GUID」，课表仍可用。
  const WEEK_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  /** 把官方 Subjects 信封压成 {guid: 名称} 映射；任何异常都退化为空表。 */
  function subjectNameMap(subEnvelope) {
    const map = {};
    const s = subEnvelope && subEnvelope.Subjects;
    if (s && typeof s === "object") {
      for (const [guid, v] of Object.entries(s)) {
        const nm = v && (v.Name || v.name);
        if (guid && nm) map[guid] = String(nm);
      }
    }
    return map;
  }

  /**
   * 官方 Profile 信封 → 面板课表形态。
   * @param {any} env  ClassPlan 资源（可能是官方信封，也可能已是面板形态）
   * @param {any} subEnv Subjects 资源（官方信封），可为空
   */
  function normSchedule(env, subEnv) {
    // 已经是面板形态（含 days 数组）→ 原样返回，兼容演示数据与旧契约
    if (env && Array.isArray(env.days)) return env;
    const nameMap = subjectNameMap(subEnv);
    const plans = (env && env.ClassPlans) || {};
    const entries = Object.entries(plans);
    if (!entries.length) {
      // 合法空信封（例如未绑定班级的 default_classplan）：给空周，而不是让调用方炸
      return { name: (env && env.Name) || "", days: [] };
    }
    const days = entries.map(([guid, cp]) => {
      const rule = (cp && cp.TimeRule) || {};
      // WeekDay: 0=周日 … 6=周六；缺字段时退化为 0，排序后仍在
      const wd = Number.isFinite(rule.WeekDay) ? rule.WeekDay : 0;
      const items = ((cp && cp.Classes) || [])
        .filter((c) => c && c.IsEnabled !== false)
        .map((c) => {
          const sid = c.SubjectId || c.subjectId || "";
          return nameMap[sid] || (sid ? String(sid).slice(0, 8) : "");
        })
        .filter((x) => x);
      return {
        day: wd,
        // 优先用课表自带的 Name（学校数据里就是「周一」「周二」这类权威标签），
        // 缺失时才用 WeekDay 折算；两者都不依赖对象键顺序。
        name: (cp && cp.Name) || WEEK_NAMES[wd] || `第${wd}天`,
        items,
        planId: guid,
        planName: (cp && cp.Name) || "",
      };
    });
    // 按周序排序，保证「今日课表」取到的是周一而非对象键里的随机一个
    days.sort((a, b) => a.day - b.day);
    // `__raw` / `__subjectIds` 是为**回写**准备的（见 denormSchedule）：
    // 面板形态只有科目中文名，而 CIMS 要的是 SubjectId GUID + 完整 TimeRule/Classes 结构，
    // 没有原始信封就重建不出来。这两个字段不参与渲染，仅随面板对象一起流转。
    const subjectIds = {};
    for (const [guid, nm] of Object.entries(nameMap)) subjectIds[nm] = guid;
    return {
      name: (env && env.Name) || (env && env.name) || "",
      days,
      __raw: env || null,
      __subjectIds: subjectIds,
    };
  }

  /**
   * 面板课表形态 → 官方 Profile 信封（**回写方向的归一化**）。
   *
   * 为什么必须有这一半：课表读取曾经因为「面板形态 vs 官方信封」不匹配而整页崩，
   * 修复时只补了读取方向；**写入方向**当时是把面板对象原样 POST 回去 ——
   * 于是保存的课表里没有 `Classes[].SubjectId`，客户端反序列化后就是空课表，
   * 表现为「面板显示保存成功，但教室端什么都没变」。两个方向必须成对修。
   *
   * 做法：以原始信封为骨架（保留 TimeRule/TimeLayoutId/类群等我们没编辑的字段），
   * 只按顺序把每个格的科目**名**换回 SubjectId GUID。拿不到 raw 时退化重建最小信封。
   *
   * @returns {{ envelope: any, dropped: string[] }} dropped = 无法识别成科目的格子文本
   */
  function denormSchedule(panel) {
    const days = (panel && panel.days) || [];
    const subjectIds = (panel && panel.__subjectIds) || {};
    const raw = panel && panel.__raw;
    const dropped = [];

    // 没有原始信封（演示数据/空课表）→ 重建一个符合官方形状的最小信封
    const envelope = raw && raw.ClassPlans
      ? JSON.parse(JSON.stringify(raw))
      : {
          Name: (panel && panel.name) || "",
          ClassPlans: {},
          ClassPlanGroups: (raw && raw.ClassPlanGroups) || {},
        };

    for (const d of days) {
      const planId = d.planId || `day-${d.day}`;
      const exist = envelope.ClassPlans[planId] || {};
      // 原始 Classes 按索引对齐，用来继承 IsEnabled 等我们没编辑的字段
      const rawClasses = Array.isArray(exist.Classes) ? exist.Classes : [];

      const classes = [];
      (d.items || []).forEach((txt, i) => {
        const label = String(txt == null ? "" : txt).trim();
        const prev = rawClasses[i] || {};
        if (!label) {
          // 空格子 → 保留一个「禁用」占位记录，而不是直接跳过。
          // 直接跳过会让后面的节次整体前移（第 3 节变成第 2 节），
          // 课表的节次位置是有意义的，不能因为某个格子没填就塌缩。
          classes.push({ SubjectId: "", IsEnabled: false });
          return;
        }
        let sid = subjectIds[label];
        if (!sid) {
          // 兜底：原格子本身就是 GUID（后端没给 Subjects 时 normSchedule 会退化成短 GUID）
          const base = prev.SubjectId || prev.subjectId;
          if (base && String(base).startsWith(label)) sid = base;
        }
        if (!sid) {
          dropped.push(`${d.name || d.day} 第${i + 1}节「${label}」`);
          classes.push({ SubjectId: "", IsEnabled: false });
          return;
        }
        classes.push({
          SubjectId: sid,
          IsEnabled: prev.IsEnabled !== false,
          ...(prev.AttachedObjects ? { AttachedObjects: prev.AttachedObjects } : {}),
        });
      });

      const wd = Number.isFinite(d.day) ? d.day : 0;
      envelope.ClassPlans[planId] = {
        ...exist,
        Name: exist.Name || d.name || WEEK_NAMES[wd] || `第${wd}天`,
        TimeLayoutId: exist.TimeLayoutId || (raw && raw.__timeLayoutId) || "",
        TimeRule: exist.TimeRule || {
          WeekDay: wd,
          WeekCountDiv: 0,
          WeekCountDivTotal: 2,
          IsActive: true,
        },
        Classes: classes,
      };
      // 已存在的计划保留其类群关联；不覆盖 AssociatedGroup
    }
    return { envelope, dropped };
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

  // ---- 设备侧动作的统一下发口（摄像头 / 媒体 / 系统动作都走它）----
  //
  // 三个必须收敛在一处的理由：
  //   ① 签名与打包形态只有一种：token=HMAC(action|ts)，载荷走 MessageContent.stelarith_task；
  //   ② **回执不回流**：本地代理的返回值不会出现在这个调用的返回里（它只写设备日志
  //      与失败通知）。所以调用方必须"下发后轮询结果"，而不是"等返回值"——写在一处
  //      才不会有人误会成 await 完就拿到了结果；
  //   ③ 失败判定必须读回执体（远端用 HTTP 200 表达业务失败），只读状态码会把
  //      「被拒绝」与「已下发」变成同一个样子。
  //
  // 参数分层（这一层极易踩）：代理从**任务顶层**读 camera / kind / name，
  // 而码率、缩放、段长、画质这些数值旋钮统一读 `params` 对象。
  // 放错层的表现是「指令成功、参数被忽略」——静默且难查。
  const TASK_TOP_LEVEL_KEYS = { camera: 1, kind: 1, name: 1 };
  async function sendDeviceTask(uid, action, scope, extra) {
    if (!uid) return { ok: false, status: "error", message: "未选择设备" };
    if (wantDemo()) return { ok: true, status: "demo", message: "（演示）已模拟下发 " + action };
    if (!canUseBackend()) return { ok: false, status: "error", message: "未连接后端，指令未下发" };
    const ts = Math.floor(Date.now() / 1000);
    const token = await signTask(action, ts);
    const task = { action, token, scope: scope || "class", ts };
    const inner = {};
    const ex = extra || {};
    for (const k of Object.keys(ex)) {
      const v = ex[k];
      if (v === undefined || v === null || v === "") continue;
      if (TASK_TOP_LEVEL_KEYS[k]) task[k] = v;
      else inner[k] = v;
    }
    if (Object.keys(inner).length) task.params = inner;
    const body = JSON.stringify({ MessageContent: JSON.stringify({ stelarith_task: task }) });
    const r = await reqTo(
      state.mgmtHost,
      "/account/" + acct() + "/client/" + uid + "/command/send-notification",
      { method: "POST", body }
    );
    return { ...(r || {}), ok: !(r && r.status === "error"), reason: (r && r.message) || "" };
  }

  const API = {
    state, setHost, setMgmtHost, setClientHost, setExtHost, setVoicehubHost, setVoicehubKey, setSiteHost, setNoVncUrl, setTaskSecret, setEmbedded, setToken, setAccountId, setClass, setDemo, clearAuth, acct, canUseBackend, wantDemo, markOffline, markOnline,
    // 展示层辅助（面板渲染设备状态/模块开关直接用，避免在 app.js 里各写一套格式化）
    normModules, ago, MODULE_CATALOG,
    // 对外名 voicehub* ← 内部实现 vhub*（app.js 用 API.voicehubList / voicehubRequest / voicehubPush）。
    // 曾经写成 `voicehubList, voicehubRequest, voicehubPush,` 的简写属性：这几个标识符并不存在，
    // 对象字面量一求值就抛 ReferenceError，导致 global.API 从未赋值、整个面板 API 层全废。
    voicehubList: vhubList, voicehubRequest: vhubRequest, voicehubPush: vhubPush,

    // ---- 认证（CIMS 原生）----
    async login(host, email, password) {
      setMgmtHost(host);
      if (!host) { setField("demo", true); return { token: "demo" }; }
      const r = await reqTo(state.mgmtHost, "/user/auth", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (r.requires_2fa) throw new Error("后端启用了 2FA，当前面板未支持，请用非 2FA 账户或扩展网关处理");
      setToken(r.token || "");
      // 自动选择首个账户作为操作上下文，并**持久化**——否则刷新后 accountId 归零，
      // canUseBackend() 变 false，整条真实链路降级成"未连接后端"（正是本次 500 报错的诱因之一）。
      try {
        const accts = await reqTo(state.mgmtHost, "/account/list");
        if (Array.isArray(accts) && accts.length) setAccountId(accts[0].id);
      } catch (_) { /* 登录成功但取账户失败，后续真实调用会降级 */ }
      return r;
    },

    // ---- 班级（= 课表资源名）----
    listClasses: async () => {
      const r = await cims(`/account/${acct()}/ClassPlan/list`, {}, "classes");
      return Array.isArray(r) ? normResources(r) : D.classes();
    },

    // ---- 课表（ClassPlan 资源）----
    // 必须经 normSchedule：CIMS 下发的是官方 Profile 信封（无 days 字段），
    // 直接透传会让 dashboard/schedule 在读 sched.days[0] 时抛
    // 「Cannot read properties of undefined (reading '0')」。
    // 科目表（Subjects）单独取一次用于把 SubjectId 翻成人话；取失败不影响课表可用。
    getSchedule: async (cls) => {
      const name = cls || state.classId || "default_classplan";
      const env = await cli(`/v1/client/ClassPlan?name=${encodeURIComponent(name)}`, {}, "schedule");
      // 演示模式 / 未配后端：cli 已回退演示数据（本身即面板形态），直接返回
      if (state.demo || !state.clientHost) return env;
      let subEnv = null;
      try {
        subEnv = await cli(`/v1/client/Subjects?name=sub_school`, {}, null);
      } catch (_) { /* 科目表缺失：退化为显示短 GUID，不阻断课表 */ }
      return normSchedule(env, subEnv);
    },
    putSchedule: async (cls, panelOrEnvelope) => {
      const name = cls || state.classId || "default_classplan";
      // 回写方向归一化：面板形态必须转回官方信封（Classes[].SubjectId），
      // 否则客户端读到的是一张空课表 —— 而面板会显示「保存成功」，最难查的一类问题。
      let payload = panelOrEnvelope;
      let dropped = [];
      if (panelOrEnvelope && Array.isArray(panelOrEnvelope.days)) {
        const r = denormSchedule(panelOrEnvelope);
        payload = r.envelope;
        dropped = r.dropped;
      }
      const out = await cims(`/account/${acct()}/ClassPlan/write?name=${encodeURIComponent(name)}`,
        { method: "POST", body: JSON.stringify(payload) }, "schedule");
      // 把「没能落地的格子」一并回给调用方，由 UI 明确提示，而不是静默丢弃
      return { ...(out && typeof out === "object" ? out : { result: out }), dropped };
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
    //
    // 【设备状态真实显示】数据源是 `/class/device-status`（CIMS management）：
    // 它把「管理端指派的班级」与「设备自己上报的心跳遥测」合到一处 ——
    //   online/reported/age_seconds ← client_status.reported_at 与 90s 新鲜度阈值
    //   host/ip/version            ← 设备上报的机器名、来源 IP、插件版本
    //   modules/plugins/extra      ← 星璃模块开关、ClassIsland 插件清单、同步遥测
    //
    // 为什么不再走 `/account/{acct}/client/list` + 逐台 `/{uid}`：
    //   那条老路只返回「配置侧」信息（mac/registered_at），**没有任何在线信号** ——
    //   面板只能拿"注册时间"冒充"最后心跳"，设备关了一个月照样显示在线。
    //   逐台串行请求在几十台设备的学校里还会打满超时。
    //   新接口一次拿全部，且 online 是真实心跳推导出来的。
    deviceStatus: async () => {
      if (wantDemo()) return { fresh: 90, devices: D.devices().map(demoDevice) };
      if (!canUseBackend()) {
        // 宁可空列表 + 红色横幅，也不要把演示设备混进真机列表。
        markOffline(
          state.mgmtHost
            ? "后端地址已配置但账户归属为空 —— CIMS 服务此刻可能不可达，请稍后刷新重试"
            : "未连接后端：缺少后端地址，请检查配置"
        );
        return { fresh: 0, devices: [] };
      }
      try {
        const r = await reqTo(state.mgmtHost, "/class/device-status");
        const list = Array.isArray(r && r.devices) ? r.devices : [];
        markOnline();
        return {
          fresh: Number((r && r.fresh_seconds) || 90) || 90,
          devices: list.map(normDevice),
        };
      } catch (e) {
        // 原实现在这里回落演示设备（仅挂 error:true，UI 并不读它），
        // 结果「后端挂了」和「一切正常」在界面上长得一样 —— 假设备混进真机列表。
        markOffline((e && e.message) ? e.message : "设备状态请求失败");
        return { fresh: 0, devices: [], error: true };
      }
    },
    /** 兼容旧调用方：只要设备数组。 */
    listDevices: async () => (await API.deviceStatus()).devices,
    /**
     * 下发「星璃功能模块」开关。
     *
     * 通道：命令队列（stelarith_task: set_module）。之所以不走 CIMS 原生端点 ——
     * CIMS 不认识"星璃模块"这个概念，它只会转发 NotificationPayload；
     * 插件的命令轮询器解析 stelarith_task 后调用 StelarithModules.Set()，
     * 于是面板上的开关**真的**会改本机行为（此前"插件管理"读写的是 Components
     * 资源，与真实插件启停毫无关系，开关是假的）。
     */
    setModule: async (uid, module, enabled) => {
      if (wantDemo()) return { status: "demo", message: "（演示）模块开关已记录" };
      if (!canUseBackend()) return { status: "error", message: "未连接后端，模块开关未下发" };
      const ts = Math.floor(Date.now() / 1000);
      const token = await signTask("set_module", ts);
      const task = { action: "set_module", module, enabled: !!enabled, token, scope: "device", ts };
      const body = JSON.stringify({ MessageContent: JSON.stringify({ stelarith_task: task }) });
      return reqTo(state.mgmtHost, `/account/${acct()}/client/${uid}/command/send-notification`,
        { method: "POST", body });
    },
    /**
     * 一次性下发多个模块开关（面板"恢复默认/批量"用）。
     * 同样的命令通道，载荷换成 {modules:{...}}；插件端 ApplyFromCommand 两种都吃。
     */
    setModules: async (uid, modules) => {
      if (wantDemo()) return { status: "demo", message: "（演示）模块开关已记录" };
      if (!canUseBackend()) return { status: "error", message: "未连接后端，模块开关未下发" };
      const ts = Math.floor(Date.now() / 1000);
      const token = await signTask("set_modules", ts);
      const task = { action: "set_module", modules, token, scope: "device", ts };
      const body = JSON.stringify({ MessageContent: JSON.stringify({ stelarith_task: task }) });
      return reqTo(state.mgmtHost, `/account/${acct()}/client/${uid}/command/send-notification`,
        { method: "POST", body });
    },
    /**
     * ClassIsland 快捷入口（专页用）。
     *
     * 全部经**同一条命令通道**下发 stelarith_task，由教室端插件执行：
     *   restart_island → 宿主进程优雅重启（插件侧调 AppBase.Restart）
     *   sync_now       → 立即拉一次集控资源（不等下一个同步周期）
     *   push_notice    → 在本机大屏弹一条提醒
     *   set_active_class → 切班（复用 P 键 payload：group_id / group_name）
     */
    classislandAction: async (uid, action, payload) => {
      if (wantDemo()) return { status: "demo", message: "（演示）已模拟执行 " + action };
    if (!canUseBackend()) return { status: "error", message: "未连接后端，指令未执行" };
      const ts = Math.floor(Date.now() / 1000);
      const token = await signTask(action, ts);
      const task = Object.assign({ action, token, scope: "device", ts }, payload || {});
      const body = JSON.stringify({ MessageContent: JSON.stringify({ stelarith_task: task }) });
      return reqTo(state.mgmtHost, `/account/${acct()}/client/${uid}/command/send-notification`,
        { method: "POST", body });
    },
    /**
     * 单机状态回读：面板用它做「指令下发后核对」（切班/模块开关是否真的生效）。
     * 走 client 端口的 `/v1/client/{uid}/status`（代理会自动补租户 Host 头），
     * 它额外返回 `self_reported_class_id`，可与管理端指派值交叉校验。
     */
    deviceStatusOne: async (uid) => {
      if (wantDemo()) return demoDevice(D.devices().find((d) => d.id === uid) || D.devices()[0]);
      if (!canUseBackend()) { markOffline("未连接后端：无设备状态"); return null; }
      try { return await cims(`/v1/client/${encodeURIComponent(uid)}/status`, {}, null); }
      catch (_) { return null; }
    },
    deviceAction: async (id, action) => {
      if (wantDemo()) return { status: "demo", message: "（演示）指令已模拟下发" };
    // 曾经这里无条件返回 status:"success" —— 后端不可达时运维也会看到「下发成功」。
    // 指令类操作绝不能假成功：宁可明确报错，也不要让人以为设备收到了。
    if (!canUseBackend()) return { status: "error", message: "未连接后端，指令未下发" };
      // ① CIMS 原生指令端点（HTTP→gRPC，由设备侧 CIMS 客户端执行）
      //    refresh 是面板「刷新」按钮的动作名，对应 CIMS 的 update-data（拉取最新资源）。
      const ep = { restart: "restart", refresh: "update-data", sync: "update-data", notify: "send-notification" }[action];
      if (ep) {
        const body = action === "notify"
          ? JSON.stringify({ MessageContent: "来自集控面板的提醒" })
          : undefined;
        return reqTo(state.mgmtHost, `/account/${acct()}/client/${id}/command/${ep}`,
          { method: "POST", body });
      }
      // ② 锁屏 / 截图：CIMS 无原生端点，经 send-notification 下发 stelarith_task，
      //    由班级端 ClassIsland 插件解析后执行本地动作（与远程控制同一链路）。
      if (action === "lock" || action === "screenshot") {
        const ts = Math.floor(Date.now() / 1000);
        const token = await signTask(action, ts);
        const task = { action, token, scope: "device", ts };
        const body = JSON.stringify({ MessageContent: JSON.stringify({ stelarith_task: task }) });
        return reqTo(state.mgmtHost, `/account/${acct()}/client/${id}/command/send-notification`,
          { method: "POST", body });
      }
      return { status: "error", message: `不支持的动作：${action}` };
    },

    // ---- 远程屏幕控制（经 CIMS 通知下发 stelarith_task，触发设备侧代理按需启 VNC）----
    // 真实：POST /account/{acct}/client/{uid}/command/send-notification
    //   NotificationPayload.MessageContent = JSON({ stelarith_task:{action,token,scope,ts} })
    // token 由 signTask() 用共享密钥 HMAC 签名（未配密钥则时间戳占位）；代理侧验签后启 VNC，
    // 并把 {ip,port,token} 回报到扩展网关 /vnc-session（见 ext/stelarith-ext-gateway）。面板用
    // deviceRemoteStatus(uid) 轮询该回执，拿到后内嵌 noVNC。
    deviceRemoteStart: async (uid, scope) => {
      if (wantDemo()) return { status: "demo", message: "（演示）已模拟请求远程控制" };
    if (!canUseBackend()) return { status: "error", message: "未连接后端，未发起远程控制" };
      const ts = Math.floor(Date.now() / 1000);
      const token = await signTask("remote_control_start", ts);
      const task = { action: "remote_control_start", token, scope: scope || "class", ts };
      const body = JSON.stringify({ MessageContent: JSON.stringify({ stelarith_task: task }) });
      const r = await reqTo(state.mgmtHost, `/account/${acct()}/client/${uid}/command/send-notification`, { method: "POST", body });
      // 铁律：远端会用 HTTP 200 表达业务失败（如「gRPC 通道未开启」）→ **必须读回执体**，
      // 否则「被拒绝」与「已下发」在面板上长得一模一样，这类问题最难查。
      return { ...(r || {}), ok: !(r && r.status === "error"), reason: (r && r.message) || "" };
    },
    deviceRemoteStop: async (uid, scope) => {
      if (wantDemo()) return { status: "demo", message: "（演示）已模拟结束会话" };
    if (!canUseBackend()) return { status: "error", message: "未连接后端，未结束会话" };
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
    /**
     * VNC 自查：把「为什么没画面」拆成**可判定的几条**，逐条给结论。
     *
     * 为什么需要：VNC 断在链路的哪一环，外观上长得一模一样 —— 都是「等 30 秒没画面」。
     * 运维只能靠猜。这里对每一环做一次只读探测，把「哪一环没通」直接摊开：
     *   扩展网关地址 / noVNC 页面 / 任务签名密钥 / 设备心跳 / 网关 /vnc-session 可达性。
     * 全部只读，不改状态、不抛异常（探测失败本身就是一条结论）。
     */
    vncDiagnose: async (uid) => {
      const items = [];
      // ① 扩展网关地址：内嵌网站会自动注入 /api/console/ext；独立打开需手配。
      const extHost = state.extHost || state.siteHost;
      items.push({
        ok: !!extHost,
        label: "扩展网关地址",
        detail: extHost || "未配置 → 无法收取设备会话回执（内嵌网站应自动注入 /api/console/ext）",
      });
      // ② noVNC 页面地址
      items.push({
        ok: !!state.noVncUrl,
        label: "noVNC 页面地址",
        detail: state.noVncUrl || "未配置 → 即便拿到会话也无法显示画面（「设置」页可填）",
      });
      // ③ 任务签名密钥（代理侧验签）
      items.push({
        ok: !!state.taskSecret,
        label: "任务签名密钥",
        detail: state.taskSecret
          ? "已配置（下发 remote_control_start 时带 HMAC 签名）"
          : "未配置 → 代理启用验签时会拒绝执行（当前仅时间戳占位）",
      });
      // ④ 设备心跳（离线设备根本收不到指令）
      try {
        const st = await reqTo(state.mgmtHost, "/class/device-status");
        const d = (Array.isArray(st && st.devices) ? st.devices : []).find((x) => x.id === uid);
        items.push({
          ok: !!(d && d.online),
          label: "设备心跳",
          detail: d
            ? `${d.last || "无记录"} · ${d.online ? "在线（可接收指令）" : "离线 → 指令会写队列但设备不会取走"}` +
              (d.app ? ` · ${d.app}` : "")
            : "该设备不在本账户设备列表（可能未上报心跳 / 未绑班）",
        });
      } catch (e) {
        items.push({ ok: false, label: "设备心跳", detail: "查询失败：" + ((e && e.message) || e) });
      }
      // ⑤ 扩展网关可达性 + 是否已有回执
      try {
        const r = await ext(`/vnc-session?uid=${encodeURIComponent(uid)}`);
        items.push({
          ok: true,
          label: "扩展网关可达",
          detail: r && r.session
            ? `已有会话回执 ${r.session.ip || "?"}:${r.session.port || "?"}`
            : "可达，但该设备尚无会话回执（本地代理未启动 VNC，或未把回执回报到网关）",
        });
      } catch (e) {
        items.push({ ok: false, label: "扩展网关可达", detail: "请求失败：" + ((e && e.message) || e) });
      }
      // ⑥ 教室端前提（本地知识，非探测所得，但正是最常被忽略的一环）
      items.push({
        ok: null,
        label: "教室端前提（需人工确认）",
        detail:
          "VNC 必须有**桌面会话**才有意义：本地代理若以服务方式跑在会话 0（无桌面），" +
          "即便启动成功也看不到画面。请确认代理随「用户登录后的交互式会话」启动。",
      });
      return items;
    },

    // ---- 面板配置（服务端持久化：控制 / 媒体 / 实验特性）----
    // 为什么在服务端：这些值决定**教室端行为**（走不走 P2P、压缩目标、录像保留），
    // 必须全校一致。localStorage 是每台电脑一份，运维在 A 机改了 B 机不生效。
    getSettings: async () => {
      try {
        const r = await ext("/settings");
        return (r && r.settings) || {};
      } catch (_) { return {}; }
    },
    saveSettings: async (patch) => {
      // 写失败必须抛：配置没存进去而界面显示"已保存"，是最容易误导运维的一种假成功。
      const r = await ext("/settings", { method: "POST", body: JSON.stringify(patch || {}) }, "settings");
      // 超时是「本机面板行为」，服务端存的是给别人的默认值 —— 本会话立即生效才有意义。
      const t = Number(patch && patch.dev_request_timeout_ms);
      if (Number.isFinite(t) && t >= 2000) state.timeout = t;
      return (r && r.settings) || {};
    },

    // ---- 开发者选项：原始请求控制台 ----
    // 刻意**不**复用 reqTo：reqTo 在 !ok 时抛异常，而开发者恰恰需要看到 4xx/5xx 的
    // **原始响应体**才能定位（「错误响应被上层吞掉」正是最难查的那类问题）。
    // 这里只有网络层失败才算异常，HTTP 状态码一律原样返回。
    rawRequest: async (host, method, path, bodyText) => {
      const t0 = performance.now();
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), Math.max(state.timeout || 8000, 5000));
      try {
        if (!host) throw new Error("未指定主机");
        const headers = { "Content-Type": "application/json" };
        if (state.token) headers.Authorization = "Bearer " + state.token;
        const m = (method || "GET").toUpperCase();
        const res = await fetch(host + path, {
          method: m,
          headers,
          body: m === "GET" || m === "HEAD" ? undefined : (bodyText || ""),
          signal: ctl.signal,
        });
        const text = await res.text();
        return {
          ok: res.ok, status: res.status, ms: Math.round(performance.now() - t0),
          body: text, ctype: res.headers.get("content-type") || "",
        };
      } catch (e) {
        return {
          ok: false, status: 0, ms: Math.round(performance.now() - t0),
          body: String((e && e.message) || e), networkError: true, ctype: "",
        };
      } finally { clearTimeout(timer); }
    },

    // ---- 通知广播 ----
    // 下发通知
    // ── 为什么改成「首选服务端通道」──────────────────────────────────────────
    // 旧实现是面板自己遍历 `/client/list` 逐台 `send-notification`，然后另发一次
    // 留痕请求。问题有三：① 绕过权限校验（前端能推就是能推）；② 无法按班级定向
    // （只会全量）；③ 留痕与推送分离，两条通道各写一次 → 历史里重复、设备端重复弹。
    // 现在统一 POST /api/console/ext/notices，由服务端做「鉴权 → 范围校验 →
    // 定向解析 → 去重 → 下发 → 留痕 → 审计」一条龙。面板只管发一次。
    // 只有「独立打开面板且未配站点后端」时才退化为直连 CIMS 的旧路径。
    listNotices: async (classId) =>
      normNotices(await ext("/notices" + (classId ? "?class=" + encodeURIComponent(classId) : ""), {}, "notices")),
    sendNotice: async (title, scope, classes, content, seconds) => {
      const body = {
        title,
        scope: scope || "本班",
        content: content || "",
        classes: Array.isArray(classes) ? classes : [],
      };
      // 显示时长（秒）：留空 = 不指定，由教室端按正文字数自适应；显式填了就照用。
      // CIMS 侧 NotificationPayload.DurationSeconds 本就存在（0~3600），一路透传即可。
      const sec = Number(seconds);
      if (Number.isFinite(sec) && sec > 0) body.duration_seconds = sec;
      // ① 内嵌网站 / 配了站点后端：走服务端（推荐路径，含定向与去重）
      if (state.embedded || state.siteHost) {
        return ext("/notices", { method: "POST", body: JSON.stringify(body) }, "notices");
      }
      // ② 纯演示：本地造一条（仅当用户**主动**开了演示模式）
      if (wantDemo()) {
        const list = D.notices();
        list.unshift({ id: "n" + Date.now(), title, scope: body.scope, at: "刚刚" });
        return { status: "success", sent: 1 };
      }
      // 后端不可用时不能假称已发送 —— 通知类操作一旦假成功，
      // 运维会以为广播已经上过大屏。
      if (!canUseBackend()) return { status: "error", message: "未连接后端，通知未下发" };
      // ③ 独立打开 + 直连 CIMS：退化为直接下发（无站点侧留痕，仅开发调试用）
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
      return { status: "success", sent };
    },

    // ---- 班级实体与「设备 ↔ 班级」映射（一班一号的权威视图）----
    // 走站点代理到 CIMS management `/class/*`（代理已放行 /class/ 前缀的读操作）。
    // 面板用它：① 通知页多选目标班级；② 设备页显示每台设备的所属班级。
    listClassEntities: async () => {
      try {
        const r = await cims("/class/list", {}, null);
        return Array.isArray(r) ? r : [];
      } catch (_) { return []; }
    },
    deviceClassMap: async () => {
      try {
        const r = await cims("/class/device-map", {}, null);
        return r && typeof r === "object" ? r : { devices: {}, classes: [] };
      } catch (_) { return { devices: {}, classes: [] }; }
    },

    // ---- 设备 ↔ 班级 绑定（一键指派下拉的真实落点）----
    // 端点：POST /class/device/assign?class_id=&client_id=（CIMS management，Bearer 鉴权）。
    // 后端保证「一班一号」：已属别的班时返回 409（需 force 才转移），不静默抢占。
    // 未配后端（纯演示）时本地模拟，不报错。
    assignDevice: async (clientId, classId) => {
      if (wantDemo()) return { status: "demo", message: "（演示）已模拟绑定到 " + classId };
    if (!canUseBackend()) return { status: "error", message: "未连接后端，未绑定班级" };
      return cims(
        `/class/device/assign?class_id=${encodeURIComponent(classId)}&client_id=${encodeURIComponent(clientId)}`,
        { method: "POST", body: "{}" },
        null
      );
    },

    // ---- 定时广播（P2）----
    // 后端管理端 8097 /scheduled-broadcast/* ；后台调度器到点触发 command_queue 广播。
    listScheduled: async () => {
      if (state.demo) return { status: "demo", items: [] };
      return cims("/scheduled-broadcast/list", {}, null);
    },
    createScheduled: async (body) => cims("/scheduled-broadcast/create", { method: "POST", body: JSON.stringify(body) }, null),
    updateScheduled: async (id, body) => cims(`/scheduled-broadcast/${id}`, { method: "PUT", body: JSON.stringify(body) }, null),
    toggleScheduled: async (id, enabled) => cims(`/scheduled-broadcast/${id}/toggle`, { method: "POST", body: JSON.stringify({ enabled }) }, null),
    fireScheduled: async (id) => cims(`/scheduled-broadcast/${id}/fire-now`, { method: "POST", body: "{}" }, null),
    deleteScheduled: async (id) => cims(`/scheduled-broadcast/${id}`, { method: "DELETE" }, null),

    // ---- 班级交流（站点侧 SQLite，支持房间/班级隔离，跨班互通）----
    // room 约定：
    //   "techrep-global"      全校电教委员群
    //   "<classId>"           某班房间（如 class_03）
    //   "grade:高一" / "grade:高二"  年级电教委员群（同年级跨班互助）
    // 正文含 @全体 / @all 时，服务端会自动把这条升级为教室大屏广播（见
    // src/routes/api/console/ext/[...path]/+server.ts 的 chat 分支）——
    // 即「不要把重要消息只留在群里」，喊一句就上屏幕，不必再切页手工重发。
    listChat: async (room) => normChat(await ext("/chat?room=" + encodeURIComponent(room || "techrep-global"), {}, "chat"), state.classId || "电教委员"),
    sendChat: async (text, from, room) => {
      const me = from || (state.classId || "电教委员");
      const r = await ext("/chat", {
        method: "POST",
        body: JSON.stringify({ text, from: me, room: room || "techrep-global" }),
      }, "chat");
      return r;
    },
    CHAT_ROOM_GLOBAL: "techrep-global",
    // 年级房间 id 约定：grade:<年级名>。面板用它拼房间名，服务端按房间隔离存储。
    gradeRoom: (grade) => "grade:" + (grade || "").trim(),
    // 一对一私聊房间 id：dm:<较小id>:<较大id>（与服务端 canTalkInRoom 的解析一致）。
    // 用 id 而非用户名，避免改名后会话断掉；id 排序保证双方算出同一个房间名。
    dmRoom: (a, b) => {
      const x = Number(a), y = Number(b);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return "";
      return "dm:" + (x < y ? x + ":" + y : y + ":" + x);
    },

    // ---- 好友（站点侧 SQLite，仅登录用户可操作自己的关系）----
    // 服务端在 SQL 层用当前会话用户 id 做约束，前端传的 peerId 只表示「对端是谁」，
    // 无法借此操作别人的好友关系。
    listFriends: async () => {
      const r = await ext("/friends", {}, null);
      return {
        friends: (r && r.friends) || [],
        incoming: (r && r.incoming) || [],
        outgoing: (r && r.outgoing) || [],
      };
    },
    searchFriends: async (q) => {
      const r = await ext("/friends?q=" + encodeURIComponent(q || ""), {}, null);
      return (r && r.results) || [];
    },
    friendAction: async (action, peerId, peerName, message) =>
      ext("/friends", {
        method: "POST",
        body: JSON.stringify({ action, peerId, peerName, message }),
      }, null),

    // ---- 故障上报 / Bug（实名站：stelarith-website /api/feedback，复用反馈模型）----
    // 嵌入网站（/admin/console）或配置了 siteHost 时走网站；否则演示降级 / 扩展网关。
    //
    // 模板标签约定（配合面板的预设模板）：labels 形如
    //   ["report", "高", "投影/一体机不亮"]  /  ["bug", "崩溃闪退"]
    // 除种类与等级之外的第一个标签即「模板名」，读回时还原成 template 字段展示。
    // 存中文标签（而不是模板 id）是为了让反馈在网站后台也一眼能读懂，不必回表映射。
    _templateOf: (labels, kind) =>
      (labels || []).filter((l) => l !== kind && !["高", "中", "低"].includes(l))[0] || "",
    async listReports() {
      if (state.demo) return D.reports();
      if (!state.embedded && !state.siteHost) return ext("/reports", {}, "reports");
      try {
        const items = await siteFetch("/api/feedback");
        return (Array.isArray(items) ? items : [])
          .filter((x) => (x.labels || []).includes("report"))
          .map((x) => ({
            id: x.id,
            title: x.title,
            level: (x.labels || []).find((l) => ["高", "中", "低"].includes(l)) || "-",
            template: API._templateOf(x.labels, "report"),
            status: x.status || "待处理",
            at: x.createdAt || "",
          }));
      } catch (_) { return state.embedded || state.siteHost ? [] : D.reports(); }
    },
    async submitReport(r) {
      if (state.demo) return { ok: true, demo: true };
      if (!state.embedded && !state.siteHost) return ext("/reports", { method: "POST", body: JSON.stringify(r) }, "reports");
      return siteFetch("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          title: r.title,
          content: r.desc || "",
          labels: ["report", r.level, r.template].filter(Boolean),
        }),
      });
    },
    async listBugs() {
      if (state.demo) return D.bugs();
      if (!state.embedded && !state.siteHost) return ext("/bugs", {}, "bugs");
      try {
        const items = await siteFetch("/api/feedback");
        return (Array.isArray(items) ? items : [])
          .filter((x) => (x.labels || []).includes("bug"))
          .map((x) => ({
            id: x.id,
            title: x.title,
            template: API._templateOf(x.labels, "bug"),
            status: x.status || "待受理",
            at: x.createdAt || "",
          }));
      } catch (_) { return state.embedded || state.siteHost ? [] : D.bugs(); }
    },
    async submitBug(b) {
      if (state.demo) return { ok: true, demo: true };
      if (!state.embedded && !state.siteHost) return ext("/bugs", { method: "POST", body: JSON.stringify(b) }, "bugs");
      const content = ["复现步骤：", b.steps || "", "日志：", b.log || ""].join("\n");
      return siteFetch("/api/feedback", {
        method: "POST",
        body: JSON.stringify({ title: b.title, content, labels: ["bug", b.template].filter(Boolean) }),
      });
    },

    // ---- 操作日志（站点侧 SQLite）----
    listAudit: async (action) =>
      normAudit(await ext("/audit" + (action ? "?action=" + encodeURIComponent(action) : ""), {}, "audit")),
    /** 记一条集控操作日志；失败不抛（审计不应阻断主流程）。 */
    audit: async (action, target, detail) => {
      try {
        return await ext("/audit", {
          method: "POST",
          body: JSON.stringify({ action, target, detail }),
        });
      } catch (e) { return { ok: false, error: e.message }; }
    },
    /**
     * 审计链自检。返回服务端的**原始**报告（含 checked/legacyRows/firstBadId/problem/
     * tailOk/mode/retentionDays/prunedBefore），刻意不在前端做任何"翻译"：
     * 这类安全结论一旦被前端加工，就再也没人知道原始判据是什么。
     * 拿不到后端能力时返回 null，由调用方显示「未校验」——不伪装成"通过"。
     */
    auditVerify: async () => {
      try {
        const r = await ext("/audit/verify", {}, null);
        // 后端返回的是两层：{ verify: 链自检结论, policy: 保留策略 }。
        // 曾经直接 `return r`，而视图按平铺字段读（v.checked / v.ok / v.mode …），
        // 结果全部读到 undefined —— 页面把「链完整」显示成「链断裂」，
        // 还印出「已校验 undefined 条 / 算法 undefined / 保留策略 undefined 天」。
        // 安全结论被误报是最不能接受的一类 bug，所以在这里把两层拍平。
        if (!r || !r.verify) return null;
        return { ...r.verify, ...(r.policy || {}) };
      } catch (e) { return null; }
    },
    /** 按保留期裁剪审计（需 device.manage）。 */
    auditPrune: async (days) => {
      try {
        return await ext("/audit/prune", { method: "POST", body: JSON.stringify({ days }) });
      } catch (e) { return { ok: false, error: e.message }; }
    },

    // ---- 权限与分级（服务端解算后下发；前端只渲染，不自行推导）----
    //
    // 为什么权限矩阵要走服务端：等级/设备/分级三张表属于**安全边界**，
    // 前端自己推导时只要有一处判断写错，界面就会显示出实际做不到的能力，
    // 用户点下去得到 403，体感是"面板骗我"。服务端下发则始终与真正的门控
    // （can/canDevice/canBroadcastTo）同源，界面与服务端永远一致。
    permissions: async () => {
      try {
        const r = await ext("/permissions", {}, null);
        // ext() 在「未配 extHost」时返回 {}（不是 null），所以这里按**结构**判定：
        // 拿不到 me 快照就视为不可用，由调用方渲染「权限信息不可用」，
        // 而不是让页面拿到一个空对象后在 r.me.level 上抛错。
        return r && r.me ? r : null;
      } catch (_) { return null; }
    },

    // ---- 账号信息（全权接入 website 账号体系）----
    // 嵌入网站（/admin/console）时 iframe 与宿主同源，siteFetch 带凭证 cookie 直连 /api/me，
    // 拉取当前登录用户完整资料（含班级/年级绑定）。这就是「全权接入」——
    // 面板不猜账号，直接读 website 真实账号存储；未登录/请求失败返回 null。
    async me() {
      if (state.demo) return null;
      if (!state.embedded && !state.siteHost) return null;
      try {
        const r = await siteFetch("/api/me");
        return (r && r.username) ? r : null;
      } catch (_) { return null; }
    },
    /** 保存当前账号资料（含 className/gradeName），失败抛错。 */
    async saveMe(patch) {
      if (state.demo) return { ok: true, demo: true };
      return siteFetch("/api/me", { method: "PUT", body: JSON.stringify(patch) });
    },
    // ---- 摄像头 / 媒体库（设备侧执行，面板侧轮询取结果）----
    // 说明：这些动作**不会**在返回值里给出结果，只表示"已下发成功"。
    // 真正的产物要靠 deviceMediaSession() + mediaLibrary() 去取。
    cameraList: (uid, scope) => sendDeviceTask(uid, "camera_list", scope),
    cameraSnapshot: (uid, scope, extra) => sendDeviceTask(uid, "camera_snapshot", scope, extra),
    recordStart: (uid, scope, extra) => sendDeviceTask(uid, "camera_record_start", scope, extra),
    recordStop: (uid, scope) => sendDeviceTask(uid, "camera_record_stop", scope),
    mediaDelete: (uid, kind, name, scope) => sendDeviceTask(uid, "media_delete", scope, { kind, name }),
    mediaSessionStart: (uid, scope) => sendDeviceTask(uid, "media_session_start", scope),
    mediaSessionStop: (uid, scope) => sendDeviceTask(uid, "media_session_stop", scope),

    /** 设备已登记的媒体直连会话（{ip,port,token}）或 null。 */
    deviceMediaSession: async (uid) => {
      try {
        const r = await ext("/media-session?uid=" + encodeURIComponent(uid));
        return (r && r.session) || null;
      } catch (_) { return null; }
    },
    /** 全部未过期设备会话（诊断用：一眼看出"代理到底有没有报过"，而不是只有 null）。 */
    deviceSessions: async () => {
      try {
        const r = await ext("/sessions");
        return (r && r.sessions) || [];
      } catch (_) { return []; }
    },
    /**
     * 直连取设备媒体库清单。
     * **必须把失败原因带回去**：跨协议（https 面板 → http 教室机被浏览器拦）、
     * 跨网段、令牌过期，三者在界面上都以"什么都没发生"的形式出现，
     * 而它们对应的处置完全不一样 —— 只说"失败"等于把排查退回到猜。
     */
    mediaLibrary: async (session) => {
      if (!session || !session.ip || !session.port) {
        return {
          ok: false, reason: "no_session",
          message: "设备尚未登记媒体直连会话：可能还没执行过抓拍/录像，也可能代理未配置上报地址（STELARITH_EXT_URL）。",
        };
      }
      const base = "http://" + session.ip + ":" + session.port;
      try {
        const res = await fetch(base + "/list?t=" + encodeURIComponent(session.token || ""), { cache: "no-store" });
        if (res.status === 403) {
          return { ok: false, reason: "forbidden", message: "直连令牌被拒绝：会话已被轮换或已关闭，请重新触发一次抓拍。" };
        }
        if (!res.ok) return { ok: false, reason: "http_" + res.status, message: "直连返回 HTTP " + res.status };
        const j = await res.json();
        return { ok: true, items: (j && j.items) || [], base, token: session.token || "" };
      } catch (e) {
        return {
          ok: false, reason: "network",
          message: "无法直连教室机 " + base + "：" + ((e && e.message) || e)
            + "｜常见原因：① 面板走 HTTPS 而教室机是 HTTP（浏览器按混合内容拦截）；"
            + "② 面板与教室机不在同一网段；③ 教室机防火墙未放行该端口。",
        };
      }
    },
    /** 拼直连文件地址（图片/视频标签直接用拼好的 URL，浏览器不会为它们发自定义头）。 */
    mediaUrl: (base, token, kind, name) =>
      base + "/file/" + encodeURIComponent(kind) + "/" + encodeURIComponent(name) + "?t=" + encodeURIComponent(token || ""),
  };

  global.API = API;
})(window);
