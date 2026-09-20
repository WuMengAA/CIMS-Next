// 星集控 · 面板逻辑（零依赖，事件委托，渲染即绑定）
(function () {
  // 主题跟随：宿主后台（SvelteKit）切亮/暗时实时 postMessage 过来，
  // 同步到 <html> 的 dark 类，避免整页 reload 丢视图状态。
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d.type !== "theme") return;
    if (d.theme === "dark" || d.theme === "light") {
      document.documentElement.classList.toggle("dark", d.theme === "dark");
      try { localStorage.setItem("console-theme", d.theme); } catch (_) {}
    }
  });

  const $ = (s) => document.querySelector(s);
  const view = $("#view");
  let current = "dashboard";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const toast = (m) => { $("#status-msg").textContent = m; };
  const meta = (m) => { $("#status-meta").textContent = m; };
  /** 空状态行：表格无数据时给一句人话，而不是一片空白。 */
  const emptyRow = (cols, text) => `<tr><td colspan="${cols}" class="muted" style="text-align:center;padding:18px 0">${esc(text || "暂无记录")}</td></tr>`;

  function setConn(ok, txt) {
    const el = $("#conn");
    el.className = "conn " + (ok ? "online" : "offline");
    el.textContent = txt || (ok ? "已连接" : "未连接");
  }

  /**
   * 后端不可用横幅。
   *
   * 与顶栏 setConn 的「演示模式」指示灯是**两件事**，必须分开呈现：
   *   - 演示模式：用户主动要假数据 → 顶栏显示「演示模式」，不弹横幅；
   *   - offline  ：要真数据但拿不到 → 弹红色横幅，列表为空。
   *
   * 为什么值得单做一条横幅：曾经「拿不到真数据」会静默回落到演示数据，
   * 界面上看不出任何异常 —— 后端挂了跟一切正常长得一模一样。
   * 集控面板里这意味着运维会对着**不存在的设备**下发指令，
   * 而失败还被伪装成成功。宁可空屏 + 明确告警，也不要可信的假象。
   */
  function refreshOfflineBanner() {
    const el = $("#offline-banner");
    const txt = $("#offline-banner-text");
    if (!el) return;
    if (API.state.demo) { el.classList.add("hidden"); return; } // 演示模式不是异常
    if (!API.state.offline) { el.classList.add("hidden"); return; }
    const why = API.state.lastError ? `（${API.state.lastError}）` : "";
    if (txt) txt.textContent = `未连接后端${why} — 当前列表为空，不是真实设备，请勿据此操作`;
    el.classList.remove("hidden");
  }

  // ============ 权限（由网站后台经 iframe query 下发）============
  // 网站 /admin/console 按「两条轴」算好下发的权限位：
  //   - 设备轴 control/remote/manage（canDevice，与内容等级正交）；
  //   - 内容轴 issue（submitIssue，L2 参与能力）。
  // 经 iframe src 的 query 传入；独立打开面板（非内嵌）时不做限制。
  // **内嵌时为 fail-closed**：没拿到明确授权即视为无权限，
  // 避免「前端忘了传 → 谁都全权限」的危险默认。
  const PERM = (function () {
    const q = new URLSearchParams(location.search);
    const embedded = q.get("embed") === "1" || location.pathname.startsWith("/admin/console");
    const flag = (k) => q.get(k) === "1";
    const p = {
      embedded,
      role: q.get("role") || "",
      roleLabel: q.get("roleLabel") || "",
      levelLabel: q.get("levelLabel") || "",
      user: q.get("user") || "",
      email: q.get("email") || "",
      avatar: q.get("avatar") || "",
      className: q.get("className") || "",
      gradeName: q.get("gradeName") || "",
      control: flag("control"),
      remote: flag("remote"),
      manage: flag("manage"),
      issue: flag("issue"),
      // 广播可达范围（class/grade/school）。宿主按角色等级算好后下发；
      // 内嵌态拿不到就视为「仅本班」，宁可少列也不给未授权的大范围。
      bscopes: (q.get("bscopes") || "").split(",").map((s) => s.trim()).filter(Boolean),
      // 当前用户 id（拼私聊房间名用）。独立打开时为空，此时不提供私聊入口。
      uid: Number(q.get("uid") || 0) || 0,
    };
    // readonly 有两种来源：宿主显式下发的 readonly=1（只读观看态），
    // 或内嵌但一个设备写权限位都没有 —— 两者归一，避免各自为政。
    p.readonly = embedded && (flag("readonly") || (!p.control && !p.remote && !p.manage));
    return p;
  })();

  // 只读观看态：整体套一层标记，供 CSS 收敛一切写操作入口的样式。
  if (PERM.readonly) document.documentElement.classList.add("readonly-mode");
  const NEED_LABEL = { control: "设备控制", remote: "远程控制", manage: "设备管理", issue: "提交上报" };
  /** 设备档位 → 中文（权限页展示用；与 NEED_LABEL 同源但含未用于门控的 watch）。 */
  const NEED_LABEL_DEVICE = { watch: "观看", control: "设备控制", remote: "远程控制", manage: "设备管理" };
  /**
   * 核心模块 id 集合 —— 从 API 的模块目录派生，不另写一份。
   * 核心模块（心跳上报 / 集控指令通道）关掉后这台设备就从集控视野里消失了，
   * 因此面板、服务端、插件端三处都要拒绝关闭；这里是第一道（按钮 disabled + 事件兜底）。
   */
  const MOD_CORE = new Set(((API && API.MODULE_CATALOG) || []).filter((m) => m.core).map((m) => m.id));
  const allow = (need) => !need || !PERM.embedded || !!PERM[need];
  /** 整个视图所需的权限（视图级门控，避免点进去只有一片禁用按钮）。 */
  const VIEW_NEED = {
    schedule: "control", config: "control", plugins: "manage",
    // 班级管理：看+登记班级是电教委员/老师的日常（control）；
    // 页内的「审核」按钮另加 data-need="manage" 二次门控，不把整页锁死。
    classes: "control",
    devices: "control", remote: "remote", notify: "control",
    report: "issue", bug: "issue",
    // ClassIsland 专页以"看状态"为主，只要有设备观看/控制权即可进入
    // （写操作在页内逐个按钮上再门控，不把整页锁死）。
    classisland: "control",
    random: "control", filetransfer: "control", volume: "control",
    // 权限与分级页是纯读信息，不需要设备权限 —— 任何能进面板的人
    // 都该看得到"自己到底能做什么"，否则权限不透明会变成猜谜。
    // 自检页同理：它只是"把每段各探一次"，本身不改任何东西。
    test: "control",
    // 开发者选项能发任意原始请求（含写操作）、能改全局媒体策略 → 收到设备管理档。
    dev: "manage",
    // 摄像头/录像：隐私相关动作，按设备轴 remote 档门控（能远程看画面才谈得上抓拍）。
    media: "remote",
  };

  function renderPermChip() {
    const el = $("#perm-chip");
    if (!el) return;
    if (!PERM.embedded) { el.classList.add("hidden"); return; }
    const parts = [];
    if (PERM.manage) parts.push("设备管理");
    if (PERM.control) parts.push("设备控制");
    if (PERM.remote) parts.push("远程控制");
    if (PERM.issue) parts.push("上报");
    // 等级标签（L1–L5）单独前置：它属于内容轴，与后面的设备档位是两个维度。
    const level = PERM.levelLabel ? PERM.levelLabel + " · " : "";
    el.textContent = level + (PERM.roleLabel || PERM.role || "只读") + " · " + (parts.length ? parts.join(" / ") : "仅查看");
    el.classList.toggle("readonly", !!PERM.readonly);
    if (PERM.readonly) el.title = "当前为只读观看，所有设备写操作已隐藏";
    el.classList.remove("hidden");
  }

  /** 渲染后统一应用权限：隐藏无权限导航，禁用无权限按钮并说明原因。 */
  function applyGating() {
    document.querySelectorAll(".nav[data-need]").forEach((b) => {
      b.classList.toggle("hidden", !allow(b.dataset.need));
    });
    view.querySelectorAll("[data-need]").forEach((el) => {
      if (allow(el.dataset.need)) return;
      el.disabled = true;
      el.classList.add("locked");
      el.setAttribute("aria-disabled", "true");
      el.title = "当前账号（" + (PERM.roleLabel || PERM.role || "只读") + "）无「" +
        (NEED_LABEL[el.dataset.need] || el.dataset.need) + "」权限";
    });
  }

  // ============ 视图 ============
  const views = {};

  views.dashboard = async () => {
    const [devs, sched, notices] = await Promise.all([API.listDevices(), API.getSchedule(), API.listNotices()]);
    const online = devs.filter((d) => d.online).length;
    const offline = devs.length - online;
    const rate = devs.length ? Math.round((online / devs.length) * 100) : 0;
    const now = new Date();
    // 防御式取用：即便后端返回非预期结构（例如资源缺失、信封形态变更），
    // 也只让「今日课程」这一块降级为 0，而不是让 `sched.days[0]` 抛
    // 「Cannot read properties of undefined (reading '0')」把整页替换成错误卡。
    const allDays = (sched && sched.days) || [];
    // 取「今天」的课：days[].day 与 Date.getDay() 同为 0=周日…6=周六。
    // 今天无课（或该天不在课表里）时回退到课表第一天，保证卡片不空。
    const todayDow = now.getDay();
    const todayPlan = allDays.find((d) => d && d.day === todayDow) || allDays[0];
    const courses = (todayPlan && todayPlan.items) || [];
    const greet = now.getHours() < 12 ? "早上好" : now.getHours() < 18 ? "下午好" : "晚上好";
    const todayStr = `${now.getMonth() + 1}月${now.getDate()}日 · 周${"日一二三四五六"[now.getDay()]}`;
    const goods = (scope) => ({ "本班": "ok", "全校": "warn", "年级": "accent", "广播": "err" }[scope] || "");
    const nextPeriod = courses[0];
    // #71 完善信息：把真实绑定的班级/年级/身份落到总览，让信息「有实质价值」而非占位。
    const bindTip = [PERM.gradeName, PERM.className].filter(Boolean).join(" ");
    const heroScope = bindTip ? ` · ${esc(bindTip)}` : (PERM.embedded ? " · 尚未绑定班级，可在顶部卡片绑定" : "");
    const who = PERM.displayName || PERM.user || (PERM.roleLabel || "电教委员");
    return `<!-- 主页视觉卡片 -->
      <div class="db-hero herald ${PERM.embedded && !bindTip ? "hero-needs-bound" : ""}">
        <div>
          <div class="hero-title">${esc(greet)}，${esc(who)} <span class="hero-wave">👋</span></div>
          <div class="hero-sub">${todayStr}${heroScope}</div>
        </div>
        <div class="hero-badge">
          <div class="hero-big">${rate}%</div>
          <div class="hero-small">设备在线率</div>
        </div>
      </div>

      <div class="grid g4">
        <div class="kpi"><div class="n" style="color:var(--ok)">${online}</div><div class="l">🖥 在线设备</div></div>
        <div class="kpi"><div class="n" style="color:${offline ? "var(--err)" : "var(--muted)"}">${offline}</div><div class="l">⚠ 离线告警</div></div>
        <div class="kpi"><div class="n" style="color:var(--accent)">${courses.length}</div><div class="l">📚 今日课程</div></div>
        <div class="kpi"><div class="n" style="color:var(--warn)">${nextPeriod ? esc(nextPeriod) : "-"}</div><div class="l">🎯 下节课程</div></div>
      </div>

      <div class="grid g2">
        <div class="card">
          <h3>设备状态</h3>
          <div class="rate-bar"><span style="width:${rate}%"></span></div>
          <div class="rate-legend"><span>在线率 ${rate}%</span><span>${online}/${devs.length} 台</span></div>
          <div class="list">
            ${devs.slice(0, 10).map(d => `
              <div class="li">
                <span class="li-dot ${d.online ? "on" : "off"}"></span>
                <span class="li-name">${esc(d.name)}</span>
                <span class="grow"></span>
                <span class="muted" style="font-size:11px">${esc(d.last || "")}</span>
                ${d.stateLabel ? stateTag(d) : `<span class="tag ${d.online ? "ok" : "err"}">${d.online ? "在线" : "离线"}</span>`}
              </div>`).join("")}
            ${devs.length > 10 ? `<div class="li muted">… 还有 ${devs.length - 10} 台设备</div>` : ""}
          </div>
        </div>
        <div class="card">
          <h3>今日课表</h3>
          <div class="list">
            ${courses.length ? courses.map((c, i) => `
              <div class="li per${i === 0 ? " now" : ""}">
                <span class="per-idx">${String(i + 1).padStart(2, "0")}</span>
                <span class="li-name">${esc(c)}</span>
                ${i === 0 ? `<span class="tag ok">进行中</span>` : ""}
              </div>`).join("") : `<div class="li muted">今日无课</div>`}
          </div>
        </div>
      </div>

      <div class="card">
        <h3>最近通知</h3>
        ${notices.length ? `<div class="list">
          ${notices.slice(0, 6).map(n => `
            <div class="li">
              <span class="li-dot ${goods(n.scope) || "dim"}"></span>
              <span class="li-name">${esc(n.title)}</span>
              ${n.scope ? `<span class="tag ${goods(n.scope) || "dim"}">${esc(n.scope)}</span>` : ""}
              <span class="grow"></span>
              <span class="li-time">${esc(n.at || "")}</span>
            </div>`).join("")}
        </div>` : `<p class="muted">暂无通知</p>`}
      </div>`;
  };

  views.schedule = async () => {
    const s = await API.getSchedule();
    // days 可能是空数组（合法空信封）或后端结构异常，用 (s.days||[]) 兜底，
    // 不要直接 s.days.map —— 空信封会让整页变成「加载失败」。
    const days = (s && s.days) || [];
    const total = days.reduce((n, d) => n + ((d.items || []).length), 0);

    // 竖向列表：每天一块，节次自上而下竖排。
    // 之前是「周几 + 一排横向 input」，一天 12 节要横向铺开，窄屏直接溢出，
    // 也看不出「第几节」；改成竖排后节次序号在左、科目在右，一屏读一天。
    const dayBlocks = days
      .map(
        (d) => `
        <div class="sched-day">
          <div class="sched-day-head">
            <span class="sched-day-name">${esc(d.name)}</span>
            <span class="muted">${(d.items || []).length} 节</span>
            <span class="grow"></span>
            <button data-act="sched-add" data-day="${d.day}" title="在末尾新增一节">+ 新增一节</button>
          </div>
          <ol class="sched-list">
            ${
              (d.items || []).length
                ? (d.items || [])
                    .map(
                      (c, i) => `<li class="sched-row">
                        <span class="sched-idx">${String(i + 1).padStart(2, "0")}</span>
                        <input class="sched-subject" data-day="${d.day}" data-i="${i}"
                               value="${esc(c)}" placeholder="科目（留空=该节无课）"/>
                        <button class="sched-del" data-act="sched-del" data-day="${d.day}" data-i="${i}"
                                title="删除这一节">✕</button>
                      </li>`
                    )
                    .join("")
                : `<li class="muted" style="padding:6px 0">这一天暂无课，点「+ 新增一节」开始添加。</li>`
            }
          </ol>
        </div>`
      )
      .join("");

    return `
      <div class="card"><h3>时间表 · 课程表 · ${esc(currentClassLabel() || "（未选择班级）")}
        ${API.state.classId ? `<span class="muted" style="font-size:12px;font-weight:400">（资源 ${esc(API.state.classId)}）</span>` : ""}</h3>
        <p class="muted">
          竖向列表：每天一块，节次自上而下。直接改科目名后点「保存并下发」，
          配置将推送到本班所有设备。科目名需与全校科目表一致（见「配置下发」），
          否则该节无法写入。
        </p>
        <div class="row" style="margin:8px 0">
          <span class="muted">共 ${days.length} 天 / ${total} 节</span>
          <span class="grow"></span>
          <button data-act="reload">重新拉取</button>
        </div>
        ${
          days.length
            ? `<div class="sched-grid">${dayBlocks}</div>`
            : `<p class="muted">该课表暂无内容（可能是尚未导入班级课表）。可先在「班级课表导入」里导入，或到 CIMS 管理端铺一张空周课表。</p>`
        }
        <div class="row" style="margin-top:12px">
          <button class="primary" data-act="save-schedule" data-need="control">保存并下发</button>
          <button data-act="reload">重新拉取</button>
        </div>
      </div>`;
  };

  views.config = async () => {
    const c = await API.getConfig();
    return `
      <div class="card"><h3>ClassIsland 配置下发</h3>
        <div class="row">
          <label class="row"><input type="checkbox" data-cfg="inClass" ${c.autoHide?.inClass?"checked":""}/> 上课自动隐藏</label>
          <label class="row"><input type="checkbox" data-cfg="exam" ${c.autoHide?.exam?"checked":""}/> 考试自动隐藏</label>
          <label class="row"><input type="checkbox" data-cfg="projection" ${c.autoHide?.projection?"checked":""}/> 投影时自动隐藏</label>
        </div>
        <div class="row" style="margin-top:8px">
          <span class="muted">更新通道</span>
          <input id="cfg-channel" value="${esc(c.updateChannel||"")}" style="width:280px"/>
        </div>
        <div style="margin-top:10px">
          <div class="muted">原始配置（JSON，可远程改视图/组件/策略）</div>
          <textarea id="cfg-json">${esc(JSON.stringify(c,null,2))}</textarea>
        </div>
        <div class="row" style="margin-top:8px">
          <button class="primary" data-act="save-config" data-need="control">保存并下发</button>
          <button data-act="reload">重新拉取</button>
        </div>
      </div>`;
  };

  views.plugins = async () => {
    const ps = await API.listPlugins();
    return `
      <div class="card"><h3>组件配置（CIMS Components 资源）</h3>
        <p class="muted">
          这里管理的是 <b>CIMS 下发给教室端的「组件」资源</b>（大屏上显示哪些组件、放在哪里），
          <b>不是</b> ClassIsland 的插件启停。
        </p>
        <p class="muted">
          ClassIsland <b>没有运行时启停第三方插件的公开接口</b> —— 插件放进 Plugins 目录即被加载，
          禁用只能改宿主自己的配置并重启。要看「教室端到底装了哪些插件、星璃模块开了哪些」，
          请到 <b>「ClassIsland 专页」</b>（数据来自设备真实心跳，可对星璃模块开关直接生效）。
        </p>
        <table><thead><tr><th>组件</th><th>版本</th><th>状态</th><th>操作</th></tr></thead><tbody>
        ${ps.length
          ? ps.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.ver)}</td>
          <td><span class="tag ${p.enabled?"ok":""}">${p.enabled?"已启用":"已禁用"}</span></td>
          <td><button data-act="toggle-plugin" data-need="manage" data-id="${p.id}" data-on="${p.enabled?0:1}">${p.enabled?"禁用":"启用"}</button></td></tr>`).join("")
          : emptyRow(4, "该账户下暂无组件资源")}
        </tbody></table>
        <div class="row" style="margin-top:8px">
          <button data-act="go" data-v="classisland" data-need="control">前往 ClassIsland 专页（真实插件与模块状态）→</button>
        </div>
      </div>`;
  };

  /**
   * 设备 → 所属班级文案。一班一号：同一时刻只可能属于一个班。
   *
   * 优先用 `/class/device-status` 里的 `class_name`（服务端已 JOIN 好班级名）；
   * 该字段缺失时才回落到 `/class/device-map` 的映射表 —— 两个接口都能回答
   * 「这台设备属于哪个班」，但设备状态接口是面板的主数据源，能少发一次请求。
   */
  function classOf(map, id) {
    const cid = ((map && map.devices) || {})[id] || "";
    if (!cid) return { label: "未绑定班级", bound: false };
    const c = ((map && map.classes) || []).find((x) => x.class_id === cid);
    return { label: (c && c.name) || cid, bound: true };
  }

  /** 设备行里的班级单元格：优先用状态接口自带的名字，避免依赖 device-map 是否可达。 */
  function classCell(d, map) {
    if (d.className) return { label: d.className, bound: true };
    if (d.classId) {
      const c = classOf(map, d.id);
      return { label: c.bound ? c.label : d.classId, bound: true };
    }
    return classOf(map, d.id);
  }

  /** 设备状态标签：未接入 / 在线 / 离线，三态而不是两态。 */
  const stateTag = (d) => `<span class="tag ${d.stateKind}">${esc(d.stateLabel)}</span>`;

  /**
   * 「设备」单元格：主机名 + 设备号。
   *
   * 主机名走心跳上报，从未上报过的设备没有它 —— 这时**明确写"尚未上报主机名"**，
   * 而不是把设备号再打印一遍（同一串上下两行，用户会以为名字丢了/是"无"）。
   */
  const devCell = (d) =>
    `<td>${d.hostKnown ? esc(d.host) : `<span class="muted">（尚未上报主机名）</span>`}` +
    `<br><span class="muted" style="font-size:12px">${esc(d.id)}</span></td>`;

  // 设备表的交互状态**外提**到模块作用域：`go()` 是整块替换 `view.innerHTML`，
  // 状态若留在闭包里，用户输好搜索词点一次「刷新」就白输了 —— 60 班时这很烦。
  let devQuery = "";
  let devGrouped = true;

  views.devices = async () => {
    const [st, map] = await Promise.all([API.deviceStatus(), API.deviceClassMap()]);
    const ds = st.devices || [];
    const unbound = ds.filter((d) => !classCell(d, map).bound).length;
    const online = ds.filter((d) => d.online).length;
    const never = ds.filter((d) => !d.reported).length;

    // 先把每台设备的「班级标签」与「搜索串」算一遍，渲染与过滤共用同一份数据 ——
    // 过滤若另写一套字段清单，早晚会与表格列不一致（加了列却搜不到）。
    const rows = ds.map((d) => {
      const c = classCell(d, map);
      const cls = c.bound ? c.label : "未绑定";
      return {
        d,
        cls,
        bound: c.bound,
        q: [d.name, d.id, d.ip, d.ver, d.className, d.classId, cls]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      };
    });

    // 按班级分组；「未绑定」恒定排最后（它是待办事项，插在正常班级中间会看不见）。
    const groups = new Map();
    for (const r of rows) {
      if (!groups.has(r.cls)) groups.set(r.cls, []);
      groups.get(r.cls).push(r);
    }
    const groupNames = [...groups.keys()].sort((a, b) => {
      if (a === "未绑定") return 1;
      if (b === "未绑定") return -1;
      return a.localeCompare(b, "zh-Hans-CN");
    });

    // 绑定班级下拉选项：当前已绑定的班默认选中；未绑定则落在「选择班级」占位项。
    const suggestList = st.suggest || [];
    const assignOptions = (selId) =>
      `<option value="">— 选择班级 —</option>` +
      suggestList
        .map((c) => `<option value="${esc(c.class_id)}" ${c.class_id === selId ? "selected" : ""}>${esc(c.name)}</option>`)
        .join("");

    const devRow = ({ d, bound, cls, q }) => `<tr class="dev-row" data-dev-q="${esc(q)}">
          ${devCell(d)}
          <td><span class="tag ${bound ? "ok" : "warn"}">${esc(cls)}</span></td>
          <td>${esc(d.ip || "—")}</td><td>${esc(d.ver)}</td><td>${esc(d.last)}</td>
          <td>${stateTag(d)}</td>
          <td>
            <select class="ci-assign" data-id="${esc(d.id)}" aria-label="绑定班级" style="max-width:160px">${assignOptions(d.classId)}</select>
            <button data-act="assign" data-need="manage" data-id="${esc(d.id)}">${bound ? "改绑" : "绑定"}</button>
            <button data-act="unassign" data-need="manage" data-id="${esc(d.id)}" ${bound ? "" : "disabled"} title="解除班级绑定：设备端将重新弹出选班引导（OOBE 重新注册）">解绑</button>
          </td>
          <td>
            <button data-act="dev" data-need="control" data-id="${d.id}" data-a="restart" ${d.online ? "" : "disabled"}>重启</button>
            <button data-act="dev" data-need="control" data-id="${d.id}" data-a="refresh" ${d.online ? "" : "disabled"}>刷新</button>
            <button data-act="dev" data-need="control" data-id="${d.id}" data-a="lock" ${d.online ? "" : "disabled"}>锁屏</button>
            <button data-act="dev" data-need="control" data-id="${d.id}" data-a="screenshot" ${d.online ? "" : "disabled"}>截图</button>
            <button class="danger" data-act="dev" data-need="control" data-id="${d.id}" data-a="shutdown" data-confirm="1" ${d.online ? "" : "disabled"}>关机</button>
            <button data-act="shutdown-sched" data-need="control" data-id="${esc(d.id)}" data-name="${esc(d.host || d.id)}" ${d.online ? "" : "disabled"} title="设置定时关机计划（教室端 60s 确认后生效）">定时关机</button>
          </td></tr>`;

    const body = !rows.length
      ? emptyRow(7, "该账户下暂无已注册设备")
      : devGrouped
        ? groupNames
            .map((g) => {
              const list = groups.get(g);
              const on = list.filter((r) => r.d.online).length;
              return (
                `<tr class="dev-group"><td colspan="8"><b>${esc(g)}</b>` +
                `<span class="muted"> · ${list.length} 台${on ? ` · 在线 ${on}` : ""}</span></td></tr>` +
                list.map(devRow).join("")
              );
            })
            .join("")
        : rows.map(devRow).join("");

    return `
      <div class="card"><h3>设备控制</h3>
        <p class="muted">
          一班一号：每台设备在任一时刻只属于一个班级（数据层由
          <code>client_profiles.class_id</code> 单值字段保证，不靠人工约定）。
          同一台设备若要换班，需先在管理端解绑/转移，不会静默抢占。
        </p>
        <p class="muted">
          状态全部来自设备<b>真实心跳</b>（<code>client_status</code> 表，判定阈值 ${esc(String(st.fresh || 90))} 秒）：
          在线 ${online} / 共 ${ds.length} 台${never ? `，其中 <b>${never}</b> 台从未上报（尚未接入集控）` : ""}。
        </p>
        ${
          unbound
            ? `<p class="muted" style="color:var(--warn)">⚠ 有 ${unbound} 台设备尚未绑定班级，定向广播不会覆盖到它们。</p>`
            : ""
        }
        <div class="row" style="margin-bottom:8px">
          <input type="search" data-devfilter="1" value="${esc(devQuery)}" aria-label="筛选设备"
                 placeholder="搜索 班级 / 设备名 / 设备号 / IP / 版本…" style="min-width:240px;flex:1">
          <button data-act="dev-group">${devGrouped ? "改为平铺" : "按班级分组"}</button>
          <button data-act="shutdown-class" data-need="control" title="对当前筛选出的所有在线设备下发同一份定时关机计划（教室端 60s 确认后生效）">整班定时关机</button>
          <button data-act="reload">刷新</button>
          <span class="muted" id="dev-shown" aria-live="polite"></span>
        </div>
        <table><thead><tr><th>设备</th><th>所属班级</th><th>IP</th><th>版本</th><th>最后心跳</th><th>状态</th><th>绑定班级</th><th>操作</th></tr></thead>
        <tbody id="dev-body">${body}</tbody></table>
        <p class="muted">重启/刷新经 CIMS management 原生指令通道；锁屏/截图经命令队列下发 <code>stelarith_task</code>，由本机 ClassIsland 插件 + 本地代理执行。</p>
      </div>`;
  };

  /**
   * 设备表筛选：**只切 DOM 可见性，不重渲染**。
   * 逐字符重渲染会把输入焦点打断（打第二个字就丢焦点）—— 搜索框最常见的坏味道。
   * 组头在「组内全被过滤掉」时一并隐藏，否则会留下一串空标题。
   */
  function applyDevFilter() {
    const body = document.getElementById("dev-body");
    if (!body) return;
    const q = devQuery.trim().toLowerCase();
    let shown = 0;
    let total = 0;
    body.querySelectorAll("tr.dev-row").forEach((tr) => {
      total++;
      const hit = !q || tr.dataset.devQ.includes(q);
      tr.classList.toggle("hidden", !hit);
      if (hit) shown++;
    });
    body.querySelectorAll("tr.dev-group").forEach((head) => {
      let any = false;
      let n = head.nextElementSibling;
      while (n && n.classList.contains("dev-row")) {
        if (!n.classList.contains("hidden")) { any = true; break; }
        n = n.nextElementSibling;
      }
      head.classList.toggle("hidden", !any);
    });
    const box = document.getElementById("dev-shown");
    if (box) box.textContent = q ? `命中 ${shown} / ${total} 台` : `${total} 台`;
  }

  // ============ 定时关机弹窗（长期计划：每天/每周/一次性/倒计时）============
  // 面板只负责「下发计划」：教室端 60 秒确认窗确认后才由插件透传给代理生效；
  // 拒绝/超时自动作废，处置结果进「回执收件箱」（notice_id = schedule.id）。
  // 已下发计划记 localStorage（stelarith_sched_<uid>），可一键取消（同 id + enabled=false）。
  const SHD_KEY = (uid) => "stelarith_sched_" + uid;
  const WEEK_CN = "一二三四五六日";

  function shdDescribe(s) {
    const note = s.note ? "｜" + s.note : "";
    const body =
      s.mode === "daily" ? `每天 ${s.time} 自动关机`
      : s.mode === "weekly" ? `每周 ${(s.days || []).map((d) => "周" + WEEK_CN[d - 1]).join("、")} 的 ${s.time} 自动关机`
      : s.mode === "once" ? `一次性：${String(s.datetime || "").replace("T", " ")} 自动关机`
      : s.mode === "countdown" ? `确认后 ${s.minutes} 分钟自动关机`
      : `定时计划（${s.mode}）`;
    return body + note;
  }

  /** 按模式切换显示/隐藏对应输入行。 */
  function shdToggleMode() {
    const m = document.getElementById("shd-modal");
    if (!m) return;
    const mode = m.querySelector("#shd-mode").value;
    m.querySelector("#shd-time-row").style.display = mode === "daily" || mode === "weekly" ? "" : "none";
    m.querySelector("#shd-days-row").style.display = mode === "weekly" ? "" : "none";
    m.querySelector("#shd-once-row").style.display = mode === "once" ? "" : "none";
    m.querySelector("#shd-min-row").style.display = mode === "countdown" ? "" : "none";
  }

  /**
   * 打开定时关机弹窗。
   * opts：{ uid, name } 单台，或 { uids: [...], name } 整班批量（同一条计划逐台下发）。
   */
  function openShutdownModal(opts) {
    const single = !!opts.uid;
    const targets = single ? [opts.uid] : opts.uids;
    const old = document.getElementById("shd-modal");
    if (old) old.remove();
    let cur = "";
    if (single) {
      try {
        const rec = JSON.parse(localStorage.getItem(SHD_KEY(opts.uid)) || "null");
        if (rec && rec.id) cur = `<div class="shd-current">当前已下发：${esc(shdDescribe(rec))}<br><span class="muted">${esc(rec.id)}（教室端确认后才生效）</span></div>`;
      } catch (_) {}
    }
    const box = document.createElement("div");
    box.id = "shd-modal";
    box.className = "shd-overlay";
    box.dataset.uids = JSON.stringify(targets);
    box.dataset.uid = single ? opts.uid : "";
    box.innerHTML = `
      <div class="shd-box">
        <h3>定时关机</h3>
        <p class="muted">目标：${esc(opts.name || (targets.length + " 台设备"))}</p>
        <p class="muted">⚠ 下发后<b>不立即生效</b>：教室端弹出确认窗，<b>60 秒内确认</b>才启用；拒绝/超时自动作废（处置结果进回执收件箱）。</p>
        ${cur}
        <label>规则
          <select id="shd-mode">
            <option value="daily">每天固定时刻</option>
            <option value="weekly">每周指定几天</option>
            <option value="once">一次性时间点</option>
            <option value="countdown">倒计时（确认后 N 分钟）</option>
          </select>
        </label>
        <div class="shd-row" id="shd-time-row"><label>时间<input type="time" id="shd-time" value="21:00"></label></div>
        <div class="shd-row shd-days" id="shd-days-row" style="display:none">
          <label>周几</label>
          <div>${[1, 2, 3, 4, 5, 6, 7].map((d) => `<label><input type="checkbox" value="${d}" ${d <= 5 ? "checked" : ""}>${WEEK_CN[d - 1]}</label>`).join("")}</div>
        </div>
        <div class="shd-row" id="shd-once-row" style="display:none"><label>时间点<input type="datetime-local" id="shd-once"></label></div>
        <div class="shd-row" id="shd-min-row" style="display:none"><label>分钟后关机<input type="number" id="shd-min" min="1" max="720" value="30"></label></div>
        <label>备注（可选）<input type="text" id="shd-note" placeholder="如：放学后自动关机" maxlength="60"></label>
        <div class="shd-actions">
          <button class="primary" data-act="shd-save">保存计划</button>
          ${single ? `<button data-act="shd-cancel-plan">取消现有计划</button>` : ""}
          <button data-act="shd-close">关闭</button>
        </div>
        <div class="shd-status" id="shd-status"></div>
      </div>`;
    document.body.appendChild(box);
    shdToggleMode();
  }

  /** 保存计划：构建 schedule 并逐台下发（CIMS 递送成功即算下发成功，教室端确认见回执）。 */
  async function saveShutdownPlan(btn) {
    const m = document.getElementById("shd-modal");
    if (!m) return;
    const status = m.querySelector("#shd-status");
    const targets = JSON.parse(m.dataset.uids || "[]");
    const mode = m.querySelector("#shd-mode").value;
    const note = (m.querySelector("#shd-note").value || "").trim();
    const id = "sc-" + Date.now();
    const sched = { id, mode, enabled: true, note };
    if (mode === "daily" || mode === "weekly") {
      const t = m.querySelector("#shd-time").value;
      if (!t) { status.textContent = "请选择时间"; status.className = "shd-status err"; return; }
      sched.time = t;
      if (mode === "weekly") {
        const days = [...m.querySelectorAll("#shd-days-row input:checked")].map((c) => Number(c.value));
        if (!days.length) { status.textContent = "请至少勾选一个周几"; status.className = "shd-status err"; return; }
        sched.days = days;
      }
    } else if (mode === "once") {
      const dt = m.querySelector("#shd-once").value;
      if (!dt) { status.textContent = "请选择时间点"; status.className = "shd-status err"; return; }
      sched.datetime = dt.replace(" ", "T");
    } else if (mode === "countdown") {
      sched.minutes = Math.max(1, Math.min(720, Number(m.querySelector("#shd-min").value) || 30));
    }
    btn.disabled = true;
    status.className = "shd-status";
    status.textContent = `正在下发到 ${targets.length} 台设备…`;
    let okN = 0, failN = 0, firstErr = "";
    for (const uid of targets) {
      try {
        const r = await API.scheduleShutdown(uid, sched);
        if (!r || r.ok === false) { failN++; firstErr = firstErr || (r && r.message) || "未知错误"; }
        else {
          okN++;
          try {
            localStorage.setItem(SHD_KEY(uid), JSON.stringify({
              id, mode: sched.mode, time: sched.time || "", days: sched.days || [],
              datetime: sched.datetime || "", minutes: sched.minutes || 0, note,
            }));
          } catch (_) {}
        }
      } catch (err) { failN++; firstErr = firstErr || ((err && err.message) || err); }
    }
    status.className = "shd-status " + (failN ? "err" : "ok");
    status.textContent = failN
      ? `已下发 ${okN} 台，${failN} 台失败：${firstErr}`
      : `已下发 ${okN} 台设备，等待教室端 60s 内确认生效（结果见回执收件箱）`;
    btn.disabled = false;
    if (!failN) setTimeout(() => { const mm = document.getElementById("shd-modal"); if (mm) mm.remove(); }, 900);
  }

  /** 取消单台设备的现有计划：读 localStorage 里的计划 id，下发同 id + enabled=false（教室端确认后删除）。 */
  async function cancelShutdownPlan(btn) {
    const m = document.getElementById("shd-modal");
    if (!m) return;
    const status = m.querySelector("#shd-status");
    const uid = m.dataset.uid || "";
    if (!uid) return;
    let rec = null;
    try { rec = JSON.parse(localStorage.getItem(SHD_KEY(uid)) || "null"); } catch (_) {}
    if (!rec || !rec.id) {
      status.className = "shd-status err";
      status.textContent = "本机没有该设备的计划记录：若设备端仍有计划，可在其确认窗里点「拒绝」，或让电教委员到设备上处理。";
      return;
    }
    btn.disabled = true;
    status.className = "shd-status";
    status.textContent = "正在取消…";
    try {
      const r = await API.scheduleShutdown(uid, { id: rec.id, mode: "daily", enabled: false, note: "" });
      if (!r || r.ok === false) {
        status.className = "shd-status err";
        status.textContent = "取消失败：" + ((r && r.message) || "未知错误");
        btn.disabled = false;
        return;
      }
      try { localStorage.removeItem(SHD_KEY(uid)); } catch (_) {}
      status.className = "shd-status ok";
      status.textContent = "已下发取消指令，等待教室端 60s 内确认（确认后计划删除）";
      setTimeout(() => { const mm = document.getElementById("shd-modal"); if (mm) mm.remove(); }, 900);
    } catch (err) {
      status.className = "shd-status err";
      status.textContent = "取消失败：" + ((err && err.message) || err);
      btn.disabled = false;
    }
  }

  views.remote = async () => {
    const [st, map] = await Promise.all([API.deviceStatus(), API.deviceClassMap()]);
    const ds = st.devices || [];
    return `
      <div class="card"><h3>远程屏幕控制</h3>
        <p class="muted">点「远程控制」→ 经命令队列下发 <code>remote_control_start</code> → ClassIsland 插件 → 本地代理<b>按需启动 VNC</b> → 面板内嵌 noVNC 连接。会话级端口 + 令牌，结束即关；每次控制写审计。</p>
        <p class="muted">一班一号：远程控制按设备所属班级归属，一台设备只服务一个班，不共享会话。</p>
        <table><thead><tr><th>设备</th><th>所属班级</th><th>最后心跳</th><th>状态</th><th>操作</th></tr></thead><tbody>
        ${
          ds.length
            ? ds
                .map((d) => {
                  const c = classCell(d, map);
                  return `<tr>${devCell(d)}
          <td><span class="tag ${c.bound ? "ok" : "warn"}">${esc(c.label)}</span></td>
          <td>${esc(d.last)}</td>
          <td>${stateTag(d)}</td>
          <td><button class="primary" data-act="remote-start" data-need="remote" data-id="${d.id}" ${d.online ? "" : "disabled"}>远程控制</button></td></tr>`;
                })
                .join("")
            : emptyRow(5, "该账户下暂无已注册设备")
        }
        </tbody></table>
      </div>
      <div id="vncbox" class="card hidden"><h3>VNC 会话 · <span id="vnc-name"></span></h3>
        <p class="muted" id="vnc-note"></p>
        <div id="vnc-diag" class="hidden" style="margin:8px 0 4px"></div>
        <iframe id="vnc-frame" title="远程屏幕" style="width:100%;height:340px;border:0;background:#000"></iframe>
        <div class="row">
          <button data-act="remote-stop" data-need="remote">结束会话</button>
          <button data-act="remote-wait" data-need="remote" id="vnc-retry" class="hidden">重试等待</button>
        </div>
      </div>`;
  };

  // ============ ClassIsland 专页（内嵌面板的"教室端主机"视图）============
  //
  // 为什么单开一页而不是塞进"设备控制"：这一页回答的是**另一类问题**。
  // 设备控制回答"这台机器属于哪个班、能不能重启"；本页回答"这台机器上的
  // ClassIsland 现在是什么状态"——当前课表群、宿主版本、装了哪些插件、
  // 星璃模块开了哪些、集控同步是否正常。
  //
  // 数据全部来自插件心跳（`/class/device-status` 的 modules/plugins/extra），
  // 不做任何猜测；指令全部走**同一条命令通道**（stelarith_task），
  // 因此这页既是"状态看板"也是"遥控器"，与教室端看到的完全一致。
  let ciCert = null;   // 选中的设备 id（跨重渲染保留）
  let ciGroup = "";    // 切班下拉选中的课表群名

  views.classisland = async () => {
    const [st, map, classes] = await Promise.all([
      API.deviceStatus(),
      API.deviceClassMap(),
      API.listClassEntities(),
    ]);
    const ds = st.devices || [];
    if (!ds.length) {
      return `<div class="card"><h3>ClassIsland 教室端</h3>
        <p class="muted">该账户下暂无已注册设备。设备接入集控并上报心跳后，这里会显示它的真实运行状态。</p></div>`;
    }
    const cur = ds.find((d) => d.id === ciCert) || ds[0];
    ciCert = cur.id;
    if (!ciGroup && cur.activeGroup) ciGroup = cur.activeGroup;

    const modules = API.normModules(cur.modules);
    const plugins = cur.plugins || [];
    const extra = cur.extra || {};
    const stelarithPlugin = plugins.find((p) => p.isStelarith || p.is_stelarith);
    const classOpts = (classes || []).map((c) => {
      const name = c.name || c.class_id;
      return `<option value="${esc(name)}" ${name === ciGroup ? "selected" : ""}>${esc(name)}</option>`;
    }).join("");

    return `
      <div class="card">
        <h3>ClassIsland 教室端 · 状态与快捷操作</h3>
        <div class="row" style="align-items:center;gap:8px;margin-bottom:10px">
          <span class="muted">选择设备</span>
          <select id="ci-device" style="min-width:260px">
            ${ds.map((d) => `<option value="${esc(d.id)}" ${d.id === cur.id ? "selected" : ""}>${esc(d.hostKnown ? d.host : d.id + "（尚未上报主机名）")} · ${esc(classCell(d, map).label)} · ${esc(d.stateLabel)}</option>`).join("")}
          </select>
          <button data-act="ci-reload">刷新状态</button>
        </div>
        <div class="grid2">
          <div class="kv">
            <div><span class="muted">主机名</span><b>${esc(cur.host || "—")}</b></div>
            <div><span class="muted">设备 ID</span><b>${esc(cur.id)}</b></div>
            <div><span class="muted">IP</span><b>${esc(cur.ip || "—")}</b></div>
            <div><span class="muted">插件版本</span><b>${esc(cur.ver)}</b></div>
            <div><span class="muted">所属班级</span><b>${esc(classCell(cur, map).label)}</b></div>
            <div><span class="muted">最后心跳</span><b>${esc(cur.last)}</b>${stateTag(cur)}</div>
          </div>
          <div class="kv">
            <div><span class="muted">当前课表群</span><b>${esc(cur.activeGroup || "—")}</b></div>
            <div><span class="muted">星璃插件</span><b>${stelarithPlugin ? esc(stelarithPlugin.version || "已加载") + " · " + esc(stelarithPlugin.status || "") : "未在心跳中报告"}</b></div>
            <div><span class="muted">已加载插件</span><b>${plugins.length} 个</b></div>
            <div><span class="muted">资源同步</span><b>${extra.sync_ok === false ? "上次失败" : extra.sync_ok === true ? "正常" : "—"}</b>${extra.sync_at ? `<span class="muted" style="font-size:12px"> · ${esc(extra.sync_at)}</span>` : ""}</div>
            <div><span class="muted">档案写回</span><b>${esc(extra.sync_writeback || "—")}</b></div>
            <div><span class="muted">运行时长</span><b>${extra.uptime_seconds ? Math.floor(extra.uptime_seconds / 3600) + " 小时 " + Math.floor((extra.uptime_seconds % 3600) / 60) + " 分" : "—"}</b></div>
          </div>
        </div>
        ${extra.sync_error ? `<p class="muted" style="color:var(--warn)">同步错误：${esc(extra.sync_error)}</p>` : ""}
      </div>

      <div class="card">
        <h3>快捷功能入口</h3>
        <p class="muted">全部经命令队列下发到这台机器，由 ClassIsland 插件就地执行 —— 不需要远程桌面。</p>
        <div class="row wrap">
          <button data-act="ci-act" data-need="control" data-id="${cur.id}" data-a="sync_now">立即同步资源</button>
          <button data-act="ci-act" data-need="control" data-id="${cur.id}" data-a="refresh_profile">刷新宿主档案</button>
          <button data-act="ci-act" data-need="control" data-id="${cur.id}" data-a="show_message">弹出最近一条广播</button>
          <button data-act="ci-act" data-need="control" data-id="${cur.id}" data-a="lock">锁屏</button>
          <button data-act="ci-act" data-need="control" data-id="${cur.id}" data-a="screenshot">截图</button>
          <button data-act="dev" data-need="control" data-id="${cur.id}" data-a="restart" ${cur.online ? "" : "disabled"}>重启 ClassIsland</button>
          <button data-act="ci-act" data-need="manage" data-id="${cur.id}" data-a="restart_island">宿主进程重启（软）</button>
          <button class="danger" data-act="dev" data-need="control" data-id="${cur.id}" data-a="shutdown" data-confirm="1" ${cur.online ? "" : "disabled"}>关机</button>
          <button data-act="shutdown-sched" data-need="control" data-id="${esc(cur.id)}" data-name="${esc(cur.host || cur.id)}" ${cur.online ? "" : "disabled"} title="设置定时关机计划（教室端 60s 确认后生效）">定时关机</button>
        </div>
        <p class="muted" style="margin-top:8px">
          <b>切班</b>：把本机档案的当前课表群切到指定班级（集控通道下发不了
          <code>SelectedClassPlanGroupId</code>，只能由本地插件改档案）。
        </p>
        <div class="row">
          <select id="ci-group" style="min-width:220px"><option value="">（不改变）</option>${classOpts}</select>
          <button data-act="ci-switch-class" data-need="control" data-id="${cur.id}">切换课表群</button>
        </div>
      </div>

      <div class="card">
        <h3>星璃功能模块开关</h3>
        <p class="muted">
          这些开关<b>立刻生效</b>（写本机 <code>stelarith-modules.json</code> 并即时应用，无需重启）。
          带「核心」标记的模块不允许关闭 —— 关掉之后这台设备将无法被集控发现或控制。
        </p>
        <table><thead><tr><th>模块</th><th>说明</th><th>状态</th><th>操作</th></tr></thead><tbody>
        ${modules.map((m) => `<tr>
          <td>${esc(m.label)}${m.core ? ' <span class="tag">核心</span>' : ""}</td>
          <td class="muted">${esc(m.desc || "")}</td>
          <td><span class="tag ${m.enabled ? "ok" : "err"}">${m.enabled ? "已启用" : "已关闭"}</span></td>
          <td><button data-act="ci-module" data-need="control" data-id="${cur.id}" data-m="${esc(m.id)}"
                data-on="${m.enabled ? 0 : 1}" ${m.core && m.enabled ? "disabled title=\"核心模块不可关闭\"" : ""}>${m.enabled ? "关闭" : "启用"}</button></td>
        </tr>`).join("")}
        </tbody></table>
      </div>

      <div class="card">
        <h3>宿主插件清单</h3>
        <p class="muted">
          由插件的 <code>IPluginService.LoadedPlugins</code> 反射采集，是宿主的真实加载结果。
          <b>ClassIsland 没有运行时启停第三方插件的公开接口</b> —— 插件在 Plugins 目录里即加载，
          禁用只能改宿主自己的配置并重启。星集控插件标记为「核心」，面板对它只读。
        </p>
        <table><thead><tr><th>插件</th><th>ID</th><th>版本</th><th>加载状态</th></tr></thead><tbody>
        ${plugins.length
          ? plugins.map((p) => `<tr>
              <td>${esc(p.name || p.id)}${(p.isStelarith || p.is_stelarith) ? ' <span class="tag ok">星集控·核心</span>' : ""}</td>
              <td class="muted">${esc(p.id || "")}</td>
              <td>${esc(p.version || "—")}</td>
              <td><span class="tag ${p.enabled ? "ok" : ""}">${esc(p.status || (p.enabled ? "已加载" : "已禁用"))}</span>
                ${p.error ? `<br><span class="muted" style="font-size:12px;color:var(--warn)">${esc(p.error)}</span>` : ""}</td>
            </tr>`).join("")
          : emptyRow(4, "设备未上报插件清单（插件版本过旧或心跳失败）")}
        </tbody></table>
      </div>`;
  };

  // ============ 权限与分级（电教委员 / 年级 / 校级）============
  views.roles = async () => {
    const m = await API.permissions();
    if (!m) {
      return `<div class="card"><h3>权限与分级</h3>
        <p class="muted">权限信息不可用 —— 面板需在内嵌态（经网站 <code>/admin/console</code>）打开才能读取服务端解算的权限矩阵。</p></div>`;
    }
    const me = m.me || {};
    const rows = (m.roles || []).map((r) => `<tr>
        <td><b>${esc(r.label)}</b></td>
        <td>${esc(r.levelLabel)}</td>
        <td>${esc(r.managementTierLabel)}</td>
        <td>${(r.deviceTiers || []).map((t) => `<span class="tag">${esc(t)}</span>`).join(" ") || '<span class="muted">—</span>'}</td>
        <td>${esc(r.broadcastScopeLabel)}</td>
      </tr>`).join("");

    return `
      <div class="card"><h3>我的权限快照</h3>
        <p class="muted">
          等级只是<b>显示秩位</b>；<b>称号</b>才是权限的载体。网站在服务端按同一套门控逻辑解算后下发
          （<code>userCan()</code> / <code>canDevice()</code> / <code>canBroadcastTo()</code>），
          因此界面显示的能力与服务端实际放行**永远一致**。
        </p>
        <div class="grid2">
          <div class="kv">
            <div><span class="muted">角色</span><b>${esc(me.roleLabel || "—")}</b></div>
            <div><span class="muted">显示秩位</span><b>${esc(me.levelLabel || "—")}</b></div>
            <div><span class="muted">管理分级</span><b>${esc(me.managementTierLabel || "—")}</b></div>
          </div>
          <div class="kv">
            <div><span class="muted">我的称号</span><b>${(me.titleLabels || []).map((t) => esc(t)).join(" / ") || "无"}</b></div>
            <div><span class="muted">设备能力</span><b>${(me.deviceTiers || []).map((t) => NEED_LABEL_DEVICE[t] || t).join(" / ") || "无"}</b></div>
            <div><span class="muted">广播范围</span><b>${esc(me.broadcastScopeLabel || "不可广播")}</b></div>
          </div>
        </div>
        ${me.managementTierDescription ? `<p class="muted">${esc(me.managementTierDescription)}</p>` : ""}
      </div>

      <div class="card"><h3>管理分级（谁管到哪一级）</h3>
        <p class="muted">
          分级回答「管到哪一级」，与「称号（能做什么）」「设备轴（设备多敏感）」「广播范围（能喊多远）」
          是四条独立轴。分级只是<b>上限</b>：校级管理员若没有 <code>device.remote</code>，依然不能远控。
        </p>
        <table><thead><tr><th>分级</th><th>职责边界</th><th>对应角色</th></tr></thead><tbody>
          ${(m.managementTiers || []).map((t) => `<tr>
            <td><b>${esc(t.label)}</b></td>
            <td class="muted">${esc(t.description)}</td>
            <td>${(t.roles || []).map((x) => `<span class="tag">${esc(x)}</span>`).join(" ") || '<span class="muted">—</span>'}</td>
          </tr>`).join("")}
        </tbody></table>
      </div>

      <div class="card"><h3>角色 → 能力对照</h3>
        <table><thead><tr><th>角色</th><th>内容等级</th><th>管理分级</th><th>设备能力</th><th>广播范围</th></tr></thead><tbody>${rows}</tbody></table>
      </div>

      <div class="card"><h3>内容等级轴（L1–L5）</h3>
        <p class="muted">纵向：等级高的自动继承低等级的全部能力。这是「在一个个叠加」，不是另起一类。</p>
        ${(m.levels || []).map((g) => `
          <div style="margin-bottom:10px">
            <b>${esc(g.label)}</b> <span class="muted">— ${esc(g.description)}</span><br>
            ${(g.actions || []).map((a) => `<span class="tag">${esc(a.label)}</span>`).join(" ")}
          </div>`).join("")}
      </div>

      <div class="card"><h3>设备轴与广播范围轴</h3>
        <div class="grid2">
          <div>
            <b>设备轴</b>
            <table><thead><tr><th>档位</th><th>含义</th><th>持有角色</th></tr></thead><tbody>
            ${(m.deviceTiers || []).map((t) => `<tr>
              <td><span class="tag">${esc(t.label)}</span></td>
              <td class="muted">${esc(t.description)}</td>
              <td>${(t.roles || []).join(" / ") || "—"}</td>
            </tr>`).join("")}
            </tbody></table>
          </div>
          <div>
            <b>广播可达范围</b>
            <table><thead><tr><th>范围</th><th>持有角色</th></tr></thead><tbody>
            ${(m.broadcastScopes || []).map((s) => `<tr>
              <td><span class="tag">${esc(s.label)}</span></td>
              <td>${(s.roles || []).join(" / ") || "—"}</td>
            </tr>`).join("")}
            </tbody></table>
            <p class="muted" style="margin-top:8px">「能广播」与「能广播到多大范围」是两件事：电教委员喊一句只到本班，不会弹到全校大屏。</p>
          </div>
        </div>
      </div>`;
  };

  // ============ 班级管理：文件夹式 + 快捷选择（#182）============
  //
  // 为什么要有这一页：班级在 #177 之后是**独立实体**（主键/编号/属主/审核态），
  // 不再由课表文件派生。但面板此前只有顶栏一个下拉 —— 于是「建一个班」
  // 「看哪些班待我审」「这个班到底绑了几台设备」在界面上完全没有落点，
  // 只能靠直接打后端接口。这一页把这些补齐。
  //
  // 数据来源刻意用 `/class/list` 的**原始记录**（listClassEntities），而不是
  // 已经为下拉裁剪过的 listClasses：审核态、属主、届/班号都在原始记录里，
  // 下拉那份为了显示人话把不少字段丢了。
  let classAdminCache = [];

  /** 审核态 → 徽标（后端值见 class_model.REVIEW_*：pending/approved/rejected）。 */
  const REVIEW_BADGE = {
    approved: { text: "已审核", cls: "ok" },
    pending: { text: "待审核", cls: "warn" },
    rejected: { text: "已驳回", cls: "err" },
  };

  /**
   * 该班能否被「设为当前班级」。
   * 两个条件缺一不可：过审（未过审的班不该被下发）+ 有课表资源
   * （没有资源时选中它 = 课表页打开是空白，而标题显示一个与班级无关的资源名）。
   */
  function classSelectable(c) {
    return !!c && c.review_status === "approved" && !!c.class_plan && !/^default_/i.test(c.class_plan);
  }

  /** 设为当前班级（快捷选择与卡片按钮共用；手动选过就不再被自动校准覆盖）。 */
  function pickClass(classId) {
    const rec = classAdminCache.find((c) => c.class_id === classId);
    if (!rec) { toast("找不到该班级，请刷新后重试"); return false; }
    if (!classSelectable(rec)) {
      toast(rec.review_status !== "approved" ? "该班尚未通过审核，不能作为当前班级" : "该班还没有课表资源，无法切换");
      return false;
    }
    API.setClass(rec.class_plan);
    classAutoChosen = false;   // 用户明确选过：后续 syncClassSelection 不再覆盖
    const sel = $("#class-select");
    if (sel) sel.value = API.state.classId;
    toast(`已切换到 ${rec.code || rec.name || rec.class_id}`);
    return true;
  }

  views.classes = async () => {
    const canReview = allow("manage");
    const [raw, pending] = await Promise.all([
      API.listClassEntities(),
      // 审核队列要求 manage 档：没有权限就**不发**这个请求 ——
      // 每次开页都打一次 403，会被 CCProtectMiddleware 累计成同 IP 封禁，
      // 而封禁期间**连命令轮询都会被拒**（面板整体假死）。
      canReview ? API.listPendingClasses() : Promise.resolve({ count: 0, classes: [] }),
    ]);
    classAdminCache = Array.isArray(raw) ? raw : [];
    const list = classAdminCache;

    // 文件夹式分组：按「届」归拢；无届的历史班单独一个文件夹（不静默丢掉）。
    const groups = new Map();
    for (const c of list) {
      const k = c.graduation_year ? String(c.graduation_year) : "";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    // 高届在前（新班在上）；「未分届」永远排最后（它是历史遗留，不是待办重点）。
    const keys = [...groups.keys()].sort((a, b) => {
      if (!a) return 1;
      if (!b) return -1;
      return Number(b) - Number(a);
    });

    const cur = API.state.classId;
    const selectable = list.filter(classSelectable);
    const defYear = new Date().getFullYear();

    const folderHtml = keys.length
      ? keys
          .map((k) => {
            const items = groups.get(k).slice().sort(
              (a, b) =>
                (a.class_number || 0) - (b.class_number || 0) ||
                String(a.code || a.name || "").localeCompare(String(b.code || b.name || ""), "zh-Hans-CN")
            );
            const devTotal = items.reduce((n, c) => n + (c.device_count || 0), 0);
            const cards = items
              .map((c) => {
                const badge = REVIEW_BADGE[c.review_status] || { text: c.review_status || "未知", cls: "" };
                const isCur = !!c.class_plan && c.class_plan === cur;
                const canPick = classSelectable(c);
                const whyNot = c.review_status !== "approved"
                  ? "尚未通过审核，不能作为当前班级"
                  : (!c.class_plan ? "该班还没有课表资源" : "该班课表资源是全校共享的默认资源，需先导入自己的课表");
                return `
                  <article class="cls-card ${isCur ? "current" : ""}">
                    <header>
                      <b>${esc(c.code || c.name || c.class_id)}</b>
                      <span class="tag ${badge.cls}">${esc(badge.text)}</span>
                    </header>
                    <div class="cls-meta">
                      <span><i>主键</i><em>${esc(c.class_id || "—")}</em></span>
                      <span><i>课表</i><em>${esc(c.class_plan || "（尚未生成）")}</em></span>
                      <span><i>设备</i><em>${c.device_count || 0} 台</em></span>
                      <span><i>属主</i><em>${esc(c.owner_user_id || "系统 / 无属主")}</em></span>
                    </div>
                    ${c.review_status === "rejected" && c.reject_reason
                      ? `<div class="muted" style="font-size:12px;color:var(--err)">驳回原因：${esc(c.reject_reason)}</div>`
                      : ""}
                    <div class="cls-act">
                      <button class="chip-btn ${isCur ? "on" : ""}" data-act="cls-pick" data-id="${esc(c.class_id)}"
                        ${canPick ? "" : `disabled title="${esc(whyNot)}"`}>
                        ${isCur ? "当前班级" : "设为此班"}
                      </button>
                      <button class="chip-btn" data-act="cls-devices" data-id="${esc(c.class_id)}"
                        title="到「设备控制」页按该班筛选">看设备</button>
                    </div>
                  </article>`;
              })
              .join("");
            return `
              <section class="cls-folder">
                <header>
                  <b>${esc(k ? k + " 届" : "未分届（历史班级）")}</b>
                  <span class="muted">${items.length} 个班 · ${devTotal} 台设备</span>
                </header>
                <div class="cls-cards">${cards}</div>
              </section>`;
          })
          .join("")
      : `<div class="card"><p class="muted">该账户下还没有班级。用上面的表单登记一个；若是首次接入，可直接从「ClassIsland 专页」导入官方档案一次切出全部班级。</p></div>`;

    // 快捷选择条：只列**可选**的班，是「今天要看哪个班」的最短路径。
    const quickHtml = selectable.length
      ? selectable
          .map((c) => {
            const on = c.class_plan === cur;
            return `<button class="chip-btn ${on ? "on" : ""}" data-act="cls-pick" data-id="${esc(c.class_id)}"
              title="课表资源：${esc(c.class_plan)}">${esc(c.code || c.name || c.class_id)}</button>`;
          })
          .join(" ")
      : `<span class="muted">暂无可切换的班级（需「已审核」且已生成自己的课表资源）</span>`;

    // 待审队列（manage 档可见）。驳回原因走行内输入框而非 prompt()：
    // prompt 在部分 webview 里被禁用，而「驳回」恰恰需要留下理由给申请人看。
    const pendingHtml = !canReview
      ? ""
      : `
      <div class="card"><h3>待审核班级 <span class="tag ${pending.count ? "warn" : ""}">${pending.count || 0}</span></h3>
        ${
          (pending.classes || []).length
            ? `<table><thead><tr><th>班级</th><th>届 / 班号</th><th>提交人</th><th>驳回原因</th><th>操作</th></tr></thead><tbody>
          ${(pending.classes || [])
            .map(
              (p) => `<tr>
            <td><b>${esc(p.code || p.name || p.class_id)}</b><br><span class="muted" style="font-size:12px">${esc(p.class_id)}</span></td>
            <td>${esc(String(p.graduation_year ?? "—"))} / ${esc(String(p.class_number ?? "—"))}</td>
            <td class="muted">${esc(p.owner_user_id || "—")}</td>
            <td><input class="cls-rej" data-rej="${esc(p.class_id)}" placeholder="（可选）" aria-label="驳回原因" /></td>
            <td class="row">
              <button class="chip-btn" data-act="cls-approve" data-id="${esc(p.class_id)}">通过</button>
              <button class="chip-btn" data-act="cls-reject" data-id="${esc(p.class_id)}">驳回</button>
            </td>
          </tr>`
            )
            .join("")}
          </tbody></table>
          <p class="muted" style="margin-top:8px">通过后该班才可被绑定设备、下发课表与广播。驳回请尽量写明原因 —— 它是申请人唯一能看到的反馈。</p>`
            : `<p class="muted">暂无待审班级。</p>`
        }
      </div>`;

    return `
      <div class="card"><h3>快捷选择</h3>
        <p class="muted">点一个班即把它设为<b>当前班级</b>——课表、配置下发、广播定向都以它为准（等价于顶栏下拉，但不用先滚回顶部）。</p>
        <div class="row wrap" style="margin-top:8px">${quickHtml}</div>
      </div>

      <div class="card"><h3>登记新班级</h3>
        <div class="row" style="margin-top:4px">
          <label class="muted">届 <input id="cls-year" type="number" min="2000" max="2100" value="${defYear}" style="width:88px" aria-label="届" /></label>
          <label class="muted">班号 <input id="cls-num" type="number" min="1" max="99" style="width:74px" aria-label="班号" /></label>
          <label class="muted">名称（可选） <input id="cls-name" type="text" placeholder="留空则用「届+班号」" style="width:170px" aria-label="班级名称" /></label>
          <button class="chip-btn" data-act="cls-create" data-need="control">创建班级</button>
        </div>
        <p class="muted" style="margin-top:8px">
          主键与编号由「届 + 班号」确定性生成（<code>2025</code> + <code>3</code> → <code>class_2025_3</code> / <code>2025届3班</code>），
          因此重名会直接报冲突，不会悄悄建出两个「3班」。
          ${canReview ? "你具备审核权，创建后<b>直接生效</b>。" : "创建后进入<b>待审核</b>状态，通过审核前不能绑定设备。"}
        </p>
      </div>

      ${pendingHtml}

      <div class="card"><h3>班级（按届归拢）</h3>
        <p class="muted">共 ${list.length} 个班级，其中 ${selectable.length} 个可用于切换。同一届的班放在同一个文件夹里，便于「这一届还有哪些班没接入」一眼看出来。</p>
      </div>
      <div class="cls-folders">${folderHtml}</div>`;
  };

  views.voicehub = async () => {
    // 队列取不到不阻断内嵌（点歌站本身才是主功能区）
    let now = null;
    let queue = [];
    try {
      const r = await API.voicehubList();
      now = r.now;
      queue = r.queue || [];
    } catch (_) { /* 未配置点歌站或站点不可达：下面照常渲染内嵌区与空队列 */ }

    const host = (API.state.voicehubHost || "").replace(/\/+$/, "");
    // 内嵌地址：站点根。拼 `?embed=1` 供点歌站自行收敛外壳（未实现也无副作用）。
    const embedUrl = host ? host + "/?embed=1" : "";
    // ⚠️ sandbox 取舍（「防跳转 + 防关闭」的技术落点）：
    //   allow-scripts       —— 页面要能跑
    //   allow-same-origin   —— 保留自身 origin，否则 cookie/存储全废，点歌站会退化成未登录
    //   allow-forms         —— 点歌站有搜索/提交表单
    //   allow-modals        —— 站点可能用 alert 提示「已提交」，不加会静默失败
    // **故意不给**：
    //   allow-top-navigation(-by-user-activation) —— 否则站内点链接会把整个集控面板顶掉
    //   allow-popups                              —— 否则能弹新窗口跳出面板；同时 window.close() 也失效
    // 即：它只能在自己那一格画框里活动，既跳不出去，也关不掉自己。
    const sandbox = "allow-scripts allow-same-origin allow-forms allow-modals";
    const sameOriginWarn =
      host && location.origin && host.indexOf(location.origin) === 0
        ? `<p class="muted" style="color:var(--warn)">⚠ 点歌站与本站同源：此时 sandbox 的 allow-same-origin + allow-scripts 组合会削弱隔离效果，建议把点歌站放在独立域/端口。</p>`
        : "";

    return `
      <div class="card"><h3>校园点歌</h3>
        <div class="row">
          <button class="primary" data-act="vh-push" data-need="control">推送到本班屏幕</button>
          <button data-act="vh-refresh">刷新</button>
          <span class="grow"></span>
          <span class="muted">${host ? "已内嵌点歌站" : "未配置点歌站地址（在「连接设置」里填写）"}</span>
        </div>
        ${
          host
            ? `<div class="vh-frame-wrap">
                 <iframe id="vh-frame" class="vh-frame" src="${esc(embedUrl)}"
                   sandbox="${sandbox}"
                   referrerpolicy="no-referrer"
                   title="校园点歌站"></iframe>
               </div>
               <p class="muted">
                 已限制：页面<b>无法跳转或替换集控面板</b>、<b>无法弹出新窗口</b>、<b>无法自行关闭</b>；
                 点歌站仅在自己这一格内运行。需要用别的地址时，由管理员在「连接设置」里修改。
               </p>
               ${sameOriginWarn}`
            : `<p class="muted">在「连接设置」里填写点歌站地址后，这里会内嵌显示，不会跳出集控面板。</p>`
        }
      </div>

      <div class="card"><h3>屏幕同步</h3>
        <p class="muted">
          点「推送到本班屏幕」会把<b>当前播放 + 队列</b>写入 CIMS 资源 <code>songboard</code>，
          由 ClassIsland 点歌看板插件拉取上屏。数据来自 voicehub 公开 API。
        </p>
        <h4 style="margin:14px 0 6px">正在播放</h4>
        ${
          now
            ? `<div class="song-now"><b>${esc(now.title)}</b> — ${esc(now.artist || "")}<span class="muted"> · ${esc(now.by || "")} · ${esc(now.at || "")}</span></div>`
            : `<p class="muted">暂无播放中曲目</p>`
        }
        <h4 style="margin:14px 0 6px">待播队列（${queue.length}）</h4>
        <table><thead><tr><th>歌曲</th><th>点歌人</th><th>票数</th><th>提交时间</th></tr></thead><tbody>
          ${queue.length ? queue.map((s) => `<tr><td>${esc(s.title)}</td><td>${esc(s.by || "")}</td><td>${esc(s.votes || 0)}</td><td>${esc(s.at || "")}</td></tr>`).join("") : emptyRow(4, "队列为空")}
        </tbody></table>
      </div>

      <div class="card"><h3>为本班点歌</h3>
        <div class="row">
          <input id="vh-title" placeholder="歌曲名" style="flex:1"/>
          <input id="vh-artist" placeholder="歌手（可选）" style="flex:1"/>
          <button class="primary" data-act="vh-request">提交点歌</button>
        </div>
        <p class="muted">提交经 voicehub 公开 API（需具备 songs:request 权限的 API Key）。</p>
      </div>`;
  };

  // 广播范围档 → 中文（与后端 permissions.ts 的 scopeFromLabel 对齐；
  // 服务端按文案反推档位，所以这里 option 的 value 必须用中文。）
  const SCOPE_LABEL = { class: "本班", grade: "本年级", school: "全校" };

  views.notify = async () => {
    // 历史通知 + 学院班级清单（多选定向用）。班级清单取不到不影响历史展示。
    const [ns, classes] = await Promise.all([
      API.listNotices(),
      API.listClassEntities().catch(() => []),
    ]);
    // 有权限的广播范围；内嵌态未下发（bscopes 空）= 仅本班（宁少不多）
    const scopes =
      PERM.bscopes && PERM.bscopes.length
        ? PERM.bscopes
        : PERM.embedded
          ? ["class"]
          : ["class", "grade", "school"];
    const scopeOpts = ["class", "grade", "school"]
      .filter((s) => scopes.includes(s))
      .map((s) => `<option value="${SCOPE_LABEL[s]}">${SCOPE_LABEL[s]}</option>`)
      .join("");
    const maxLabel = SCOPE_LABEL[scopes[scopes.length - 1]] || "本班";

    // 通道 → 中文标签（让「同一条内容走过多条通道」一眼可辨）
    const chanLabel = (c) =>
      ({ notice: "面板通知", chat: "群内喊话", announcement: "网站公告" }[c] || c || "—");

    return `
      <div class="card"><h3>发布通知</h3>
        <div class="row">
          <input id="nt-title" placeholder="通知标题" style="flex:1"/>
          <select id="nt-scope" title="广播范围（受账号权限限制）">${scopeOpts}</select>
          <input id="nt-duration" type="number" min="0" max="3600" step="1" placeholder="时长(秒)"
                 title="教室大屏显示时长（秒）。留空 = 按正文字数自适应（3~20s）"
                 style="width:96px"/>
          <button class="primary" data-act="send-notice" data-need="control">发布</button>
        </div>
        <textarea id="nt-content" placeholder="通知正文（可空）" style="min-height:64px"></textarea>

        <div class="row" style="margin-top:4px">
          <span class="muted" style="width:88px">目标班级</span>
          <span class="muted" style="font-size:12px">
            可多选（定向推送，只推选中班级的设备）；不选则按上方「范围」决定。
          </span>
        </div>
        <div class="grid g4" style="gap:6px 10px">
          ${
            classes.length
              ? classes
                  .map(
                    (c) => `<label class="row" style="gap:6px">
                      <input type="checkbox" class="nt-cls" value="${esc(c.name)}"/>
                      <span>${esc(c.name)}</span>
                      <span class="muted" style="font-size:12px">${c.device_count || 0} 台</span>
                    </label>`
                  )
                  .join("")
              : `<p class="muted" style="grid-column:1/-1">暂无班级（需先在 CIMS 导入/创建班级并绑定设备）</p>`
          }
        </div>
        ${
          classes.length
            ? `<div class="row" style="margin-top:6px">
                 <button data-act="nt-cls-all">全选</button>
                 <button data-act="nt-cls-none">清空</button>
                 <button data-act="nt-cls-mine">仅本班${PERM.className ? "（" + esc(PERM.className) + "）" : ""}</button>
               </div>`
            : ""
        }
        <p class="muted" style="margin-top:8px">
          本账号可广播的最大范围：<b>${esc(maxLabel)}</b>
          ${
            PERM.embedded && !PERM.control
              ? "（无设备控制权限，无法发布）"
              : "。范围由内容等级决定：L2 仅本班 · L3 本年级 · L4+ 全校。"
          }
        </p>
        <p class="muted">
          发布后会经 CIMS 命令通道推送到目标教室大屏；同内容在 30 秒内重复提交会被自动去重，
          不会让设备弹两次。
        </p>
      </div>

      <div class="card"><h3>历史通知</h3>
        <div class="row" style="margin-bottom:8px">
          <select id="nt-filter">
            <option value="">全部班级</option>
            ${classes.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join("")}
          </select>
          <button data-act="reload">刷新</button>
          <span class="muted" style="font-size:12px">共 ${ns.length} 条</span>
        </div>
        <table><thead><tr>
          <th style="width:110px">时间</th><th>标题</th><th style="width:80px">范围</th>
          <th style="width:150px">目标班级</th><th style="width:88px">通道</th><th style="width:64px">送达</th>
        </tr></thead><tbody>
        ${
          ns.length
            ? ns
                .map(
                  (n) => `<tr>
                    <td class="muted">${esc(n.at)}</td>
                    <td>${esc(n.title)}</td>
                    <td><span class="tag ${({ 本班: "ok", 全校: "warn", 本年级: "accent" }[n.scope]) || ""}">${esc(n.scope)}</span></td>
                    <td class="muted">${n.classes.length ? esc(n.classes.join("、")) : "—"}</td>
                    <td class="muted">${esc(chanLabel(n.channel))}</td>
                    <td>${n.sent ? `<span class="tag ok">${n.sent}</span>` : `<span class="tag err">0</span>`}</td>
                  </tr>`
                )
                .join("")
            : emptyRow(6, "暂无通知记录")
        }
        </tbody></table>
      </div>`;
  };

  let chatRoom = API.CHAT_ROOM_GLOBAL || "techrep-global";
  // 私聊对端（选了某个好友后指向其 id/昵称）；非空时 chatRoom 会切成 dm 房间。
  let chatPeer = null;

  views.chat = async () => {
    const [ms, fr] = await Promise.all([
      API.listChat(chatRoom),
      API.listFriends().catch(() => ({ friends: [], incoming: [], outgoing: [] })),
    ]);
    const classId = API.state.classId || "";
    const roomOpts = [
      { id: API.CHAT_ROOM_GLOBAL || "techrep-global", name: "全校电教委员群" },
      PERM.gradeName ? { id: API.gradeRoom(PERM.gradeName), name: "本年级（" + PERM.gradeName + "）" } : null,
      classId ? { id: classId, name: "本班（" + classId + "）" } : null,
    ].filter(Boolean);
    const curName = (roomOpts.find((r) => r.id === chatRoom) || {}).name || chatRoom;

    // 好友区：待处理请求置顶（需要动作），然后是好友列表（点「私聊」进会话）
    const reqRows = fr.incoming
      .map(
        (f) => `<div class="li">
          <span class="li-name">${esc(f.peerName)}</span>
          <span class="grow"></span>
          <button class="primary" data-act="fr-accept" data-id="${f.peerId}">接受</button>
          <button data-act="fr-reject" data-id="${f.peerId}">拒绝</button>
        </div>`
      )
      .join("");
    const friendRows = fr.friends
      .map(
        (f) => `<div class="li">
          <span class="li-dot on"></span>
          <span class="li-name">${esc(f.peerName)}</span>
          <span class="grow"></span>
          <button data-act="fr-dm" data-id="${f.peerId}" data-name="${esc(f.peerName)}">私聊</button>
          <button data-act="fr-remove" data-id="${f.peerId}" title="删除好友">✕</button>
        </div>`
      )
      .join("");
    const outRows = fr.outgoing
      .map(
        (f) => `<div class="li">
          <span class="li-name">${esc(f.peerName)}</span>
          <span class="tag warn">待对方接受</span>
          <span class="grow"></span>
          <button data-act="fr-remove" data-id="${f.peerId}" title="撤回申请">撤回</button>
        </div>`
      )
      .join("");

    return `
      <div class="card"><h3>班级交流 · 跨班互通</h3>
        <div class="row">
          <select id="chat-room">
            ${roomOpts.map((r) => `<option value="${esc(r.id)}" ${r.id === chatRoom ? "selected" : ""}>${esc(r.name)}</option>`).join("")}
            ${chatPeer ? `<option value="${esc(API.dmRoom(PERM.uid, chatPeer.id))}" selected>与 ${esc(chatPeer.name)} 私聊</option>` : ""}
          </select>
          <span class="muted">切换房间，不同班级/群组消息隔离</span>
        </div>
        <div class="log" style="min-height:180px;margin-top:8px">
          ${
            ms.length
              ? ms
                  .map(
                    (m) => `<div style="margin:4px 0">
            <b>${esc(m.from)}</b> <span class="muted">${esc(m.room || "")} · ${esc(m.at)}</span><br/>${esc(m.text)}</div>`
                  )
                  .join("")
              : `<p class="muted">「${esc(curName)}」暂无消息，发一条试试。</p>`
          }
        </div>
        <div class="row" style="margin-top:8px">
          <input id="chat-text" placeholder="在「${esc(curName)}」输入消息，回车发送" style="flex:1"/>
          <button class="primary" data-act="send-chat">发送</button>
        </div>
        <p class="muted">全校电教委员群用于跨班互助；本班房间仅本班可见。带 @全体 / @all 的消息会自动升级为大屏广播（范围受你的权限上限约束）。</p>
      </div>

      <div class="card"><h3>好友</h3>
        <div class="row" style="margin-bottom:8px">
          <input id="fr-q" placeholder="搜索用户名 / 昵称 / 班级，添加好友" style="flex:1"/>
          <button data-act="fr-search">搜索</button>
        </div>
        <div id="fr-results" class="list"></div>

        ${
          fr.incoming.length
            ? `<h4 style="margin:12px 0 6px">待处理请求（${fr.incoming.length}）</h4><div class="list">${reqRows}</div>`
            : ""
        }
        ${
          fr.outgoing.length
            ? `<h4 style="margin:12px 0 6px">已发出（${fr.outgoing.length}）</h4><div class="list">${outRows}</div>`
            : ""
        }
        <h4 style="margin:12px 0 6px">我的好友（${fr.friends.length}）</h4>
        <div class="list">${friendRows || `<p class="muted">还没有好友，搜索同学添加吧。</p>`}</div>
        <p class="muted">好友之间可私聊（会话按房间隔离，只有双方能发言）；服务端按当前登录用户校验关系，无法替他人建立或答应好友。</p>
      </div>`;
  };

  // ============ 预设模板（故障上报 / Bug 反馈）============
  // 为什么要有模板：这两类表单之前是**全空白输入**，结果收上来的工单
  // 「投影坏了」四个字，维护者还得回头问是哪台、什么现象、试过什么。
  // 模板把「该说清什么」前置到选择那一步：选一个场景 → 标题/描述/等级自动填好，
  // 报修人只需补关键信息。模板 id 一并写进 labels，后续可按类型统计。
  const REPORT_TEMPLATES = [
    {
      id: "projector",
      label: "投影/一体机不亮",
      level: "高",
      title: "投影不亮",
      desc: "· 现象：按开机键后无画面 / 有画面但无背光\n· 已试：检查电源、HDMI 线两端重插、切换信号源\n· 影响：本节无法正常上课\n· 补充：（何时开始 / 是否只此一台）",
    },
    {
      id: "no-signal",
      label: "电脑无信号",
      level: "高",
      title: "电脑无信号输出",
      desc: "· 现象：一体机提示「无信号」\n· 已试：换线、换接口、重启电脑\n· 影响：\n· 补充：",
    },
    {
      id: "audio",
      label: "音箱/话筒无声",
      level: "中",
      title: "音响无声",
      desc: "· 现象：播放音频无声音 / 有杂音\n· 已试：调音量、检查静音、换插孔\n· 涉及设备：音箱 / 话筒 / 功放\n· 影响：\n· 补充：",
    },
    {
      id: "network",
      label: "网络不通",
      level: "中",
      title: "教室网络不通",
      desc: "· 现象：无法上网 / 时断时续\n· 已试：插拔网线、重启电脑\n· 影响：集控下发与点歌是否受影响\n· 补充：",
    },
    {
      id: "classisland",
      label: "ClassIsland 异常",
      level: "中",
      title: "ClassIsland 显示异常",
      desc: "· 现象：课表不显示 / 时间不对 / 卡在启动页\n· 是否已重启软件：\n· 插件是否在线（集控面板可见）：\n· 补充：",
    },
    {
      id: "controller",
      label: "中控/面板故障",
      level: "低",
      title: "中控面板故障",
      desc: "· 现象：按键无反应 / 屏不亮 / 误触\n· 影响：\n· 补充：",
    },
    {
      id: "other",
      label: "其他（自行描述）",
      level: "中",
      title: "",
      desc: "· 现象：\n· 已试：\n· 影响：\n· 补充：",
    },
  ];

  const BUG_TEMPLATES = [
    {
      id: "feature",
      label: "功能异常（该做没做/结果不对）",
      title: "功能异常：",
      steps: "1) 进入……页面\n2) 点击……\n3) 期望：……\n4) 实际：……",
      hint: "请说明页面路径与操作顺序，附上实际结果截图更佳。",
    },
    {
      id: "ui",
      label: "界面错乱（布局/文字/样式）",
      title: "界面错乱：",
      steps: "1) 所在页面：\n2) 出问题的区域：\n3) 期望样式：\n4) 实际样式：",
      hint: "请注明浏览器/系统与窗口大小；若只是窄屏错位，说明分辨率即可。",
    },
    {
      id: "crash",
      label: "崩溃闪退（程序挂掉）",
      title: "崩溃闪退：",
      steps: "1) 崩溃前最后一步操作：\n2) 是否可复现（必现/偶现）：\n3) 复现频率：\n4) 有无报错弹窗：",
      hint: "崩溃类务必贴日志，否则很难定位。",
    },
    {
      id: "sync",
      label: "数据不同步（改了没生效）",
      title: "数据不同步：",
      steps: "1) 在哪里改的：\n2) 改了之后期待生效的位置：\n3) 等了多久：\n4) 实际现象：",
      hint: "请说明是集控面板、ClassIsland 还是一个体机侧。",
    },
    {
      id: "perf",
      label: "性能卡顿（慢/无响应）",
      title: "性能问题：",
      steps: "1) 场景：\n2) 卡顿表现与持续时长：\n3) 设备配置：\n4) 是否与数据量相关：",
      hint: "请说明设备配置与数据规模（如班级数、设备数）。",
    },
    {
      id: "other",
      label: "其他（自行描述）",
      title: "",
      steps: "1) 现象：\n2) 期望：\n3) 复现步骤：",
      hint: "",
    },
  ];

  views.report = async () => {
    const rs = await API.listReports();
    const opts = REPORT_TEMPLATES.map(
      (t) => `<option value="${esc(t.id)}">${esc(t.label)}</option>`
    ).join("");
    return `
      <div class="card"><h3>故障上报</h3>
        <p class="muted">
          先选一个场景模板：标题、位置字段与默认紧急程度会自动填好，你只需补充关键信息。
          模板类型随工单一起记录，便于按类型统计与排优先级。
        </p>
        <div class="row">
          <span class="muted" style="width:64px">故障类型</span>
          <select id="rp-tpl">${opts}</select>
          <input id="rp-title" placeholder="故障标题" style="flex:1"/>
          <select id="rp-level" title="紧急程度"><option>高</option><option>中</option><option>低</option></select>
        </div>
        <textarea id="rp-desc" placeholder="按模板骨架补充：现象、已试过什么、影响范围"></textarea>
        <p class="muted" id="rp-hint">选模板后这里会给出填写提示。</p>
        <div class="row"><button class="primary" data-act="submit-report">提交工单</button></div>
      </div>
      <div class="card"><h3>我的工单</h3>
        <table><thead><tr><th>标题</th><th>类型</th><th>等级</th><th>状态</th><th>时间</th></tr></thead><tbody>
        ${
          rs.length
            ? rs
                .map(
                  (r) => `<tr><td>${esc(r.title)}</td><td class="muted">${esc(r.template || "—")}</td>
          <td>${esc(r.level)}</td>
          <td><span class="tag ${r.status === "已解决" ? "ok" : "warn"}">${esc(r.status)}</span></td>
          <td>${esc(r.at)}</td></tr>`
                )
                .join("")
            : emptyRow(5, "还没有提交过工单")
        }
        </tbody></table></div>`;
  };

  views.bug = async () => {
    const bs = await API.listBugs();
    const opts = BUG_TEMPLATES.map(
      (t) => `<option value="${esc(t.id)}">${esc(t.label)}</option>`
    ).join("");
    return `
      <div class="card"><h3>提交 Bug</h3>
        <p class="muted">
          先选一个 Bug 类型模板：复现步骤骨架会自动填好，照着补数字即可。
          类型标签随工单一并提交，方便按类别归集。
        </p>
        <div class="row">
          <span class="muted" style="width:64px">Bug 类型</span>
          <select id="bg-tpl">${opts}</select>
          <input id="bg-title" placeholder="问题标题" style="flex:1"/>
        </div>
        <textarea id="bg-steps" placeholder="复现步骤（模板已给出骨架）"></textarea>
        <textarea id="bg-log" placeholder="相关日志（ClassIsland / CIMS / 面板控制台报错）" style="min-height:80px"></textarea>
        <p class="muted" id="bg-hint">选模板后这里会给出该类型的补充要求。</p>
        <div class="row"><button class="primary" data-act="submit-bug" data-need="issue">提交</button>
          <span class="muted">提交内容含类型标签与环境信息，便于维护者定位。</span></div>
      </div>
      <div class="card"><h3>我提交的</h3>
        <table><thead><tr><th>标题</th><th>类型</th><th>状态</th><th>时间</th></tr></thead><tbody>
        ${
          bs.length
            ? bs
                .map(
                  (b) => `<tr><td>${esc(b.title)}</td><td class="muted">${esc(b.template || "—")}</td>
          <td>${esc(b.status)}</td><td>${esc(b.at)}</td></tr>`
                )
                .join("")
            : emptyRow(4, "还没有提交过 Bug")
        }
        </tbody></table></div>`;
  };

  views.audit = async () => {
    const logs = await API.listAudit();
    // 完整性自检。拿不到结果时显示「未校验」—— 安全结论不允许伪装成「通过」。
    const v = await API.auditVerify();
    const chip = !v
      ? `<span class="tag warn">未校验</span>`
      : v.ok
        ? `<span class="tag ok">链完整</span>`
        : `<span class="tag err">链断裂</span>`;
    const integrity = !v
      ? `<p class="muted">后端未提供完整性校验（或本部署尚未启用），本行只表示「未校验」，不代表通过。</p>`
      : `<p class="muted">
           已校验 <b>${v.checked}</b> 条${
             v.legacyRows
               ? `；另有 <b>${v.legacyRows}</b> 条启用哈希链之前的旧记录，无哈希、无法校验（如实跳过，不算异常）`
               : ""
           }。<br>
           算法 <b>${esc(v.mode)}</b>${
             v.mode === "sha256"
               ? "（未配置 CONSOLE_AUDIT_KEY，只能防「随手改一行」；配了密钥才防得住整表重写）"
               : "（有密钥：即使能改库，没有密钥也造不出自洽的链）"
           }。<br>
           保留策略 <b>${v.retentionDays}</b> 天${
             v.prunedBefore ? `，已裁剪 ${esc(v.prunedBefore)} 之前的记录（裁剪动作本身也留痕）` : ""
           }。
         </p>
         ${
           v.tailOk
             ? ""
             : `<p class="muted" style="color:var(--err)">⚠ 链尾与登记值不一致 —— 最后若干条记录可能被删除。</p>`
         }
         ${
           v.ok
             ? ""
             : `<p class="muted" style="color:var(--err)">⚠ 第一处异常在 #${v.firstBadId}：${esc(v.problem || "未知")}</p>`
         }`;
    return `<div class="card"><h3>日志完整性 ${chip}</h3>
        <p class="muted">
          每条操作记录都带着一串哈希，且与上一条首尾相连。改一行、删一行、插入一行都会让链对不上 ——
          这样「谁在哪个班对哪台设备做了什么」才有资格被当作证据。
        </p>
        ${integrity}
        <div class="row">
          <button data-act="reload">刷新</button>
          <button data-act="audit-verify">重新校验</button>
          <button data-act="audit-prune" data-need="manage">按保留期裁剪</button>
        </div>
      </div>
      <div class="card"><h3>操作日志</h3>
      <p class="muted">集控内的关键操作（下发课表/配置、设备指令、通知、远程控制、点歌推送）都会在此留痕，便于事后追溯。</p>
      <table><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>详情</th></tr></thead><tbody>
      ${logs.length ? logs.map(a=>`<tr><td>${esc(a.at)}</td><td>${esc(a.who)}</td><td><span class="tag" title="${esc(a.rawAct||a.act)}">${esc(a.act)}</span></td><td>${esc(a.target)}</td><td class="muted">${esc(a.detail||"")}</td></tr>`).join("") : emptyRow(5, "暂无操作记录")}
      </tbody></table></div>`;
  };

  // ============ 六段链路 · 分段探针（开发者选项 / 测试页共用）============
  //
  // 面板上「某个功能不工作」时，六段链路（面板 → 站点代理 → CIMS → 命令队列 → 插件 →
  // 教室端）断在哪一段，**界面上长得一模一样** —— 都是"没反应"。逐段各发一个最小只读
  // 请求，把每段自己的结论、状态码与耗时摊开，断点才能一眼现形。
  //
  // 约定：未配置的段落记「跳过」（ok:null），**不是失败**。缺配置与链路故障是两回事，
  // 混在一起会让排查的人跑去修一段根本没配的东西。
  async function probeChain(uid) {
    const S = API.state || {};
    const siteHost = S.siteHost || (typeof location !== "undefined" ? location.origin : "");
    const brief = (s) => {
      const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
      return t.length > 150 ? t.slice(0, 150) + "…" : t;
    };
    const out = [];
    const add = (label, r, hint, okOverride) => {
      const ok = okOverride === undefined ? !!(r && r.ok) : okOverride;
      let detail;
      if (!r) detail = "未执行";
      else if (r.networkError) detail = "网络层失败：" + brief(r.body);
      else detail = "HTTP " + r.status + (r.body ? " · " + brief(r.body) : "");
      out.push({ label, ok, ms: (r && r.ms) || 0, detail, hint: ok ? "" : (hint || "") });
    };
    const skip = (label, why) => out.push({ label, ok: null, ms: 0, detail: why, hint: "" });

    // ① 站点后端（协作/配置网关）
    if (!siteHost) skip("① 站点后端（协作网关）", "未配置站点地址（独立打开面板需在「设置」填写）");
    else {
      const r = await API.rawRequest(siteHost, "GET", "/api/console/ext/summary");
      // 401 = 站点活着、只是会话过期 —— 链路本身是通的，不能报成「断了」。
      const expired = r && r.status === 401;
      add("① 站点后端（协作网关）", r,
        "确认 StelarithServer 在跑，且面板经 /admin/console 同源打开", expired ? true : undefined);
      if (expired) out[out.length - 1].detail += "（会话过期：需重新登录，链路本身正常）";
    }

    // ② 站点 → CIMS 客户端代理（服务端用 node:http 覆写租户 Host）
    if (!siteHost) skip("② 站点 → CIMS 代理", "无站点地址");
    else {
      const r = await API.rawRequest(siteHost, "GET", "/api/console/cims/class/device-status");
      add("② 站点 → CIMS 代理（租户 Host）", r,
        "403 = 租户没识别出来：核对网站 .env 的 CIMS_BASE_DOMAIN / CONSOLE_TARGET_SLUG；500 = CIMS 后端已死");
    }

    // ③ CIMS management 直连
    if (!S.mgmtHost) skip("③ CIMS management 直连", "未配置 management 地址");
    else {
      const r = await API.rawRequest(S.mgmtHost, "GET", "/class/device-status");
      add("③ CIMS management 直连", r, "确认 CIMS 后端在跑（8097）；401 = 令牌过期需重新登录");
    }

    // ④ 命令通道健康度。
    // ⚠️ 只能用**只读**的 /command/stats：`/command/queued` 是「取走」语义（读一次就把命令
    //    标记为 delivered，等客户端 ack）。拿它当探针会把真实命令吃掉——教室里那条广播
    //    从此再也不会播，而且两边都不报错。这正是本页存在的意义：诊断本身不能改变状态。
    if (!uid) skip("④ 命令通道（队列健康度）", "未指定设备（本项需一台设备 uid）");
    else if (!siteHost) skip("④ 命令通道（队列健康度）", "无站点地址");
    else {
      const r = await API.rawRequest(
        siteHost, "GET", `/api/console/cims/v1/client/${encodeURIComponent(uid)}/command/stats`
      );
      let okOverride;
      if (r && r.ok) {
        try {
          const j = JSON.parse(r.body);
          const pending = Number(j.pending || 0);
          const delivered = Number(j.delivered || 0);
          const failed = Number(j.failed || 0);
          // 持久 pending = 设备根本没在轮询；delivered 不 done = 取走了但执行后没 ack。
          okOverride = pending === 0 && failed === 0;
          r.body =
            `待取 ${pending} · 已取未确认 ${delivered} · 失败 ${failed} · 累计 ${j.total || 0}` +
            (pending > 0 ? "（设备未轮询：插件没跑 / 设备离线）" : "") +
            (delivered > 0 && pending === 0 ? "（有命令取走未确认：执行报错或 ack 链路断）" : "") +
            (j.oldest_pending_at ? ` · 最老待取 ${String(j.oldest_pending_at).slice(0, 19)}` : "");
        } catch (_) { /* 非 JSON：保留原文 */ }
      }
      add("④ 命令通道（队列健康度）", r,
        "404 = 后端版本过旧（缺 /command/stats 只读接口）→ 需重启 CIMS 后端", okOverride);
    }

    // ⑤ 扩展网关 · VNC 会话回执通道
    if (!siteHost) skip("⑤ 扩展网关（VNC 回执）", "无站点地址");
    else {
      const p = "/api/console/ext/vnc-session" + (uid ? "?uid=" + encodeURIComponent(uid) : "");
      const r = await API.rawRequest(siteHost, "GET", p);
      // 200 + {session:null} = 通道在、暂无会话，属正常，不是故障。
      add("⑤ 扩展网关（VNC 回执通道）", r, "确认站点在跑；404 = 站点版本过旧（缺该路径）");
    }

    // ⑥ 校园点歌站（可选）
    if (!S.voicehubHost) skip("⑥ 校园点歌站（可选）", "未配置点歌站地址");
    else {
      const r = await API.rawRequest(S.voicehubHost, "GET", "/api/open/songs?limit=1&played=false");
      // 未带 x-api-key 时 401/403 只说明「站活着但没带 key」→ 通道可达。
      const reachable = r && (r.ok || r.status === 401 || r.status === 403);
      add("⑥ 校园点歌站（可选）", r, "确认点歌站地址与 x-api-key（见「设置」）", reachable ? true : undefined);
    }
    return out;
  }

  /** 把探针结果渲染成一行行标记（✓ 通 / ✗ 不通 / • 跳过）。 */
  function renderProbeRows(items) {
    return items
      .map((it) => {
        const mark = it.ok === null ? "•" : it.ok ? "✓" : "✗";
        const cls = it.ok === null ? "muted" : it.ok ? "ok" : "warn";
        return `<div class="row" style="gap:8px;align-items:flex-start;margin:4px 0">
          <span class="tag ${cls}" style="min-width:22px;text-align:center">${mark}</span>
          <span style="flex:1;font-size:13px">
            <b>${esc(it.label)}</b>
            <span class="muted"> · ${it.ms ? it.ms + "ms" : "—"}</span><br/>
            <span class="muted" style="font-size:12px">${esc(it.detail)}</span>
            ${it.hint ? `<br/><span class="warn" style="font-size:12px">→ ${esc(it.hint)}</span>` : ""}
          </span>
        </div>`;
      })
      .join("");
  }

  /** 功能级自检：在分段探针之上，补「拿到数据后是否合理」的判断。 */
  async function runSelfTest(uid) {
    const items = [];
    const chain = await probeChain(uid);
    for (const c of chain) items.push(c);

    // 权限下发（内嵌态才有服务端快照）
    if (!PERM.embedded) {
      items.push({ label: "权限下发", ok: null, ms: 0, detail: "独立打开面板（非内嵌），无服务端权限快照", hint: "" });
    } else {
      items.push({
        label: "权限下发", ok: true, ms: 0,
        detail: `角色 ${PERM.roleLabel || PERM.role || "—"}${PERM.levelLabel ? " · " + PERM.levelLabel : ""}` +
          ` · 设备档 ${[PERM.control && "控制", PERM.remote && "远程", PERM.manage && "管理"].filter(Boolean).join("/") || "仅查看"}`,
        hint: "",
      });
    }

    // 设备清单与心跳
    try {
      const st = await API.deviceStatus();
      const ds = (st && st.devices) || [];
      const on = ds.filter((d) => d.online).length;
      items.push({
        label: "设备清单与心跳", ok: ds.length > 0, ms: 0,
        detail: ds.length ? `${ds.length} 台，在线 ${on} 台` : "0 台（CIMS 侧未注册设备 / 未绑班 / 心跳未上报）",
        hint: ds.length ? "" : "在 CIMS 建档设备并绑定班级；确认教室端插件心跳在跑",
      });
      if (uid) {
        const d = ds.find((x) => x.id === uid);
        items.push({
          label: "目标设备在线", ok: !!(d && d.online), ms: 0,
          detail: d ? `${d.last || "无心跳"} · ${d.online ? "在线" : "离线"}` : "该设备不在本账户列表",
          hint: !d ? "确认 uid 拼写与所属账户" : "离线设备收不到指令（命令会留在队列里）",
        });
      }
    } catch (e) {
      items.push({ label: "设备清单与心跳", ok: false, ms: 0, detail: String((e && e.message) || e), hint: "见 ①③ 段探测结论" });
    }

    // 审计链
    try {
      const v = await API.auditVerify();
      items.push({
        label: "审计链完整性", ok: !!(v && v.ok), ms: 0,
        detail: !v ? "无返回"
          : v.ok ? `链完整（校验 ${v.checked} 行${v.legacyRows ? `，跳过 ${v.legacyRows} 条无哈希旧记录` : ""}，档位 ${v.mode}）`
          : `第一处断裂：第 ${v.firstBadId} 行 —— ${v.problem || "未知"}`,
        hint: v && !v.ok ? "历史裁剪属正常；若从未裁剪却断链，需查库是否被人改过" : "",
      });
    } catch (e) {
      items.push({ label: "审计链完整性", ok: null, ms: 0, detail: "站点未提供该项：" + ((e && e.message) || e), hint: "" });
    }
    return items;
  }

  // ============ 远程控制 / 媒体通道配置（服务端持久化）============
  //
  // 为什么这些开关必须存在服务端：它们**决定教室端行为**（走 P2P 还是经服务器转发、
  // 压缩到什么码率、录像留几天）。localStorage 是「每台电脑各存一份」—— 运维在 A 机
  // 改完，B 机登录面板看到的还是旧策略，两边下发不一致，出问题只能靠猜。
  //
  // 关于「尽量 P2P」：摄像头画面 / 录像回看是**高带宽**负载。若全部经服务器中转，
  // 几间教室同时被观看就能把服务器上行打满。P2P（WebRTC）让画面在设备之间直连，
  // 服务器只承担信令；直连打不通时再用 ICE 里的 TURN 兜底转发 —— 这是 media_mode
  // 默认取 p2p 的原因。
  const MEDIA_DEFAULTS = {
    media_mode: "p2p",
    media_codec: "h264",
    media_scale: 1280,
    media_max_bitrate_kbps: 2000,
    media_snapshot_interval: 60,
    media_retention_days: 7,
    media_ice_servers: "",
    vnc_wait_seconds: 30,
    vnc_require_token: true,
    dev_verbose: false,
    dev_request_timeout_ms: 8000,
  };
  /** 取配置项：服务端没有/为空时回退到默认值（保证表单永远有可编辑的初值）。 */
  const pick = (cfg, k) => {
    const v = cfg ? cfg[k] : undefined;
    return v === undefined || v === null || v === "" ? MEDIA_DEFAULTS[k] : v;
  };

  function mediaConfigCard(cfg) {
    const sel = (v) => (pick(cfg, "media_mode") === v ? "selected" : "");
    return `
    <div class="card"><h3>远程控制（VNC）</h3>
      <div class="row"><span class="muted" style="width:120px">noVNC 页面</span>
        <input id="st-novnc" value="${esc(API.state.noVncUrl)}" style="width:340px" placeholder="https://noc.example.edu/novnc/vnc.html"/></div>
      <div class="row"><span class="muted" style="width:120px">等待回执(秒)</span>
        <input id="st-vncwait" type="number" min="5" max="180" value="${esc(pick(cfg, "vnc_wait_seconds"))}" style="width:100px"/>
        <label class="row"><input type="checkbox" id="st-vnctoken" ${pick(cfg, "vnc_require_token") ? "checked" : ""}/> 要求会话级令牌</label>
      </div>
      <p class="muted">「远程控制」经 CIMS 通知 → 设备本地代理<b>按需启动 VNC</b> → 面板内嵌 noVNC。地址由部署方提供（需可达设备的 websockify，令牌鉴权）。<b>前置条件：代理必须跑在「用户登录后的交互式会话」里</b> —— 以系统服务方式跑在会话 0（无桌面）时，VNC 起来了也看不到画面。</p>
    </div>

    <div class="card"><h3>摄像头 / 录像通道</h3>
      <div class="row"><span class="muted" style="width:120px">传输模式</span>
        <select id="st-mediamode">
          <option value="p2p" ${sel("p2p")}>P2P 直连（推荐：高带宽在设备之间走，不过服务器）</option>
          <option value="relay" ${sel("relay")}>经服务器转发（P2P 打不通时的兜底）</option>
          <option value="off" ${sel("off")}>关闭（不使用摄像头 / 录像）</option>
        </select></div>
      <div class="row"><span class="muted" style="width:120px">ICE 服务器</span>
        <input id="st-mediaice" value="${esc(pick(cfg, "media_ice_servers"))}" style="width:340px" placeholder="stun:stun.example.edu:3478,turn:turn.example.edu:3478"/></div>
      <div class="row">
        <span class="muted" style="width:120px">编码 / 最长边</span>
        <select id="st-mediacodec" style="width:120px">
          <option value="h264" ${pick(cfg, "media_codec") === "h264" ? "selected" : ""}>H.264</option>
          <option value="vp8" ${pick(cfg, "media_codec") === "vp8" ? "selected" : ""}>VP8</option>
          <option value="av1" ${pick(cfg, "media_codec") === "av1" ? "selected" : ""}>AV1（更省带宽，更吃算力）</option>
        </select>
        <input id="st-mediascale" type="number" min="320" max="3840" step="160" value="${esc(pick(cfg, "media_scale"))}" style="width:100px"/>
        <span class="muted">px</span>
      </div>
      <div class="row">
        <span class="muted" style="width:120px">码率上限</span>
        <input id="st-mediabitrate" type="number" min="200" max="20000" step="100" value="${esc(pick(cfg, "media_max_bitrate_kbps"))}" style="width:110px"/>
        <span class="muted">kbps · 抓拍间隔</span>
        <input id="st-mediasnap" type="number" min="5" max="3600" step="5" value="${esc(pick(cfg, "media_snapshot_interval"))}" style="width:100px"/>
        <span class="muted">秒 · 录像保留</span>
        <input id="st-mediaret" type="number" min="0" max="365" value="${esc(pick(cfg, "media_retention_days"))}" style="width:80px"/>
        <span class="muted">天</span>
      </div>
      <p class="muted">画面与录像属高带宽负载：默认 <b>P2P 直连</b>（WebRTC），服务器只做信令；直连不通时按 ICE 里的 TURN 兜底转发。压缩参数是「看得清」与「占带宽」的取舍 —— 720p@2Mbps 足够看清教室纪律，再高对判读没有帮助。录像保留 <b>0 = 不落盘</b>。</p>
    </div>

    <div class="card"><h3>开发者开关</h3>
      <div class="row"><span class="muted" style="width:120px">详细日志</span>
        <label class="row"><input type="checkbox" id="st-devverbose" ${pick(cfg, "dev_verbose") ? "checked" : ""}/> 面板打印每段链路耗时</label>
        <span class="muted" style="width:80px;text-align:right">请求超时</span>
        <input id="st-devtimeout" type="number" min="2000" max="60000" step="1000" value="${esc(pick(cfg, "dev_request_timeout_ms"))}" style="width:100px"/>
        <span class="muted">ms</span>
      </div>
    </div>
    <div class="card"><div class="row">
      <button class="primary" data-act="save-media" data-need="manage">保存控制 / 媒体配置</button>
      <span class="muted">保存到服务端，全校生效（需设备管理权限）。</span>
    </div></div>`;
  }

  // ============ 开发者选项 ============
  //
  // 这一页存在的理由：面板上「某个功能不工作」时，断在哪一段界面上看不出来。这里给三件工具：
  //   ① 链路探针：逐段各自给结论（把「没反应」拆成「断在第 N 段」）；
  //   ② 原始请求控制台：任意 host/方法/路径/请求体，**原样**显示状态码与响应体
  //      （用来回答"是 404 还是 403，还是 200 里包着 error"——被吞掉的错误最难查）；
  //   ③ 诊断导出：把状态/权限/探测结果打包成 JSON，便于贴给开发。
  views.dev = async () => {
    const S = API.state || {};
    const hosts = [
      ["同源站点", S.siteHost || (typeof location !== "undefined" ? location.origin : "")],
      ["management", S.mgmtHost || ""],
      ["client(8096)", S.clientHost || ""],
      ["ext 网关", S.extHost || ""],
      ["voicehub", S.voicehubHost || ""],
    ].filter(([, v]) => v);
    return `
    <div class="card"><h3>链路探针（六段分段自检）</h3>
      <p class="muted">对每一段各发一个最小只读请求，逐段报结论与耗时。面板上「没反应」的功能，
      断点在这里现形：<b>✓ 通 / ✗ 不通 / • 跳过（未配置，不等于故障）</b>。</p>
      <div class="row">
        <span class="muted" style="width:88px">目标设备</span>
        <input id="dev-uid" placeholder="设备 uid（第 ④⑤ 段需要，可留空）" style="width:280px"/>
        <button class="primary" data-act="dev-probe">开始探测</button>
      </div>
      <div id="dev-probe-out" style="margin-top:8px"></div>
    </div>

    <div class="card"><h3>原始请求控制台</h3>
      <p class="muted">任意 host / 方法 / 路径 / 请求体，<b>原样</b>显示状态码、耗时与响应体。
      用来回答「到底是 404、还是 403，还是 200 里包着 error」—— 被上层吞掉的错误响应是最难查的一类问题。</p>
      <div class="row">
        <span class="muted" style="width:88px">目标</span>
        <select id="dev-host" style="width:260px">
          ${hosts.map(([n, v]) => `<option value="${esc(v)}">${esc(n)} · ${esc(v)}</option>`).join("")}
        </select>
        <select id="dev-method" style="width:100px">
          <option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option>
        </select>
      </div>
      <div class="row"><input id="dev-path" value="/class/device-status" style="width:100%" placeholder="/class/device-status"/></div>
      <textarea id="dev-body" placeholder='请求体（JSON；GET 时忽略）&#10;{"MessageContent":"测试"}' style="min-height:56px"></textarea>
      <div class="row"><button class="primary" data-act="dev-send">发送</button>
        <span class="muted">自动带当前登录令牌（Authorization: Bearer）。</span></div>
      <pre id="dev-send-out" class="muted" style="white-space:pre-wrap;word-break:break-all;max-height:300px;overflow:auto;font-size:12px"></pre>
    </div>

    <div class="card"><h3>诊断导出</h3>
      <p class="muted">把面板状态、权限、各段探测结果打包成一段 JSON，便于贴给开发排查。<b>不含令牌明文</b>。</p>
      <div class="row">
        <button data-act="dev-export">生成诊断包</button>
        <button data-act="dev-copy">复制</button>
        <span id="dev-export-note" class="muted"></span>
      </div>
      <textarea id="dev-export" class="muted" style="min-height:120px;font-size:12px" readonly placeholder="点「生成诊断包」"></textarea>
    </div>`;
  };

  // ============ 测试页 ============
  //
  // 与「开发者选项」的分工：那页给**原始工具**（任意请求、任意路径），本页给**结论** ——
  // 一键把该跑的都跑一遍，每项 ✓/✗/• 带耗时，失败直接给出「改哪里」。
  // 定位：每次改动 / 部署后点一下，30 秒内知道有没有打坏东西。
  views.test = async () => `
    <div class="card"><h3>自检（一键）</h3>
      <p class="muted">覆盖：六段链路（站点网关 / CIMS 代理 / management / 命令通道 / 扩展网关 / 点歌站）
      → 权限下发 → 设备心跳 → 审计链。每项给结论与耗时；✗ 项直接给出「改哪里」。</p>
      <div class="row">
        <span class="muted" style="width:88px">目标设备</span>
        <input id="test-uid" placeholder="设备 uid（可留空，跳过与设备相关的项）" style="width:280px"/>
        <button class="primary" data-act="test-run">运行自检</button>
        <span id="test-summary" class="muted"></span>
      </div>
      <div id="test-out" style="margin-top:8px"></div>
    </div>`;

  // ============ 摄像头 / 媒体库（抓拍 · 录像 · 调取）============
  //
  // 这个视图要回答的不是"按钮点了有没有反应"，而是「产物在哪、能不能取回」。
  // 教室端把图片/视频存在**本机**（C:/ProgramData/Stelarith/media），面板取回只有两条路：
  //   · 直连（默认）：向教室机的媒体服务直接拉，不经服务器 —— 这正是"高带宽操作走 P2P"的落点；
  //   · 服务器中转：**未实现**（站点无法反连教室机的 127.0.0.1，而且大文件穿站点会打死上行）。
  // 因此取不回时**必须给出可照做的原因**，而不是一句"失败" ——
  // "连不上"这三个字在校内网/公网/混合内容三种场景下的处置完全不同。
  const mediaKindOf = () => {
    const el = document.querySelector('input[name="md-kind"]:checked');
    return (el && el.value) || "snapshots";
  };
  const numOf = (sel) => {
    const el = $(sel);
    const v = Number(el && el.value);
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };
  const mdUid = () => {
    const el = $("#md-uid");
    return el && el.value ? el.value.trim() : "";
  };
  const fmtBytes = (n) => {
    const b = Number(n) || 0;
    if (b < 1024) return b + " B";
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
    if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + " MB";
    return (b / 1024 / 1024 / 1024).toFixed(2) + " GB";
  };
  const sessionHint = (session) => (session
    ? '<div class="muted" style="font-size:12px;margin-top:4px">直连会话：' + esc(session.ip + ":" + session.port)
      + (session.at ? "（登记于 " + new Date(session.at).toLocaleTimeString() + "）" : "") + "</div>"
    : '<div class="muted" style="font-size:12px;margin-top:4px">未登记的直连会话：先执行一次「抓拍」或「开始录像」，'
      + "教室端代理会在启动媒体服务后回报地址；若一直为空，检查代理环境变量 STELARITH_EXT_URL / STELARITH_EXT_SECRET。</div>");

  views.media = async () => `
    <div class="card"><h3>抓拍与录像（教室端执行）</h3>
      <p class="muted">抓拍/录像由教室端的本地代理执行（只有设备侧有摄像头访问权），产物存在教室机本地。
      面板通过**局域网直连**取回，不经服务器中转 —— 录像这种大字节数据走中转会把站点上行打死。</p>
      <div class="row">
        <span class="muted" style="width:88px">目标设备</span>
        <input id="md-uid" placeholder="设备 uid（必填）" style="width:240px"/>
        <button class="primary" data-act="md-snap" data-need="remote">抓拍一张</button>
        <button data-act="md-rec-start" data-need="remote">开始录像</button>
        <button data-act="md-rec-stop" data-need="remote">停止录像</button>
        <button data-act="md-cams" data-need="remote">列出摄像头</button>
      </div>
      <div class="row">
        <span class="muted" style="width:88px">压缩参数</span>
        <input id="md-bitrate" type="number" min="200" max="20000" value="1500" style="width:96px" title="录像码率"/>
        <input id="md-scale" type="number" min="160" max="3840" value="1280" style="width:96px" title="画面最长边"/>
        <input id="md-seg" type="number" min="15" max="3600" value="300" style="width:96px" title="分段长度（秒）"/>
        <span class="muted">码率 kbps · 最长边 px · 分段秒。录像**必须分段**：单文件长写一断电就整段作废。</span>
      </div>
      <div id="md-msg" class="muted" style="margin-top:6px"></div>
      <p class="muted" style="font-size:12px">说明：抓拍/录像指令**没有同步返回值** —— 下发成功只代表指令进了队列，
      产物要靠下面的「媒体库」去取。这不是缺陷，是链路形态（面板 → CIMS 队列 → 插件门控 → 本机代理）。</p>
    </div>
    <div class="card"><h3>媒体库（直连教室机取回）</h3>
      <div class="row">
        <button data-act="md-refresh">刷新列表</button>
        <button data-act="md-session">检查直连会话</button>
        <label class="row" style="gap:4px"><input type="radio" name="md-kind" value="snapshots" checked/> 快照</label>
        <label class="row" style="gap:4px"><input type="radio" name="md-kind" value="recordings"/> 录像</label>
        <span id="md-count" class="muted"></span>
      </div>
      <div id="md-list" style="margin-top:8px"><p class="muted">点「刷新列表」从教室机取回清单。</p></div>
    </div>`;

  views.settings = async () => {
    // 控制/媒体/实验特性这些配置存在**服务端**（console_meta KV），不落 localStorage：
    // 它们决定教室端行为，必须全校一致（见 mediaConfigCard 注释）。
    const cfg = await API.getSettings();
    return `
    <div class="card"><h3>连接设置</h3>
      <div class="row"><span class="muted" style="width:80px">后端地址</span>
        <input id="st-host" value="${esc(API.state.mgmtHost)}" style="width:340px"/></div>
      <div class="row"><span class="muted" style="width:80px">令牌</span>
        <input id="st-token" value="${esc(API.state.token)}" style="width:340px"/></div>
      <div class="row"><span class="muted" style="width:80px">指令密钥</span>
        <input id="st-tasksecret" value="${esc(API.state.taskSecret)}" style="width:340px" placeholder="与设备代理 STELARITH_AGENT_SECRET 一致"/></div>
      <div class="row"><span class="muted" style="width:80px">演示模式</span>
        <label class="row"><input type="checkbox" id="st-demo" ${API.state.demo?"checked":""}/> 使用内置演示数据</label></div>
      <div class="row" style="margin-top:8px">
        <button class="primary" data-act="save-settings">保存</button>
        <button class="danger" data-act="logout">退出登录</button>
      </div>
      <p class="muted">API 契约见 API.md：直接对接 CIMS 原生 management/client 端口；协作/上报类走可选扩展网关（extHost）或同源网站。</p>
    </div>
    <div class="card"><h3>校园点歌联动（voicehub）</h3>
      <div class="row"><span class="muted" style="width:80px">点歌站地址</span>
        <input id="st-vhost" value="${esc(API.state.voicehubHost)}" style="width:340px" placeholder="https://voicehub.example.edu"/></div>
      <div class="row"><span class="muted" style="width:80px">API Key</span>
        <input id="st-vkey" value="${esc(API.state.voicehubKey)}" style="width:340px" placeholder="vhub_..."/></div>
      <p class="muted">用于「校园点歌」视图拉取队列 / 点歌。需在 voicehub 后台生成具备 songs:read 与 songs:request 权限的 API Key。</p>
    </div>
    ${mediaConfigCard(cfg)}`;
  };

  // ============ 定时广播（P2）============
  let schedEditId = null;
  const _sbTypeLabel = (t) => ({ once: "一次性", daily: "每天", weekly: "每周" }[t] || t);
  const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString() : "—");
  // UTC ISO -> 浏览器本地 datetime-local 值（用于回填编辑表单）
  const toLocalInput = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  views.scheduled = async () => {
    const [list, devs] = await Promise.all([API.listScheduled(), API.listDevices()]);
    const items = (list && list.items) || [];
    const classes = (devs && devs.suggest) || [];
    const nameOf = (cid) => (classes.find((c) => c.class_id === cid) || {}).name || cid;
    const rows = items.length
      ? items.map((it) => `
        <tr data-id="${it.id}">
          <td>${esc(it.name || "(未命名)")}</td>
          <td><span class="tag">${_sbTypeLabel(it.schedule_type)}</span>${it.schedule_type === "weekly" ? " 周" + "日一二三四五六"[it.weekday || 0] : ""}</td>
          <td>${esc(fmtTime(it.run_at))}</td>
          <td>${it.target_class_id ? esc(nameOf(it.target_class_id)) : "<b>全校</b>"}</td>
          <td>${it.enabled ? '<span class="tag ok">启用</span>' : '<span class="tag dim">停用</span>'}</td>
          <td>${esc(fmtTime(it.next_run_at))}</td>
          <td>${esc(fmtTime(it.last_run_at))}</td>
          <td class="acts">
            <button data-act="sb-edit" data-id="${it.id}">编辑</button>
            <button data-act="sb-toggle" data-id="${it.id}" data-on="${it.enabled ? 0 : 1}">${it.enabled ? "停用" : "启用"}</button>
            <button data-act="sb-fire" data-id="${it.id}">立即触发</button>
            <button class="danger" data-act="sb-del" data-id="${it.id}">删除</button>
          </td>
        </tr>`).join("")
      : `<tr><td colspan="8" class="muted" style="text-align:center;padding:18px 0">暂无定时广播，新建一条试试。</td></tr>`;
    const wdOpts = [0, 1, 2, 3, 4, 5, 6].map((w) => `<option value="${w}">周${"日一二三四五六"[w]}</option>`).join("");
    return `
    <div class="card">
      <h3>${schedEditId ? "编辑定时广播" : "新建定时广播"}</h3>
      <div class="row"><span class="muted" style="width:70px">名称</span><input id="sb-name" style="width:240px" placeholder="如 早读提醒"/></div>
      <div class="row"><span class="muted" style="width:70px">类型</span>
        <select id="sb-type">
          <option value="once">一次性</option><option value="daily">每天</option><option value="weekly">每周</option>
        </select></div>
      <div class="row" id="sb-weekday-row" style="display:none"><span class="muted" style="width:70px">星期</span>
        <select id="sb-weekday">${wdOpts}</select></div>
      <div class="row"><span class="muted" style="width:70px">时间</span><input id="sb-runat" type="datetime-local" style="width:220px"/></div>
      <div class="row"><span class="muted" style="width:70px">标题</span><input id="sb-title" style="width:320px" placeholder="大屏通知标题"/></div>
      <div class="row"><span class="muted" style="width:70px">正文</span><textarea id="sb-content" style="width:420px;height:60px" placeholder="要广播的内容"></textarea></div>
      <div class="row"><span class="muted" style="width:70px">目标</span>
        <select id="sb-target"><option value="">全校</option>${classes.map((c) => `<option value="${esc(c.class_id)}">${esc(c.name)}</option>`).join("")}</select></div>
      <div class="row" style="margin-top:8px">
        <button class="primary" data-act="sb-save">${schedEditId ? "保存修改" : "新建"}</button>
        <button data-act="sb-cancel" ${schedEditId ? "" : 'style="display:none"'}>取消编辑</button>
      </div>
      <p class="muted">后台调度器每 30s 巡检一次，到点自动向目标设备推送大屏通知（复用现有命令通道，教室端无需更新）。</p>
    </div>
    <div class="card">
      <h3>定时广播列表（${items.length}）</h3>
      <table class="tbl"><thead><tr><th>名称</th><th>类型</th><th>锚定时间</th><th>目标</th><th>状态</th><th>下次</th><th>上次</th><th>操作</th></tr></thead>
      <tbody id="sb-list">${rows}</tbody></table>
    </div>`;
  };

  // ============ 随机抽取（课堂工具，纯前端，localStorage 持久化）============
  // 名单本地保存，设备端无依赖，内嵌态同源可用 localStorage，离线也能抽。
  let randomNames = [], randomDrawn = new Set(), randomHistory = [];
  try {
    const a = JSON.parse(localStorage.getItem("console.random.names") || "null");
    if (Array.isArray(a)) randomNames = a;
    const b = JSON.parse(localStorage.getItem("console.random.history") || "null");
    if (Array.isArray(b)) randomHistory = b;
    const c = JSON.parse(localStorage.getItem("console.random.drawn") || "null");
    if (Array.isArray(c)) randomDrawn = new Set(c);
  } catch (_) {}
  const _randomSave = () => {
    try {
      localStorage.setItem("console.random.names", JSON.stringify(randomNames));
      localStorage.setItem("console.random.history", JSON.stringify(randomHistory));
      localStorage.setItem("console.random.drawn", JSON.stringify([...randomDrawn]));
    } catch (_) {}
  };
  const _randomAvail = (useDrawn) =>
    randomNames.map((n, i) => ({ n, i })).filter((x) => (useDrawn ? !randomDrawn.has(x.i) : true));
  const _randomPick = (k, useDrawn) => {
    const pool = _randomAvail(useDrawn);
    if (pool.length === 0) return [];
    const n = Math.min(k, pool.length);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const picked = pool.slice(0, n);
    picked.forEach((x) => randomDrawn.add(x.i));
    return picked.map((x) => x.n);
  };

  views.random = async () => {
    const last = randomHistory.length ? randomHistory[randomHistory.length - 1] : [];
    const avail = _randomAvail(true).length;
    const hist = randomHistory.length
      ? randomHistory.map((h, i) => `<div class="card-mini"><b>第 ${i + 1} 批</b>：${esc(h.join("、"))}</div>`).join("")
      : `<p class="muted">还没有抽取记录。导入名单后点「抽 1 人」试试。</p>`;
    return `
      <div class="card"><h3>随机抽取 · 课堂点名</h3>
        <p class="muted">名单保存在本机（当前 ${randomNames.length} 人，未抽 ${avail} 人）。开启「防重复」后抽过的人不再出现，可「重置已抽」重来。</p>
        <div class="row">
          <textarea id="random-input" style="width:100%;height:84px" placeholder="每行一个名字，粘贴名单（如：张三&#10;李四）或从下方导入"></textarea>
        </div>
        <div class="row" style="margin-top:6px">
          <button class="primary" data-act="random-import">导入名单</button>
          <button data-act="random-fromclass">从班级设备导入</button>
          <button data-act="random-clearlist">清空名单</button>
        </div>
        <div class="row" style="margin-top:10px">
          <button class="primary lg" data-act="random-draw1">抽 1 人</button>
          <span class="muted">抽</span>
          <input id="random-n" type="number" min="1" value="3" style="width:60px"/>
          <span class="muted">人</span>
          <button data-act="random-drawn">抽取</button>
          <label class="row" style="margin-left:8px"><input type="checkbox" id="random-nodup" checked/> 防重复</label>
          <button data-act="random-reset">重置已抽</button>
        </div>
        <div id="random-result" class="random-result" style="margin-top:12px">
          ${last.length ? `<div class="dice">🎲 ${esc(last.join("、"))}</div>` : `<span class="muted">结果会显示在这里</span>`}
        </div>
        <h4 style="margin:14px 0 6px">抽取历史（${randomHistory.length}）</h4>
        <div class="list">${hist}</div>
      </div>`;
  };

  // ============ 文件传输（面板侧完整 UI；后端/设备端下发依赖部署包）============
  // 设备端能力（上传后下发到设备、设备侧接收落盘）需教室端部署 ClassroomDeploy 包；
  // 未部署时本页可上传到服务端暂存、查看历史，但「下发到设备」会提示未就绪。
  views.filetransfer = async () => {
    const cls = await API.listClassEntities().catch(() => ({ deviceMap: [] }));
    const devs = (cls && cls.deviceMap) || [];
    const clsOpts = devs.map((d) => `<option value="${esc(d.class_id || d.id)}">${esc(d.name || d.id)}</option>`).join("");
    return `
      <div class="card"><h3>文件传输</h3>
        <p class="muted">上传文件到服务端，再下发到选定班级/设备。设备侧接收需教室端部署星集控 ClassroomDeploy 包（含最新代理）；未部署时仅完成服务端暂存。</p>
        <div class="row">
          <input id="ft-file" type="file" multiple style="flex:1"/>
        </div>
        <div class="row" style="margin-top:8px">
          <span class="muted">下发到</span>
          <select id="ft-target"><option value="">全校</option>${clsOpts}</select>
          <button class="primary" data-act="ft-upload">上传并下发</button>
        </div>
        <div id="ft-status" class="muted" style="margin-top:8px">待上传。</div>
        <h4 style="margin:14px 0 6px">传输历史</h4>
        <div id="ft-list" class="list"><p class="muted">暂无传输记录。</p></div>
        <p class="muted">注：后端文件存储接口与设备端接收为本期后端联调项，界面已就绪，下发动作待部署包就位后生效。</p>
      </div>`;
  };

  // ============ 音量调节（面板侧完整 UI；下发依赖部署包）============
  // 单设备/整班音量滑杆 + 静音，经命令通道下发 setVolume。设备端执行需部署包。
  views.volume = async () => {
    const devs = await API.listDevices().catch(() => []);
    const rows = (devs || []).map((d) => `
      <tr data-uid="${esc(d.uid || d.id)}">
        <td>${esc(d.name || d.id)}</td>
        <td><input type="range" min="0" max="100" value="${d.volume ?? 50}" class="vol-slider" data-uid="${esc(d.uid || d.id)}"/></td>
        <td><span class="vol-val">${d.volume ?? 50}</span></td>
        <td><button data-act="vol-mute" data-uid="${esc(d.uid || d.id)}">静音</button>
        <button class="primary" data-act="vol-apply" data-uid="${esc(d.uid || d.id)}">应用</button></td>
      </tr>`).join("");
    return `
      <div class="card"><h3>音量调节</h3>
        <p class="muted">逐设备拖动滑杆设定音量，或一键静音。「应用」经命令通道下发 setVolume（设备端执行需部署星集控 ClassroomDeploy 包）。
          <button class="primary" data-act="vol-apply-all">整班/全校应用当前值</button></p>
        <table class="tbl"><thead><tr><th>设备</th><th>音量</th><th>值</th><th>操作</th></tr></thead>
        <tbody id="vol-list">${rows || `<tr><td colspan="4" class="muted" style="text-align:center;padding:16px 0">暂无设备，或设备端未上报。</td></tr>`}</tbody></table>
        <p class="muted">注：实际音量语义（0–100 对应设备主音量）与设备端接收为本期权后端联调项；界面与下发指令已就绪。</p>
      </div>`;
  };

  // ============ 移动端侧栏抽屉 ============
  // 窄屏下侧栏是浮层（见 styles.css 的 @media(max-width:760px)）：默认收起，
  // 由顶栏汉堡按钮开合，点菜单项 / 遮罩 / Esc 自动收起。
  // 这里只切 class，滑出滑回的动画交给 CSS transition —— 不引入任何依赖。
  const navEl = $("#sidebar"), navMask = $("#nav-mask"), navBtn = $("#btn-nav");
  function setNav(open) {
    if (!navEl) return;
    navEl.classList.toggle("open", open);
    if (navMask) navMask.classList.toggle("show", open);
    if (navBtn) navBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }
  if (navBtn) navBtn.addEventListener("click", () => setNav(!navEl.classList.contains("open")));
  if (navMask) navMask.addEventListener("click", () => setNav(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setNav(false); });

  // ============ 渲染与导航 ============
  async function go(v) {
    current = v || current;
    document.querySelectorAll(".nav").forEach((b) => b.classList.toggle("active", b.dataset.view === current));
    // 联动优化：切换视图后把激活项滚进可视区（移动端抽屉里激活指示也能一眼看到）；
    // #sidebar 自身 overflow:auto，scrollIntoView 只滚侧栏内部、不带动整页。
    const actBtn = document.querySelector(".nav.active");
    if (actBtn && actBtn.scrollIntoView) actBtn.scrollIntoView({ block: "nearest" });
    // 视图级权限：无权限直接给一句人话，比进去看一屏禁用按钮友好
    const need = VIEW_NEED[current];
    if (!allow(need)) {
      view.innerHTML = `<div class="card"><h3>无权限</h3>
        <p class="muted">当前账号（${esc(PERM.roleLabel || PERM.role || "只读")}）无「${esc(NEED_LABEL[need] || need)}」权限，请联系管理员开通。</p></div>`;
      toast("无权限：" + (NEED_LABEL[need] || need));
      meta(`视图：${current} · 无权限`);
      applyGating();
      return;
    }
    view.innerHTML = `<p class="muted">加载中…</p>`;
    try {
      view.innerHTML = await views[current]();
      applyGating();
      // 设备表的筛选词跨重渲染保留，所以渲染完要把过滤重新套一遍，
      // 否则「搜索 → 点刷新」会看到全部设备，像是搜索失效了。
      if (current === "devices") applyDevFilter();
      toast("就绪");
    } catch (e) {
      // 把真实抛错与视图名一起打出来：像「Cannot read properties of undefined
      // (reading '0')」这类错误本身不指明是哪个视图/哪块数据出的问题，
      // 只显示 e.message 会让人完全无从下手（本次 cp_class08 课表信封
      // 不匹配就是这么被误报成「操作日志加载失败」的）。
      const where = `视图「${current}」渲染失败`;
      console.error(where, e);
      view.innerHTML = `<div class="card"><h3>加载失败</h3>
        <p class="muted">${esc(where)}：${esc(e && e.message || e)}</p>
        <p class="muted" style="font-size:12px">可在浏览器控制台查看完整堆栈；其他页面不受影响，可点左侧其它菜单继续。</p>
      </div>`;
      toast("错误：" + where);
    }
    meta(`视图：${current} · ${API.state.demo ? "演示模式" : "后端模式"}`);
    // 内嵌态：总览渲染后，若账号尚未绑定班级则显示补充信息引导卡
    if (current === "dashboard") showDashboardOnboard();
    // 每次渲染完都要重算：offline 是在拉取数据过程中才被置位的，
    // 渲染前它还可能是 false（例如刚进来、还没发过请求）。
    refreshOfflineBanner();
  }

  document.querySelectorAll(".nav").forEach((b) => b.addEventListener("click", () => { go(b.dataset.view); setNav(false); }));

  // 离线横幅「重试」：先清标记再重渲染。若仍拿不到数据，请求过程中
  // 会再次置位 offline，横幅会自动回来 —— 不会出现「点了重试却假装好了」。
  const obRetry = $("#ob-retry");
  if (obRetry) {
    obRetry.addEventListener("click", () => {
      API.markOnline();
      toast("正在重新连接…");
      go(current);
    });
  }

  // 联动优化：侧栏内方向键导航（ArrowUp/Down 在可见项间移动焦点，Enter/Space 由按钮原生触发）。
  // 让纯键盘用户也能在集控面板里顺畅切换视图，不依赖鼠标/触摸。
  if (navEl) {
    navEl.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = Array.prototype.filter.call(
        navEl.querySelectorAll(".nav"),
        (b) => b.offsetParent !== null && !b.classList.contains("hidden")
      );
      if (!items.length) return;
      const idx = items.indexOf(document.activeElement);
      e.preventDefault();
      const next = e.key === "ArrowDown"
        ? Math.min(items.length - 1, idx + 1)
        : Math.max(0, idx - 1);
      if (items[next]) items[next].focus();
    });
  }
  $("#btn-settings").addEventListener("click", () => {
    document.querySelectorAll(".nav").forEach(x=>x.classList.remove("active"));
    current = "settings"; go("settings"); setNav(false);
  });

  // ============ 事件委托 ============
  // 设备表搜索：用 input 事件（不是 click），且只切可见性、不重渲染 —— 保住输入焦点。
  document.addEventListener("input", (e) => {
    const el = e.target && e.target.closest && e.target.closest("[data-devfilter]");
    if (!el) return;
    devQuery = el.value;
    applyDevFilter();
  });

  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act;
    try {
      if (act === "reload") return go(current);
      // ---- 随机抽取（纯前端）----
      if (act === "random-import") {
        const txt = document.getElementById("random-input");
        const names = (txt.value || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (!names.length) return toast("名单为空");
        randomNames = names; randomDrawn = new Set(); _randomSave();
        toast("已导入 " + names.length + " 人"); return go("random");
      }
      if (act === "random-fromclass") {
        try {
          const cls = await API.listClassEntities();
          const devs = (cls && cls.deviceMap) || (cls && cls.devices) || [];
          if (!devs.length) return toast("没有可导入的设备/班级");
          randomNames = devs.map((d) => d.name || d.id).filter(Boolean); randomDrawn = new Set(); _randomSave();
          toast("已从班级导入 " + randomNames.length + " 项"); return go("random");
        } catch (e) { return toast("导入失败：" + (e && e.message || e)); }
      }
      if (act === "random-clearlist") {
        randomNames = []; randomDrawn = new Set(); randomHistory = []; _randomSave(); return go("random");
      }
      const _rdup = () => { const c = document.getElementById("random-nodup"); return c ? c.checked : true; };
      if (act === "random-draw1") {
        const picked = _randomPick(1, _rdup());
        if (!picked.length) { toast("已抽完，点「重置已抽」重来"); return go("random"); }
        randomHistory.push(picked); _randomSave(); return go("random");
      }
      if (act === "random-drawn") {
        const n = parseInt((document.getElementById("random-n") || {}).value || "1", 10) || 1;
        const picked = _randomPick(n, _rdup());
        if (!picked.length) { toast("已抽完或名单空"); return go("random"); }
        randomHistory.push(picked); _randomSave(); return go("random");
      }
      if (act === "random-reset") { randomDrawn = new Set(); _randomSave(); toast("已重置「已抽」标记"); return go("random"); }
      // ---- 文件传输（面板侧；下发依赖部署包）----
      if (act === "ft-upload") {
        const f = document.getElementById("ft-file");
        if (!f || !f.files || !f.files.length) return toast("请先选择文件");
        const target = (document.getElementById("ft-target") || {}).value || "";
        // 后端存储/下发接口为本期后端联调项：先回显已选文件与目标，真实上传待接口就位。
        const names = Array.from(f.files).map((x) => x.name).join("、");
        const st = document.getElementById("ft-status");
        if (st) st.textContent = `已选 ${f.files.length} 个文件：${names} → ${target || "全校"}（后端接口联调中，暂未落库下发）`;
        toast("文件已选，等待后端接口联调");
      }
      // ---- 音量调节（面板侧；下发依赖部署包）----
      if (act === "vol-mute") {
        const uid = el.dataset.uid; const s = document.querySelector(`.vol-slider[data-uid="${uid}"]`);
        if (s) { s.value = 0; const v = s.parentElement.parentElement.querySelector(".vol-val"); if (v) v.textContent = "0"; }
        return toast("已设为静音（待下发）");
      }
      if (act === "vol-apply") {
        const uid = el.dataset.uid; const s = document.querySelector(`.vol-slider[data-uid="${uid}"]`);
        const val = s ? s.value : 50;
        return toast(`将对 ${uid} 下发 setVolume(${val})（待部署包就位）`);
      }
      if (act === "vol-apply-all") {
        const vals = Array.from(document.querySelectorAll(".vol-slider")).map((s) => `${s.dataset.uid}=${s.value}`).join(", ");
        return toast(`将批量下发：${vals}（待部署包就位）`);
      }

      // 通用跳转：任意按钮都能把用户送到另一个视图（免得为了"去某页"写一个专用 action）
      if (act === "go") return go(el.dataset.v);
      // ---- 定时关机（长期计划：每天/每周/一次性/倒计时；教室端 60s 确认后生效）----
      if (act === "shutdown-sched") {
        if (!allow("control")) return toast("无权限：设备控制");
        return openShutdownModal({ uid: el.dataset.id, name: el.dataset.name || el.dataset.id });
      }
      if (act === "shutdown-class") {
        if (!allow("control")) return toast("无权限：设备控制");
        const body = document.getElementById("dev-body");
        const uids = [];
        if (body) {
          body.querySelectorAll("tr.dev-row:not(.hidden)").forEach((tr) => {
            const btn = tr.querySelector('button[data-act="shutdown-sched"]');
            if (btn && btn.dataset.id) uids.push(btn.dataset.id);
          });
        }
        if (!uids.length) return toast("当前筛选结果里没有可下发的设备");
        return openShutdownModal({ uids, name: `整班（${uids.length} 台）` });
      }
      if (act === "shd-close") {
        const m = document.getElementById("shd-modal");
        if (m) m.remove();
        return;
      }
      if (act === "shd-save") return await saveShutdownPlan(el);
      if (act === "shd-cancel-plan") return await cancelShutdownPlan(el);
      // ---- 班级管理（#182 文件夹式 + 快捷选择）----
      if (act === "cls-pick") {
        if (!allow("control")) return toast("无权限：设备控制");
        if (pickClass(el.dataset.id)) return go(current);
        return;
      }
      if (act === "cls-devices") {
        // 不做二次请求：设备页自己带按班级分组 + 搜索，把搜索词预置好跳过去即可。
        const rec = classAdminCache.find((c) => c.class_id === el.dataset.id);
        devQuery = rec ? (rec.code || rec.name || "") : "";
        return go("devices");
      }
      if (act === "cls-create") {
        if (!allow("control")) return toast("无权限：设备控制");
        const y = Number(($("#cls-year") || {}).value || 0);
        const n = Number(($("#cls-num") || {}).value || 0);
        const nm = (($("#cls-name") || {}).value || "").trim();
        if (!y || !n) return toast("请填写「届」与「班号」");
        el.disabled = true;
        try {
          const r = await API.createClass({ graduationYear: y, classNumber: n, name: nm });
          toast((r && r.message) || "班级已创建");
          await loadClasses();
          go("classes");
        } catch (err) {
          // 建班是**写**操作：重名 / 无权限 / 未连后端都必须说出来。
          // 静默失败在这里代价最大 —— 用户会以为班已经建好了，转头去绑设备。
          toast("创建失败：" + ((err && err.message) || err));
        } finally { el.disabled = false; }
        return;
      }
      if (act === "cls-approve" || act === "cls-reject") {
        if (!allow("manage")) return toast("无权限：设备管理");
        const id = el.dataset.id || "";
        const action = act === "cls-approve" ? "approve" : "reject";
        let reason = "";
        if (action === "reject") {
          const inp = document.querySelector('[data-rej="' + id + '"]');
          reason = ((inp && inp.value) || "").trim();
        }
        el.disabled = true;
        try {
          const r = await API.reviewClass(id, action, reason);
          toast((r && r.message) || (action === "approve" ? "已通过审核" : "已驳回"));
          await loadClasses();
          go("classes");
        } catch (err) {
          toast("审核失败：" + ((err && err.message) || err));
        } finally { el.disabled = false; }
        return;
      }
      // 设备表：分组 ↔ 平铺。顺序变了必须重渲染，但重渲染后要立刻把筛选套回去，
      // 否则用户输入的关键词会看起来"失效了一次"。
      if (act === "dev-group") {
        devGrouped = !devGrouped;
        await go(current);
        applyDevFilter();
        return;
      }
      // 审计完整性：手动重算一次并直接把结论说出来（不只在页面上换个标签，
      // 否则用户点了按钮没有反馈，会以为按钮没生效）。
      if (act === "audit-verify") {
        const v = await API.auditVerify();
        toast(
          !v ? "后端未提供完整性校验"
            : v.ok ? `审计链完整（已校验 ${v.checked} 条${v.legacyRows ? `，跳过 ${v.legacyRows} 条无哈希旧记录` : ""}）`
            : `审计链异常：第 ${v.firstBadId} 行 —— ${v.problem || "未知"}`
        );
        return go(current);
      }
      if (act === "audit-prune") {
        const r = await API.auditPrune();
        toast(
          r && r.ok
            ? `已裁剪 ${r.removed} 条（保留 ${r.retentionDays} 天${r.anchor ? "，已登记裁剪锚点" : ""}）`
            : `裁剪失败：${(r && r.error) || "未知原因"}`
        );
        return go(current);
      }

      if (act === "save-schedule") {
        const s = await API.getSchedule();
        // 以 DOM 为唯一真相重建 items：用户可能删过/加过节次，
        // 此时 data-i 与后端数据已错位 —— 若还按 data-i 逐格回填，
        // 会出现「删掉的那节保存后又回来了」。
        for (const d of s.days || []) d.items = [];
        view.querySelectorAll("input[data-day]").forEach((inp) => {
          const d = (s.days || []).find((x) => String(x.day) === inp.dataset.day);
          if (d) d.items.push(inp.value);
        });
        const r = await API.putSchedule(API.state.classId, s);
        const drops = (r && r.dropped) || [];
        // 审计留痕（2026-09-17 补）：课表下发会直接改写教室大屏的当天课程，
        // 「哪天谁把某班的课表改了」在学期中途是高频争议点，必须可倒查。
        // 送达节次数一并记账：节次数异常（如 0）说明这次下发很可能是误操作。
        API.audit(
          "schedule.push",
          API.state.classId || "—",
          `课表下发｜节次=${(s.days || []).reduce((n, d) => n + (d.items || []).length, 0)}` +
            `｜未识别科目=${drops.length}`
        );
        if (drops.length) {
          toast(`已保存并下发，但有 ${drops.length} 节科目无法识别，未写入：${drops.slice(0, 3).join("；")}${drops.length > 3 ? " …" : ""}`);
          console.warn("未写入的课表格子：", drops);
        } else {
          toast("课表已保存并下发");
        }
      }
      else if (act === "sched-add") {
        // 新增一节：改 DOM 后立即重渲染（不落库），由「保存并下发」统一提交。
        // 注意用 `el`（被点的那个按钮）取 day —— 曾经误写成未定义的 `b`，
        // 结果点「+ 新增一节」直接抛 ReferenceError，按钮看起来"没反应"。
        const day = view.querySelector(`.sched-day-head button[data-day="${el.dataset.day}"]`);
        const block = day && day.closest(".sched-day");
        const list = block && block.querySelector(".sched-list");
        if (list) {
          const idx = list.querySelectorAll("input[data-day]").length;
          const li = document.createElement("li");
          li.className = "sched-row";
          li.innerHTML =
            `<span class="sched-idx">${String(idx + 1).padStart(2, "0")}</span>` +
            `<input class="sched-subject" data-day="${el.dataset.day}" data-i="${idx}" placeholder="科目（留空=该节无课）"/>` +
            `<button class="sched-del" data-act="sched-del" data-day="${el.dataset.day}" data-i="${idx}" title="删除这一节">✕</button>`;
          list.appendChild(li);
          li.querySelector("input").focus();
        }
      }
      else if (act === "sched-del") {
        // 删除：改 DOM 后重排该天剩余节次的序号（data-i 由保存时按 DOM 顺序重建，故只需视觉正确）
        const inp = view.querySelector(`input[data-day="${el.dataset.day}"][data-i="${el.dataset.i}"]`);
        const li = inp && inp.closest("li");
        if (li) {
          const list = li.parentElement;
          li.remove();
          list.querySelectorAll("li.sched-row").forEach((row, i) => {
            const idx = row.querySelector(".sched-idx");
            if (idx) idx.textContent = String(i + 1).padStart(2, "0");
            const el = row.querySelector("input[data-day]");
            if (el) el.dataset.i = String(i);
            const del = row.querySelector(".sched-del");
            if (del) del.dataset.i = String(i);
          });
          if (!list.querySelectorAll("li.sched-row").length) {
            list.innerHTML = `<li class="muted" style="padding:6px 0">这一天暂无课，点「+ 新增一节」开始添加。</li>`;
          }
        }
      }
      else if (act === "nt-cls-all") {
        view.querySelectorAll("input.nt-cls").forEach((c) => (c.checked = true));
      }
      else if (act === "nt-cls-none") {
        view.querySelectorAll("input.nt-cls").forEach((c) => (c.checked = false));
      }
      else if (act === "nt-cls-mine") {
        const mine = PERM.className || "";
        view.querySelectorAll("input.nt-cls").forEach((c) => {
          c.checked = !!mine && c.value === mine;
        });
        if (!mine) toast("当前账号未绑定班级，请先在个人资料中补充");
      }
      else if (act === "save-config") {
        let obj;
        try { obj = JSON.parse($("#cfg-json").value); }
        catch { return toast("JSON 格式错误"); }
        obj.autoHide = {
          inClass: view.querySelector('[data-cfg="inClass"]').checked,
          exam: view.querySelector('[data-cfg="exam"]').checked,
          projection: view.querySelector('[data-cfg="projection"]').checked,
        };
        obj.updateChannel = $("#cfg-channel").value;
        await API.putConfig(API.state.classId, obj);
        toast("配置已保存并下发");
      }
      else if (act === "toggle-plugin") {
        await API.setPlugin(el.dataset.id, el.dataset.on === "1");
        API.audit("plugin.toggle", el.dataset.id, el.dataset.on === "1" ? "启用组件" : "禁用组件");
        toast("插件状态已更新"); go("plugins");
      }
      else if (act === "dev") {
        // 关机是不可逆动作：必须二次确认（防误触把整间教室的机器全关掉）
        if (el.dataset.a === "shutdown" && !el.dataset.confirmed && !confirm(`确认关机设备 ${el.dataset.id} 吗？\n关机后需人工到教室开机，请谨慎操作。`)) return;
        el.dataset.confirmed = "1";
        await API.deviceAction(el.dataset.id, el.dataset.a);
        API.audit("device." + el.dataset.a, el.dataset.id, "下发设备指令");
        toast(`已下发指令：${el.dataset.a} → ${el.dataset.id}`);
      }
      else if (act === "assign") {
        const id = el.dataset.id;
        const sel = document.querySelector(`select.ci-assign[data-id="${id}"]`);
        const cid = sel && sel.value;
        if (!cid) return toast("请先在下拉里选择班级");
        el.disabled = true;
        try {
          const r = await API.assignDevice(id, cid);
          API.audit("device.assign", id, "绑定到 " + cid);
          const detail = r && (r.message || r.status) ? `（${r.message || r.status}）` : "";
          toast(`已${el.textContent}：${cid} ${detail}`);
        } catch (e) {
          toast("绑定失败：" + (e && e.message ? e.message : e));
        } finally {
          el.disabled = false;
        }
        go("devices");
      }
      else if (act === "unassign") {
        const id = el.dataset.id;
        el.disabled = true;
        try {
          const r = await API.unassignDevice(id);
          API.audit("device.unassign", id, "解除绑定（触发设备端重新注册 OOBE）");
          const detail = r && (r.message || r.status) ? `（${r.message || r.status}）` : "";
          toast(`已解除绑定：${id} ${detail}，设备端将重新走 OOBE 选班`);
        } catch (e) {
          toast("解绑失败：" + (e && e.message ? e.message : e));
        } finally {
          el.disabled = false;
        }
        go("devices");
      }
      // ---- 定时广播（P2）----
      else if (act === "sb-save") {
        const runat = $("#sb-runat").value;
        if (!runat) return toast("请选择时间");
        const type = $("#sb-type").value;
        const body = {
          name: $("#sb-name").value.trim(),
          schedule_type: type,
          run_at: new Date(runat).toISOString(),
          weekday: type === "weekly" ? Number($("#sb-weekday").value) : null,
          title: $("#sb-title").value.trim(),
          content: $("#sb-content").value,
          target_class_id: $("#sb-target").value || "",
          enabled: true,
        };
        try {
          const r = schedEditId ? await API.updateScheduled(schedEditId, body) : await API.createScheduled(body);
          if (!r || r.status === "error") throw new Error((r && r.message) || "保存失败");
          schedEditId = null;
          toast(schedEditId === null ? "已新建定时广播" : "已保存修改");
          go("scheduled");
        } catch (e) { toast("保存失败：" + (e && e.message ? e.message : e)); }
      }
      else if (act === "sb-cancel") { schedEditId = null; go("scheduled"); }
      else if (act === "sb-edit") {
        const id = Number(el.dataset.id);
        const r = await API.listScheduled();
        const it = (r && r.items || []).find((x) => x.id === id);
        if (!it) return toast("未找到该配置");
        schedEditId = id;
        go("scheduled");
        setTimeout(() => {
          if ($("#sb-name")) $("#sb-name").value = it.name || "";
          if ($("#sb-type")) $("#sb-type").value = it.schedule_type;
          if ($("#sb-weekday")) $("#sb-weekday").value = String(it.weekday || 0);
          if ($("#sb-weekday-row")) $("#sb-weekday-row").style.display = it.schedule_type === "weekly" ? "" : "none";
          if ($("#sb-runat")) $("#sb-runat").value = toLocalInput(it.run_at);
          if ($("#sb-title")) $("#sb-title").value = it.title || "";
          if ($("#sb-content")) $("#sb-content").value = it.content || "";
          if ($("#sb-target")) $("#sb-target").value = it.target_class_id || "";
        }, 30);
      }
      else if (act === "sb-toggle") {
        const id = Number(el.dataset.id);
        const on = el.dataset.on === "1";
        try { await API.toggleScheduled(id, on); toast(on ? "已启用" : "已停用"); go("scheduled"); }
        catch (e) { toast("操作失败：" + (e && e.message ? e.message : e)); }
      }
      else if (act === "sb-fire") {
        const id = Number(el.dataset.id);
        el.disabled = true;
        try {
          const r = await API.fireScheduled(id);
          API.audit("scheduled.fire", id, "手动触发");
          toast("已触发，触达 " + ((r && r.delivered) || 0) + " 台");
        } catch (e) { toast("触发失败：" + (e && e.message ? e.message : e)); }
        finally { el.disabled = false; go("scheduled"); }
      }
      else if (act === "sb-del") {
        const id = Number(el.dataset.id);
        if (!confirm("确认删除这条定时广播？")) return;
        try { await API.deleteScheduled(id); toast("已删除"); go("scheduled"); }
        catch (e) { toast("删除失败：" + (e && e.message ? e.message : e)); }
      }
      // ---- ClassIsland 专页 ----
      else if (act === "ci-reload") {
        return go("classisland");
      }
      else if (act === "ci-act") {
        const a = el.dataset.a;
        const uid = el.dataset.id;
        el.disabled = true;
        const r = await API.classislandAction(uid, a);
        API.audit("classisland." + a, uid, "ClassIsland 快捷操作");
        const ok = !r || r.delivered === undefined || r.delivered > 0;
        toast(ok ? `已下发：${a} → ${uid}` : `已下发但无设备接收：${a}`);
        // 状态类操作（同步/刷新）会改变本机状态，稍后自动刷新本页让结果可见；
        // 否则用户会以为"点了没反应"。延时给设备端一点执行时间。
        if (["sync_now", "refresh_profile", "restart_island", "set_active_class"].includes(a)) {
          setTimeout(() => { if (current === "classisland") go("classisland"); }, 2500);
        }
        el.disabled = false;
      }
      else if (act === "ci-module") {
        const uid = el.dataset.id;
        const mid = el.dataset.m;
        const on = el.dataset.on === "1";
        // 核心模块禁止关闭：按钮在渲染时已 disabled，这里再兜一层
        // （防止有人直接改 DOM 绕过），服务端与插件端还会各校验一次。
        if (!on && MOD_CORE.has(mid)) return toast("核心模块不允许关闭");
        const r = await API.setModule(uid, mid, on);
        API.audit("classisland.module", `${uid}/${mid}`, on ? "启用模块" : "关闭模块");
        toast(`已下发模块开关：${mid} → ${on ? "启用" : "关闭"}${r && r.delivered === 0 ? "（无设备接收）" : ""}`);
        setTimeout(() => { if (current === "classisland") go("classisland"); }, 2500);
      }
      else if (act === "ci-switch-class") {
        const uid = el.dataset.id;
        const sel = $("#ci-group");
        const group = sel ? sel.value : "";
        if (!group) return toast("请先选择一个课表群");
        if (!confirm(`确认把「${uid}」的当前课表群切换为「${group}」？\n该操作会改写教室端本机档案，约 2~3 秒后生效。`)) return;
        await API.classislandAction(uid, "set_active_class", { group_name: group });
        API.audit("classisland.switch_class", uid, "切换到 " + group);
        toast(`已下发切班指令：${group}`);
        setTimeout(() => { if (current === "classisland") go("classisland"); }, 3000);
      }
      else if (act === "send-notice") {
        const t = $("#nt-title").value.trim(); if (!t) return toast("请输入标题");
        const c = $("#nt-content") ? $("#nt-content").value.trim() : "";
        // 显示时长（秒）：留空 = 不指定（教室端按字数自适应）。显式给 0 也等于不指定。
        const durEl = $("#nt-duration");
        const dur = durEl && durEl.value.trim() !== "" ? Number(durEl.value) : undefined;
        // 勾选的班级 = 定向推送目标（多选）。为空则交给「范围」决定。
        const cls = Array.from(view.querySelectorAll("input.nt-cls:checked")).map((x) => x.value);
        try {
          // ⚠️ 这里刻意**不**补 API.audit —— 广播的审计由服务端负责：
          //   · 真正推送时 src/lib/server/broadcast.ts 内部记 `broadcast_<source>`；
          //   · ext 路由仅在「没走 broadcast」时补一条 `notice`（仅留痕），
          //     且该处注释明确写着「broadcast 内部已记，避免审计双份」。
          // 前端再记一次，会让每次广播在操作日志里出现三条记录，
          // 真正的失败原因反而被淹掉（2026-09-17 实测真实数据确认）。
          const r = await API.sendNotice(t, $("#nt-scope").value, cls, c, dur);
          const b = r && r.broadcast;
          // 时长回显：让「设了 30 秒」和「忘了设」在结果通知里一眼可分。
          const durNote =
            Number.isFinite(dur) && dur > 0 ? `（大屏显示 ${dur} 秒）` : "（时长自适应）";
          if (b && b.deduped) {
            toast("内容与 30 秒内的上一条完全相同，已自动去重（未重复推送）");
          } else if (b && b.ok === false) {
            toast("未送达：" + (b.error || "未知原因"));
          } else if (b) {
            toast(`通知已发布${durNote}，送达 ${b.delivered}/${b.total} 台设备`);
          } else {
            toast("通知已发布" + durNote);
          }
        } catch (e) {
          toast("发布失败：" + (e && e.message ? e.message : e));
          return;
        }
        go("notify");
      }
      else if (act === "fr-search") {
        const q = ($("#fr-q") || {}).value || "";
        const box = $("#fr-results");
        if (!box) return;
        if (!q.trim()) { box.innerHTML = ""; return; }
        box.innerHTML = `<p class="muted">搜索中…</p>`;
        try {
          const rs = await API.searchFriends(q.trim());
          box.innerHTML = rs.length
            ? rs
                .map(
                  (r) => `<div class="li">
              <span class="li-name">${esc(r.displayName)}</span>
              <span class="muted" style="font-size:12px">${esc(r.className || r.gradeName || r.username)}</span>
              <span class="grow"></span>
              <button class="primary" data-act="fr-request" data-id="${r.id}" data-name="${esc(r.displayName)}">加好友</button>
            </div>`
                )
                .join("")
            : `<p class="muted">没有找到匹配的用户。</p>`;
        } catch (e) {
          box.innerHTML = `<p class="muted">搜索失败：${esc(e && e.message ? e.message : e)}</p>`;
        }
      }
      else if (act === "fr-request") {
        await API.friendAction("request", Number(b.dataset.id), b.dataset.name || "");
        toast("好友申请已发出");
        go("chat");
      }
      else if (act === "fr-accept") {
        await API.friendAction("accept", Number(b.dataset.id));
        toast("已接受好友");
        go("chat");
      }
      else if (act === "fr-reject") {
        await API.friendAction("reject", Number(b.dataset.id));
        toast("已拒绝");
        go("chat");
      }
      else if (act === "fr-remove") {
        await API.friendAction("remove", Number(b.dataset.id));
        toast("已删除");
        go("chat");
      }
      else if (act === "fr-dm") {
        // 进私聊：房间名用 dm:<小id>:<大id>，双方算出的名字一致
        const id = Number(b.dataset.id);
        const room = API.dmRoom(PERM.uid, id);
        if (!room) return toast("无法进入私聊（缺少用户 id）");
        chatPeer = { id, name: b.dataset.name || String(id) };
        chatRoom = room;
        go("chat");
      }
      else if (act === "send-chat") {
        const t = $("#chat-text").value.trim(); if (!t) return;
        // 含 @全体 / @all 时服务端会自动升级为教室大屏广播，这里给个即刻反馈，
        // 免得发完不知道「到底推没推」。返回体里的 broadcast 字段是真实送达数。
        // 这里的判定必须与服务端 [...path]/+server.ts 的 AT_ALL **完全一致**：
        // 不能用统一尾随 `\b`（CJK 不构成 ASCII 词边界，会让「@全体」永不命中），
        // 且要排除邮箱（a@all.com）。两边不一致会出现「提示已广播但实际没推」。
        const wantAll = /(?<![A-Za-z0-9._%+-])(?:@全体|@all\b)/i.test(t);
        const r = await API.sendChat(t, API.state.classId || "电教委员", chatRoom);
        if (wantAll) {
          const b = r && r.broadcast;
          toast(b && b.delivered > 0
            ? `已发送，并广播到 ${b.delivered}/${b.total} 台教室大屏`
            : "已发送（广播未送达：集控不可达或设备离线）");
        } else {
          toast("已发送");
        }
        go("chat");
      }
      else if (act === "submit-report") {
        const t = $("#rp-title").value.trim(); if (!t) return toast("请输入标题");
        // 模板名随工单一并落 labels：既是给人看的分类，也便于后台按类型统计
        const tpl = REPORT_TEMPLATES.find((x) => x.id === ($("#rp-tpl") || {}).value);
        await API.submitReport({
          title: t,
          level: $("#rp-level").value,
          desc: $("#rp-desc").value,
          template: tpl ? tpl.label : "",
        });
        toast("工单已提交"); go("report");
      }
      else if (act === "submit-bug") {
        const t = $("#bg-title").value.trim(); if (!t) return toast("请输入标题");
        const tpl = BUG_TEMPLATES.find((x) => x.id === ($("#bg-tpl") || {}).value);
        await API.submitBug({
          title: t,
          steps: $("#bg-steps").value,
          log: $("#bg-log").value,
          template: tpl ? tpl.label : "",
        });
        toast("已提交，感谢反馈"); go("bug");
      }
      else if (act === "save-settings") {
        API.setHost($("#st-host").value);
        API.setToken($("#st-token").value);
        API.setTaskSecret($("#st-tasksecret").value);
        API.setDemo($("#st-demo").checked);
        API.setVoicehubHost($("#st-vhost").value);
        API.setVoicehubKey($("#st-vkey").value);
        API.setNoVncUrl($("#st-novnc").value);
        setConn(!API.state.demo && !!API.state.host, API.state.demo ? "演示模式" : "");
        toast("设置已保存"); go("dashboard");
      }
      else if (act === "save-media") {
        // 媒体/远程配置写**服务端**（全校一致）；noVNC 地址同时写本地 —— 面板自己要
        // 用它拼 iframe URL，两边必须一致，否则会出现"服务端配了、面板却用旧值"。
        const num = (id, dflt) => {
          const v = Number(($(id) || {}).value);
          return Number.isFinite(v) ? v : dflt;
        };
        const patch = {
          media_mode: $("#st-mediamode").value,
          media_codec: $("#st-mediacodec").value,
          media_scale: num("#st-mediascale", MEDIA_DEFAULTS.media_scale),
          media_max_bitrate_kbps: num("#st-mediabitrate", MEDIA_DEFAULTS.media_max_bitrate_kbps),
          media_snapshot_interval: num("#st-mediasnap", MEDIA_DEFAULTS.media_snapshot_interval),
          media_retention_days: num("#st-mediaret", MEDIA_DEFAULTS.media_retention_days),
          media_ice_servers: $("#st-mediaice").value.trim(),
          vnc_wait_seconds: num("#st-vncwait", MEDIA_DEFAULTS.vnc_wait_seconds),
          vnc_require_token: $("#st-vnctoken").checked,
          dev_verbose: $("#st-devverbose").checked,
          dev_request_timeout_ms: num("#st-devtimeout", MEDIA_DEFAULTS.dev_request_timeout_ms),
          novnc_url: $("#st-novnc").value.trim(),
        };
        API.setNoVncUrl(patch.novnc_url);
        try {
          const saved = await API.saveSettings(patch);
          // 写失败必须显式报错：配置没落库而界面显示"已保存"是最坏的一种假成功。
          toast(`控制/媒体配置已保存（传输模式 ${saved.media_mode || patch.media_mode} · ${patch.media_codec} ≤${patch.media_max_bitrate_kbps}kbps）`);
          API.audit("settings.media", "console",
            `传输模式 ${patch.media_mode} / ${patch.media_codec} / ≤${patch.media_max_bitrate_kbps}kbps / 录像保留 ${patch.media_retention_days} 天`);
        } catch (e) {
          return toast("保存失败（未生效）：" + ((e && e.message) || e));
        }
        go("settings");
      }
      else if (act === "dev-probe") {
        const box = $("#dev-probe-out");
        const uidEl = $("#dev-uid");
        const uid = uidEl && uidEl.value ? uidEl.value.trim() : "";
        if (box) box.innerHTML = `<p class="muted">探测中…（逐段发最小请求）</p>`;
        const items = await probeChain(uid);
        if (box) box.innerHTML = renderProbeRows(items);
      }
      else if (act === "dev-send") {
        const host = $("#dev-host").value;
        const method = $("#dev-method").value;
        const path = $("#dev-path").value.trim();
        const out = $("#dev-send-out");
        if (!path) return toast("请输入路径");
        if (out) out.textContent = "请求中…";
        const r = await API.rawRequest(host, method, path, $("#dev-body").value);
        if (out) {
          let pretty = r.body;
          try { pretty = JSON.stringify(JSON.parse(r.body), null, 2); } catch (_) { /* 非 JSON 原样显示 */ }
          out.textContent =
            `${method} ${host}${path}\n` +
            `HTTP ${r.status}${r.networkError ? "（网络层失败）" : ""} · ${r.ms}ms · ${r.ctype || "无 content-type"}\n` +
            "──────\n" + pretty;
        }
      }
      else if (act === "dev-export" || act === "dev-copy") {
        const ta = $("#dev-export");
        const note = $("#dev-export-note");
        // 复制但还没生成 → 先生成再复制（少一次点击）。
        if (act === "dev-export" || !ta || !ta.value) {
          const uidEl = $("#dev-uid");
          const uid = uidEl && uidEl.value ? uidEl.value.trim() : "";
          const items = await probeChain(uid);
          const S = API.state || {};
          const pack = {
            at: new Date().toISOString(),
            url: typeof location !== "undefined" ? location.href : "",
            ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
            // 刻意不导出令牌明文：只报「有没有配」，避免诊断包本身变成凭据泄露渠道。
            conn: {
              siteHost: S.siteHost || "", mgmtHost: S.mgmtHost || "", clientHost: S.clientHost || "",
              extHost: S.extHost || "", voicehubHost: S.voicehubHost || "",
              demo: !!S.demo, hasToken: !!S.token, hasTaskSecret: !!S.taskSecret, noVncUrl: S.noVncUrl || "",
            },
            perm: {
              role: PERM.role, roleLabel: PERM.roleLabel, levelLabel: PERM.levelLabel,
              embedded: !!PERM.embedded, control: !!PERM.control, remote: !!PERM.remote,
              manage: !!PERM.manage, issue: !!PERM.issue, readonly: !!PERM.readonly,
              bscopes: PERM.bscopes || [],
            },
            probe: items,
          };
          if (ta) ta.value = JSON.stringify(pack, null, 2);
          if (note) note.textContent = `已生成（${items.length} 项探测）`;
          if (act === "dev-export") return;
        }
        const txt = ta ? ta.value : "";
        if (!txt) return toast("请先生成诊断包");
        try {
          await navigator.clipboard.writeText(txt);
          if (note) note.textContent = "已复制到剪贴板";
          toast("诊断包已复制");
        } catch (_) {
          ta.select();
          toast("复制失败，已全选，请手动 Ctrl+C");
        }
      }
      else if (act === "test-run") {
        const box = $("#test-out"), sum = $("#test-summary");
        if (box) box.innerHTML = `<p class="muted">自检中…（逐段探测 + 数据合理性，约需数秒）</p>`;
        const uidEl = $("#test-uid");
        const uid = uidEl && uidEl.value ? uidEl.value.trim() : "";
        const items = await runSelfTest(uid);
        const pass = items.filter((i) => i.ok === true).length;
        const fail = items.filter((i) => i.ok === false).length;
        const skipN = items.filter((i) => i.ok === null).length;
        if (box) box.innerHTML = renderProbeRows(items);
        if (sum) sum.textContent = `通过 ${pass} · 失败 ${fail} · 跳过 ${skipN}`;
        toast(fail ? `自检完成：${fail} 项失败` : "自检完成：无失败项");
      }
      else if (act === "md-snap" || act === "md-rec-start" || act === "md-rec-stop") {
        const uid = mdUid();
        if (!uid) return toast("请先填设备 uid");
        const msg = $("#md-msg");
        const label = { "md-snap": "抓拍", "md-rec-start": "开始录像", "md-rec-stop": "停止录像" }[act];
        const extra = {
          bitrate_kbps: numOf("#md-bitrate"),
          scale: numOf("#md-scale"),
          segment_seconds: numOf("#md-seg"),
        };
        if (msg) msg.textContent = "正在下发「" + label + "」…";
        let r;
        if (act === "md-snap") r = await API.cameraSnapshot(uid, "class", extra);
        else if (act === "md-rec-start") r = await API.recordStart(uid, "class", extra);
        else r = await API.recordStop(uid, "class");
        if (r && r.ok === false) {
          // 远端可能用 HTTP 200 + {status:error} 表达失败 → 必须读回执体，别假装已下发。
          if (msg) msg.textContent = "指令未被受理：" + (r.reason || "未知原因");
          return toast("指令未下发");
        }
        API.audit(
          "media." + act.slice(3), uid,
          label + "（码率 " + (extra.bitrate_kbps || "默认") + "k / 最长边 " + (extra.scale || "默认") + "px）"
        );
        if (msg) msg.textContent = "已下发「" + label + "」。教室端执行需数秒，产物请用下方「媒体库 → 刷新列表」取回。";
        toast("已下发：" + label);
      }
      else if (act === "md-cams") {
        const uid = mdUid();
        if (!uid) return toast("请先填设备 uid");
        const msg = $("#md-msg");
        if (msg) msg.textContent = "正在下发「列出摄像头」…";
        const r = await API.cameraList(uid, "class");
        if (r && r.ok === false) {
          if (msg) msg.textContent = "指令未被受理：" + (r.reason || "未知原因");
          return toast("指令未下发");
        }
        if (msg) {
          msg.textContent = "已下发。设备侧枚举结果会落到教室端代理日志（agent.status.log）与通知；"
            + "若设备侧一直枚举为空，多半是代理跑在会话 0（SYSTEM 服务）看不到摄像头。";
        }
        toast("已下发：列出摄像头");
      }
      else if (act === "md-refresh" || act === "md-session") {
        const uid = mdUid();
        const listEl = $("#md-list");
        const cnt = $("#md-count");
        if (!uid) {
          if (listEl) listEl.innerHTML = '<p class="warn">请先填设备 uid。</p>';
          return toast("请先填设备 uid");
        }
        if (listEl) listEl.innerHTML = '<p class="muted">正在取直连会话并向教室机拉清单…</p>';
        const session = await API.deviceMediaSession(uid);
        if (act === "md-session") {
          // 只查会话：这一条就能判定"网关这一环通不通"，不必连带拉清单。
          listEl.innerHTML = '<p class="muted">直连会话检查：</p>' + sessionHint(session)
            + (session ? '<p class="muted" style="font-size:12px">会话有效 = 教室端代理已成功上报，网关这一段是通的。</p>' : "");
          return;
        }
        const r = await API.mediaLibrary(session);
        if (!r.ok) {
          if (cnt) cnt.textContent = "";
          listEl.innerHTML = '<p class="warn">' + esc(r.message) + "</p>" + sessionHint(session)
            + '<p class="muted" style="font-size:12px">排障顺序：① 先点「检查直连会话」看有没有地址；'
            + "② 有地址但连不上 → 用与教室机同网段的终端、或用 http 打开面板（HTTPS 页面不能直连 HTTP 教室机）；"
            + "③ 都不行 → 到该教室机上直接看媒体目录里有没有文件。</p>";
          return;
        }
        const kind = mediaKindOf();
        const items = (r.items || []).filter((it) => it.kind === kind);
        if (cnt) cnt.textContent = "共 " + items.length + " 个" + (kind === "recordings" ? "录像片段" : "快照");
        if (!items.length) {
          listEl.innerHTML = '<p class="muted">该类别下暂无文件。若刚下发过抓拍/录像，等几秒再刷新。</p>' + sessionHint(session);
          return;
        }
        const rows = items
          .slice()
          .reverse()
          .map((it) => {
            const url = API.mediaUrl(r.base, r.token, it.kind, it.name);
            const thumb = kind === "snapshots"
              ? '<img src="' + url + '" loading="lazy" style="max-width:120px;max-height:68px;border-radius:4px;border:1px solid var(--line)"/>'
              : '<span class="muted" style="font-size:12px">录像片段</span>';
            return "<tr><td>" + thumb + '</td><td style="font-size:12px">' + esc(it.name) + "</td>"
              + '<td class="muted" style="font-size:12px">' + fmtBytes(it.bytes) + "</td>"
              + '<td class="muted" style="font-size:12px">' + (it.mtime ? new Date(it.mtime * 1000).toLocaleString() : "—") + "</td>"
              + '<td><a href="' + url + '" target="_blank" rel="noopener" class="tag">打开</a> '
              + '<button class="danger" data-act="md-del" data-kind="' + esc(it.kind) + '" data-name="' + esc(it.name) + '" data-need="remote">删除</button></td></tr>';
          })
          .join("");
        listEl.innerHTML = '<table class="tbl"><thead><tr><th>预览</th><th>文件</th><th>大小</th><th>生成时间</th><th>操作</th></tr></thead>'
          + "<tbody>" + rows + "</tbody></table>" + sessionHint(session);
      }
      else if (act === "md-del") {
        const uid = mdUid();
        const kind = el.dataset.kind || mediaKindOf();
        const name = el.dataset.name || "";
        if (!uid || !name) return toast("缺少设备或文件名");
        if (!confirm("确认删除 " + kind + "/" + name + "？")) return;
        const r = await API.mediaDelete(uid, kind, name, "class");
        if (r && r.ok === false) return toast("删除指令未下发：" + (r.reason || ""));
        API.audit("media.delete", uid, kind + "/" + name);
        toast("已下发删除：" + name + "（教室端执行后刷新可见）");
      }
      else if (act === "logout") {
        API.clearAuth(); $("#login-mask").classList.remove("hidden"); toast("已退出");
      }
      else if (act === "remote-start" || act === "remote-wait") {
        // remote-wait = 不重发指令，只重新等待 30 秒（设备可能刚上线；重发会再写一条队列）。
        const isRetry = act === "remote-wait";
        const uid = el.dataset.id || (isRetry ? $("#vnc-name").textContent : "");
        if (!uid) return toast("未知设备");
        const note = $("#vnc-note"), diag = $("#vnc-diag"), retry = $("#vnc-retry");
        if (retry) retry.classList.add("hidden");

        if (!isRetry) {
          try {
            const r = await API.deviceRemoteStart(uid, "class");
            API.audit("remote.start", uid, "请求远程控制会话");
            // 远端可能用 200 + {status:"error"} 表达失败 → 回执体说明原因，别假装已下发。
            toast(r && r.ok === false
              ? "远程控制未受理：" + (r.reason || "未知原因")
              : "已请求远程控制会话：" + uid);
          } catch (e) { return toast("远程控制失败：" + ((e && e.message) || e)); }
          $("#vnc-name").textContent = uid;
          $("#vncbox").classList.remove("hidden");
          $("#vnc-frame").src = "about:blank";
          if (diag) { diag.classList.add("hidden"); diag.innerHTML = ""; }
        }

        // 轮询扩展网关的 VNC 会话回执（设备代理启动 VNC 后回报 ip/port/token）。
        // 30 秒等待期**必须有进度**，否则界面看起来像卡死（本页最常见的抱怨）。
        const novnc = API.state.noVncUrl;
        const TOTAL = 20, STEP = 1500, SECS = (TOTAL * STEP) / 1000;
        let session = null;
        for (let i = 0; i < TOTAL; i++) {
          if (note) note.textContent = `已下发远程控制指令（CIMS → 插件 → 本地代理按需启 VNC）。等待设备回报会话地址…（${Math.round(((i + 1) * STEP) / 1000)}/${SECS} 秒）`;
          await new Promise((r) => setTimeout(r, STEP));
          session = await API.deviceRemoteStatus(uid);
          if (session && session.ip && session.port) break;
        }

        if (!session || !session.ip) {
          // 超时不是「一句未收到回执」就完事 —— 逐环自查，让「断在哪」可见。
          if (note) note.textContent = `指令已下发，但 ${SECS} 秒内未收到设备会话回执。下面逐条自查哪一环没通（可直接在本页重试等待，无需重发指令）：`;
          if (retry) retry.classList.remove("hidden");
          try {
            const items = await API.vncDiagnose(uid);
            if (diag) {
              diag.classList.remove("hidden");
              diag.innerHTML =
                `<div class="muted" style="font-size:12px;margin-bottom:4px">VNC 链路自查（✓ 通 / ✗ 不通 / • 需人工确认）</div>` +
                items
                  .map((it) => {
                    const mark = it.ok === null ? "•" : it.ok ? "✓" : "✗";
                    const cls = it.ok === null ? "muted" : it.ok ? "ok" : "warn";
                    return `<div class="row" style="gap:6px;align-items:flex-start;margin:3px 0">
                      <span class="tag ${cls}" style="min-width:22px;text-align:center">${mark}</span>
                      <span style="font-size:12px"><b>${esc(it.label)}</b>：<span class="muted">${esc(it.detail)}</span></span>
                    </div>`;
                  })
                  .join("");
            }
          } catch (_) { /* 自查失败不覆盖主提示 */ }
        } else if (!novnc) {
          if (note) note.textContent = "已拿到设备会话（" + session.ip + ":" + session.port + "），但未配置 noVNC 地址。请在「设置」填写 noVNC 页面。";
        } else {
          try {
            const u = new URL(novnc);
            u.searchParams.set("autoconnect", "true");
            u.searchParams.set("host", session.ip);
            u.searchParams.set("port", String(session.port));
            if (session.token) u.searchParams.set("password", session.token);
            u.searchParams.set("path", "websockify");
            $("#vnc-frame").src = u.toString();
            if (note) note.textContent = "已连接设备 " + session.ip + ":" + session.port + "（令牌鉴权，结束即关，写审计）。";
            if (diag) { diag.classList.add("hidden"); diag.innerHTML = ""; }
            if (retry) retry.classList.add("hidden");
          } catch { $("#vnc-frame").src = novnc; }
        }
      }
      else if (act === "remote-stop") {
        try { await API.deviceRemoteStop($("#vnc-name").textContent); } catch (_) {}
        const diag = $("#vnc-diag"); if (diag) { diag.classList.add("hidden"); diag.innerHTML = ""; }
        const retry = $("#vnc-retry"); if (retry) retry.classList.add("hidden");
        $("#vncbox").classList.add("hidden");
        toast("会话已结束");
      }
      else if (act === "vh-refresh") {
        go("voicehub");
      }
      else if (act === "vh-push") {
        try {
          const { now, queue } = await API.voicehubList();
          const r = await API.voicehubPush(now, queue);
          toast(r && r.demo ? "演示模式：点歌看板已模拟推送" : "点歌看板已推送到本班屏幕（CIMS 资源 songboard 写入）");
        } catch (e) { toast("推送失败：" + e.message); }
      }
      else if (act === "vh-request") {
        const title = $("#vh-title").value.trim();
        if (!title) return toast("请输入歌曲名");
        const artist = $("#vh-artist").value.trim();
        try {
          const r = await API.voicehubRequest(title, artist);
          toast(r && r.demo ? "演示模式：点歌已模拟" : "点歌已提交到 voicehub");
          go("voicehub");
        } catch (e) { toast("点歌失败：" + e.message); }
      }
    } catch (err) { toast("操作失败：" + err.message); }
  });

  $("#chat-text") && $("#chat-text").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); const btn = document.querySelector('[data-act="send-chat"]'); btn && btn.click(); }
  });
  document.addEventListener("change", (e) => {
    // 定时关机弹窗：切换规则模式 → 显示/隐藏对应输入行
    if (e.target && e.target.id === "shd-mode") {
      shdToggleMode();
      return;
    }
    // ClassIsland 专页：切换查看的设备。整个视图要按新设备重渲染，故直接 go()。
    if (e.target && e.target.id === "ci-device") {
      ciCert = e.target.value;
      ciGroup = "";
      go("classisland");
      return;
    }
    // 切班下拉：只记住选择，不发指令（避免"选错一个就真的切了"）。
    // 真正下发在「切换课表群」按钮，那里还有一次 confirm。
    if (e.target && e.target.id === "ci-group") {
      ciGroup = e.target.value;
      return;
    }
    if (e.target && e.target.id === "chat-room") {
      const v = e.target.value;
      // 从私聊切到群聊/班级房间时清掉对端，否则再进 chat 页会又跳回私聊。
      if (!/^dm:/.test(v) || (chatPeer && API.dmRoom(PERM.uid, chatPeer.id) !== v)) chatPeer = null;
      chatRoom = v;
      go("chat");
      return;
    }
    // 定时广播：每周才需要选星期
    if (e.target && e.target.id === "sb-type") {
      const row = $("#sb-weekday-row");
      if (row) row.style.display = e.target.value === "weekly" ? "" : "none";
      return;
    }

    // 故障模板：选完即把标题/等级/描述骨架填好，报修人只需补空项
    if (e.target && e.target.id === "rp-tpl") {
      const t = REPORT_TEMPLATES.find((x) => x.id === e.target.value);
      if (!t) return;
      const ti = $("#rp-title"), de = $("#rp-desc"), lv = $("#rp-level"), hi = $("#rp-hint");
      if (ti && t.title) ti.value = t.title;
      if (de) de.value = t.desc;
      if (lv) lv.value = t.level;
      if (hi) hi.textContent = `已套用「${t.label}」模板：标题与描述骨架已填好，请补齐其中的空项后提交。`;
      if (ti) ti.focus();
      return;
    }

    // Bug 模板：填标题前缀与复现步骤骨架
    if (e.target && e.target.id === "bg-tpl") {
      const t = BUG_TEMPLATES.find((x) => x.id === e.target.value);
      if (!t) return;
      const ti = $("#bg-title"), st = $("#bg-steps"), hi = $("#bg-hint");
      if (ti && t.title) ti.value = t.title;
      if (st) st.value = t.steps;
      if (hi) hi.textContent = t.hint ? `「${t.label}」：${t.hint}` : `已套用「${t.label}」模板。`;
      if (ti) ti.focus();
      return;
    }

    // 通知历史按班级筛选：改选即按该班的记录重拉（服务端做精确的逗号项匹配）
    if (e.target && e.target.id === "nt-filter") {
      const cls = e.target.value;
      const tbody = view.querySelector("table tbody");
      if (!tbody) return;
      tbody.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center;padding:18px 0">加载中…</td></tr>`;
      API.listNotices(cls || undefined)
        .then((ns) => {
          tbody.innerHTML = ns.length
            ? ns
                .map(
                  (n) => `<tr>
              <td class="muted">${esc(n.at)}</td><td>${esc(n.title)}</td>
              <td><span class="tag ${({ 本班: "ok", 全校: "warn", 本年级: "accent" }[n.scope]) || ""}">${esc(n.scope)}</span></td>
              <td class="muted">${n.classes.length ? esc(n.classes.join("、")) : "—"}</td>
              <td class="muted">${esc(
                { notice: "面板通知", chat: "群内喊话", announcement: "网站公告" }[n.channel] || n.channel || "—"
              )}</td>
              <td>${n.sent ? `<span class="tag ok">${n.sent}</span>` : `<span class="tag err">0</span>`}</td>
            </tr>`
                )
                .join("")
            : `<tr><td colspan="6" class="muted" style="text-align:center;padding:18px 0">该班级暂无通知记录</td></tr>`;
        })
        .catch((err) => {
          tbody.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center;padding:18px 0">加载失败：${esc(
            err && err.message ? err.message : err
          )}</td></tr>`;
        });
      return;
    }
  });

  // ============ 登录 ============
  async function doLogin() {
    const host = $("#in-host").value.trim();
    const email = $("#in-email").value.trim();
    const pw = $("#in-password").value;
    const msg = $("#login-msg");
    try {
      await API.login(host, email, pw);
      if (!host) { API.setDemo(true); setConn(false, "演示模式"); }
      else setConn(true);
      $("#login-mask").classList.add("hidden");
      await loadClasses();
      go("dashboard");
    } catch (e) {
      msg.textContent = "登录失败：" + e.message + "（可改用演示模式）";
    }
  }
  async function enterDemo() {
    API.setDemo(true); $("#login-mask").classList.add("hidden");
    setConn(false, "演示模式");
    await loadClasses(); go("dashboard");
  }

  // ---- 班级选择器 ----
  //
  // 这一段是"面板打开时默认在看哪个班"的唯一决策点，历史上错过一次：
  // 下拉取自 ClassPlan **资源名**且默认取首个 → 打开就是 `default_classplan`
  // （空信封），用户看到的是「课表有误 / 不是我这个班」。
  // 现在的规则（按优先级，命中即停）：
  //   ① 用户已经手动选过（classAutoChosen=false）→ 尊重选择，绝不覆盖；
  //   ② 账号绑定的班级（PERM.className，如「8班」）能对上 → 用它；
  //   ③ 有设备的班级（避免默认落在一个空班）；
  //   ④ 兜底列表首项。
  let classList = [];        // 最近一次 loadClasses 的结果（渲染标题用）
  let classAutoChosen = true; // 当前选择是否由系统自动挑的（手动选过就转 false）

  /**
   * 「账号绑定的班级名」→ 列表中的班级项。
   * 只做**能确定**的匹配：完全相同 → 去除非数字字符后相同（`8班` == `高一(8)班`）。
   * 对不上就返回 null，绝不猜 —— 猜错等于把一个班的课表当成另一个班的给人看。
   */
  function matchOwnClass(own) {
    const key = String(own || "").trim();
    if (!key || !classList.length) return null;
    // 数字取「去掉前导零」的形式：账号写「8班」、资源名叫 `cp_class08` 时必须能对上，
    // 否则会退化成"没匹配到"→默认落到别的班。
    const digits = (s) =>
      (String(s || "").match(/\d+/g) || []).map((d) => String(Number(d))).join("");
    const kd = digits(key);
    return (
      classList.find((c) => c.name === key) ||
      classList.find((c) => c.code && c.code === key) ||
      (kd ? classList.find((c) => digits(c.name) && digits(c.name) === kd) : null) ||
      (kd ? classList.find((c) => digits(c.id) && digits(c.id) === kd) : null) ||
      null
    );
  }

  /** 当前所选班级的**人话**名称（找不到就退回资源名/空）。 */
  function currentClassLabel() {
    const cur = classList.find((c) => c.id === API.state.classId);
    return cur ? cur.name || cur.id : API.state.classId || "";
  }

  async function loadClasses() {
    const cs = await API.listClasses();
    classList = cs;
    const sel = $("#class-select");
    sel.innerHTML = cs.length
      ? cs
          .map((c) => `<option value="${esc(c.id)}" title="课表资源：${esc(c.id)}">${esc(c.name || c.id)}</option>`)
          .join("")
      : `<option value="">（该账户下暂无班级）</option>`;

    // 自动挑选态（用户没手动选过）→ 每次都按账号班级重算一遍：账号班级可能是
    // 登录后才由 /api/me 补上的，只算一次会永远停在上一次的兜底结果上。
    // 用户手动选过（classAutoChosen=false）则完全不动，尊重其选择。
    const stillValid = cs.some((c) => c.id === API.state.classId);
    if (classAutoChosen || !stillValid) {
      // `default_classplan` 这类**兜底资源**绝不能作为默认视图：它是一张空信封，
      // 选中它 = 打开课表页看到空白，且标题显示一个跟班级无关的资源名。
      // 老后端没给 class_plan 时 listClasses 会退回资源名清单，这里再兜一层。
      const pickable = cs.filter((c) => c.id && !/^default_/i.test(c.id));
      const own =
        matchOwnClass(PERM.className) ||
        pickable.find((c) => (c.deviceCount || 0) > 0) ||
        pickable[0] ||
        null;
      if (own) { API.setClass(own.id); classAutoChosen = true; }
      else API.setClass("");
    }
    sel.value = API.state.classId || "";
    $("#user-chip").textContent = API.state.demo ? "演示用户" : "已登录";
  }
  $("#class-select").addEventListener("change", (e) => {
    classAutoChosen = false; // 用户明确选过：后续校准不再覆盖
    API.setClass(e.target.value);
    go(current);
  });
  $("#btn-login").addEventListener("click", doLogin);
  $("#btn-demo").addEventListener("click", enterDemo);

  // 登录框预填：默认指向网站 CIMS 同源代理（公网可直达），去掉误导的 admin@example.edu。
  // 独立直开（非 /admin/console 内嵌）时用户无需猜地址/端口，填一次密码即可连上。
  (function initLoginForm() {
    const h = $("#in-host"), e = $("#in-email");
    // 优先用当前页面同源代理（公网时即 https://www.245959623.xyz/api/console/cims），
    // 避免出现内网 127.0.0.1 让公网用户连不上。
    const sameOrigin = (location.protocol + "//" + location.host) + "/api/console/cims";
    if (h && !h.value.trim()) h.value = API.state.mgmtHost || sameOrigin;
    if (e && (!e.value || e.value === "admin@example.edu")) e.value = "owner@stelarith.local";
  })();

  // ---- 全权接入 website 账号信息 ----
  // 内嵌态与宿主同源：实时拉 /api/me 校准账号（邮箱/头像/班级/年级/最近登录），
  // 更新顶栏身份区；若账号尚未绑定班级，则在总览顶部渲染「补充班级信息」引导卡。
  function getClassBound() { return !!(PERM.className || PERM.gradeName); }
  function renderTopbarIdentity() {
    const chip = $("#user-chip");
    if (!chip) return;
    const label = PERM.displayName || PERM.user;
    chip.textContent = label || (PERM.embedded ? "网站账号" : "未登录");
    chip.title = [PERM.email, PERM.className || PERM.gradeName]
      .filter(Boolean).join(" · ") || "当前账号";
  }
  async function syncAccount() {
    if (!PERM.embedded) return;
    try {
      const me = await API.me();
      if (!me) return; // 未登录/请求失败，保底用 query 注入的即值
      const prevClassEmpty = !getClassBound();
      if (me.displayName) PERM.displayName = me.displayName;
      if (me.avatar) PERM.avatar = me.avatar;
      if (me.email) PERM.email = me.email;
      if (me.className) PERM.className = me.className;
      if (me.gradeName) PERM.gradeName = me.gradeName;
      if (me.bio) PERM.bio = me.bio;
      renderTopbarIdentity();
      // 账号班级可能是**登录后**才知道的（宿主没经 query 注入 className 时尤其如此）。
      // 若当前选择仍是系统自动挑的，就按刚拿到的账号班级校准一次 —— 否则面板会一直
      // 停在"兜底首个班"，用户看到的就是"课表不是我班的"。
      await syncClassSelection();
      // 账号资料从「无班级」变为「已绑定」（例如刚在引导卡里保存过），刷新总览去掉引导卡
      if (prevClassEmpty && getClassBound() && current === "dashboard") go("dashboard");
      else if (current === "dashboard") showDashboardOnboard();
    } catch (_) { /* 拉不到就算了，不打断主流程 */ }
  }

  /**
   * 用「账号绑定的班级」校准当前选择（**仅自动挑选态**，手动选过一律不动）。
   *
   * 为什么单独抽出来：`PERM.className` 有三个来源 —— iframe query 注入、/api/me 回填、
   * 以及用户在引导卡里刚保存的。三处都要生效，写在一处才不会漏。
   */
  async function syncClassSelection() {
    if (!classAutoChosen) return;
    if (!classList.length) return;
    const own = matchOwnClass(PERM.className);
    if (!own || own.id === API.state.classId) return;
    API.setClass(own.id);
    const sel = $("#class-select");
    if (sel) sel.value = own.id;
    toast(`已切换到本班课表：${own.name}`);
    if (current === "schedule" || current === "dashboard") go(current);
  }
  async function showDashboardOnboard() {
    if (getClassBound()) return; // 已有班级绑定，不打扰
    const view = $("#view");
    if (!view) return;
    // 仅在总览视图顶部插入引导卡（若还没插过）
    if (view.querySelector("[data-onboard-class]")) return;
    view.insertAdjacentHTML("afterbegin", `
      <div class="onboard onboard-warn card-hover reveal" data-onboard-class>
        <div class="onboard-icon">🏫</div>
        <div class="onboard-txt">
          <div class="onboard-title">补充班级信息</div>
          <div class="onboard-sub">你的账号还没绑定班级/年级，绑定后设备控制、课表与通知会精确指向你所在班级。</div>
          <div class="onboard-row">
            <input id="in-class-name" placeholder="班级，如 高一(2)班" value="${esc(PERM.className || "")}" aria-label="班级" />
            <input id="in-grade-name" placeholder="年级，如 高一" value="${esc(PERM.gradeName || "")}" aria-label="年级" />
            <button id="btn-save-class" class="primary btn-shine" type="button">保存</button>
          </div>
          <div class="onboard-err" id="onboard-err"></div>
        </div>
      </div>
    `);
    $("#btn-save-class").addEventListener("click", async () => {
      const c = $("#in-class-name").value.trim();
      const g = $("#in-grade-name").value.trim();
      const err = $("#onboard-err");
      if (!c && !g) { err.textContent = "请至少填写班级或年级其中一个。"; return; }
      err.textContent = "";
      try {
        await API.saveMe({ className: c, gradeName: g });
        PERM.className = c; PERM.gradeName = g;
        const card = view.querySelector("[data-onboard-class]");
        if (card) card.remove();
        renderTopbarIdentity();
        toast("班级信息已保存");
        // 绑定完班级 → 让面板同步切到这个班的课表。
        // 不能靠拼名字（早先这里拼的是 `classplan_8`，而真实资源名是 `cp_class08`，
        // 拼出来必然取不到 → 课表空白）。做法是：标记为「自动选择」后重新装载班级列表，
        // 由 matchOwnClass 用**真实班级实体**去对。
        classAutoChosen = true;
        await loadClasses();
        go("dashboard");
      } catch (e) {
        err.textContent = "保存失败：" + (e.message || "请稍后重试");
      }
    });
  }

  // 内嵌于网站 /admin/console：复用网站会话，经服务端代理访问 CIMS，跳过自身登录。
  // 三条数据通道：
  //   · CIMS 设备/课表/配置 → /api/console/cims（服务端持 CIMS 会话令牌）
  //   · 通知历史/班级交流/操作日志 → /api/console/ext（站点 SQLite，真实的多人协作数据）
  //   · 故障上报/Bug → /api/feedback（同源，复用网站反馈模型）
  if (PERM.embedded || location.pathname.startsWith("/admin/console")) {
    API.setMgmtHost("/api/console/cims");
    API.setClientHost("/api/console/cims");
    API.setExtHost("/api/console/ext");
    API.setDemo(false);
    API.setEmbedded(true);
    API.setSiteHost(""); // 同源：上报走网站 /api/feedback
    // 内嵌态由宿主页经 iframe query 注入 CIMS 账户 id（否则 accountId 恒空、
    // canUseBackend() 为假，所有 cims() 静默降级演示数据）。
    // ⚠️ 必须用 location.search 现取，不能复用 PERM 闭包里的 q（作用域仅限该 IIFE，
    // 此处引用会 ReferenceError，导致 accountId 恒空、真实后端被静默降级）。
    API.state.accountId = new URLSearchParams(location.search).get("accountId") || "";
    $("#login-mask").classList.add("hidden");
    setConn(true, "网站代理");
    renderPermChip();
    applyGating();
    renderTopbarIdentity();           // 先按 query 注入的身份渲染
    syncAccount();                     // 再实时拉 /api/me 校准 + 触发班级引导
    // 账户归属自愈：宿主没注入 accountId（或注入了空）时，自行从 /account/list 取首个。
    // 否则 canUseBackend() 为假 → 整链降级成「未连接后端」。
    (async () => {
      if (!API.state.accountId) {
        try {
          const r = await fetch("/api/console/cims/account/list", { credentials: "same-origin" });
          const a = r.ok ? await r.json() : null;
          if (Array.isArray(a) && a.length) API.setAccountId(a[0].id || "");
        } catch (_) {}
      }
      await loadClasses();
      go("dashboard");
    })();
    return;
  }

  // 同源自愈登录（一个账号走遍项目）：
  // 直接打开 /console（非 /admin/console 内嵌）时，只要**当前站点已登录**（admin_token 有效），
  // 就用网站同源代理接管，绝不弹「后端地址/邮箱/密码」表单。
  // 探测：/api/console/cims/account/list 带 cookie —— 200 说明网站会话有效。
  (function autoEnterSameOrigin() {
    const base = location.protocol + "//" + location.host;
    if (!/^https?:/.test(location.protocol)) return;
    // 先隐藏登录框，探测失败再放出来（避免闪一下表单）
    const mask = $("#login-mask");
    if (mask) mask.classList.add("hidden");
    fetch(base + "/api/console/cims/account/list", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((accts) => {
        if (!Array.isArray(accts) || !accts.length) throw new Error("no account");
        API.setMgmtHost(base + "/api/console/cims");
        API.setClientHost(base + "/api/console/cims");
        API.setExtHost(base + "/api/console/ext");
        API.setDemo(false);
        API.setSiteHost("");
        API.setAccountId(accts[0].id || "");
        if (mask) mask.classList.add("hidden");
        setConn(true, "网站账号");
        renderTopbarIdentity();
        fetch(base + "/api/me", { credentials: "same-origin" })
          .then((r) => (r.ok ? r.json() : null))
          .then((me) => { if (me) { if (me.email) PERM.email = me.email; if (me.displayName) PERM.displayName = me.displayName; renderTopbarIdentity(); syncAccount(); } })
          .catch(() => {});
        loadClasses().then(() => go("dashboard"));
      })
      .catch(() => { if (mask) mask.classList.remove("hidden"); });
  })();

  // 自动进入：若已配置过 token 则直接进
  if (API.state.token && API.state.host) {
    setConn(true); $("#login-mask").classList.add("hidden"); loadClasses().then(() => go("dashboard"));
  }
})();
