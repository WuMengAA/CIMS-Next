// 星集控 · 面板逻辑（零依赖，事件委托，渲染即绑定）
(function () {
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
    devices: "control", remote: "remote", notify: "control",
    report: "issue", bug: "issue",
    // ClassIsland 专页以"看状态"为主，只要有设备观看/控制权即可进入
    // （写操作在页内逐个按钮上再门控，不把整页锁死）。
    classisland: "control",
    // 权限与分级页是纯读信息，不需要设备权限 —— 任何能进面板的人
    // 都该看得到"自己到底能做什么"，否则权限不透明会变成猜谜。
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
      <div class="card"><h3>课表 · ${esc(API.state.classId || "（未选择班级）")}</h3>
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

  views.devices = async () => {
    const [st, map] = await Promise.all([API.deviceStatus(), API.deviceClassMap()]);
    const ds = st.devices || [];
    const unbound = ds.filter((d) => !classCell(d, map).bound).length;
    const online = ds.filter((d) => d.online).length;
    const never = ds.filter((d) => !d.reported).length;
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
        <div class="row" style="margin-bottom:8px"><button data-act="reload">刷新</button></div>
        <table><thead><tr><th>设备</th><th>所属班级</th><th>IP</th><th>版本</th><th>最后心跳</th><th>状态</th><th>操作</th></tr></thead><tbody>
        ${
          ds.length
            ? ds
                .map((d) => {
                  const c = classCell(d, map);
                  return `<tr><td>${esc(d.name)}<br><span class="muted" style="font-size:12px">${esc(d.id)}</span></td>
          <td><span class="tag ${c.bound ? "ok" : "warn"}">${esc(c.label)}</span></td>
          <td>${esc(d.ip || "—")}</td><td>${esc(d.ver)}</td><td>${esc(d.last)}</td>
          <td>${stateTag(d)}</td>
          <td>
            <button data-act="dev" data-need="control" data-id="${d.id}" data-a="restart" ${d.online ? "" : "disabled"}>重启</button>
            <button data-act="dev" data-need="control" data-id="${d.id}" data-a="refresh" ${d.online ? "" : "disabled"}>刷新</button>
            <button data-act="dev" data-need="control" data-id="${d.id}" data-a="lock" ${d.online ? "" : "disabled"}>锁屏</button>
            <button data-act="dev" data-need="control" data-id="${d.id}" data-a="screenshot" ${d.online ? "" : "disabled"}>截图</button>
          </td></tr>`;
                })
                .join("")
            : emptyRow(7, "该账户下暂无已注册设备")
        }
        </tbody></table>
        <p class="muted">重启/刷新经 CIMS management 原生指令通道；锁屏/截图经命令队列下发 <code>stelarith_task</code>，由本机 ClassIsland 插件 + 本地代理执行。</p>
      </div>`;
  };

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
                  return `<tr><td>${esc(d.name)}<br><span class="muted" style="font-size:12px">${esc(d.id)}</span></td>
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
        <iframe id="vnc-frame" title="远程屏幕" style="width:100%;height:340px;border:0;background:#000"></iframe>
        <div class="row"><button data-act="remote-stop" data-need="remote">结束会话</button></div>
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
            ${ds.map((d) => `<option value="${esc(d.id)}" ${d.id === cur.id ? "selected" : ""}>${esc(d.name)} · ${esc(classCell(d, map).label)} · ${esc(d.stateLabel)}</option>`).join("")}
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
          由网站在服务端按同一套门控逻辑解算后下发（<code>can()</code> / <code>canDevice()</code> /
          <code>canBroadcastTo()</code>），因此界面显示的能力与服务端实际放行**永远一致**。
        </p>
        <div class="grid2">
          <div class="kv">
            <div><span class="muted">角色</span><b>${esc(me.roleLabel || "—")}</b></div>
            <div><span class="muted">内容等级</span><b>${esc(me.levelLabel || "—")}</b></div>
            <div><span class="muted">管理分级</span><b>${esc(me.managementTierLabel || "—")}</b></div>
          </div>
          <div class="kv">
            <div><span class="muted">设备能力</span><b>${(me.deviceTiers || []).map((t) => NEED_LABEL_DEVICE[t] || t).join(" / ") || "无"}</b></div>
            <div><span class="muted">广播范围</span><b>${esc(me.broadcastScopeLabel || "不可广播")}</b></div>
            <div><span class="muted">账号性质</span><b>${me.isUserPlusDevice ? "注册用户 + 设备权限（叠加）" : "常规"}</b></div>
          </div>
        </div>
        ${me.managementTierDescription ? `<p class="muted">${esc(me.managementTierDescription)}</p>` : ""}
      </div>

      <div class="card"><h3>管理分级（谁管到哪一级）</h3>
        <p class="muted">
          分级回答「管到哪一级」，与「等级轴（能做什么）」「设备轴（设备多敏感）」「广播范围（能喊多远）」
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
    return `<div class="card"><h3>操作日志</h3>
      <p class="muted">集控内的关键操作（下发课表/配置、设备指令、通知、远程控制、点歌推送）都会在此留痕，便于事后追溯。</p>
      <div class="row" style="margin-bottom:8px"><button data-act="reload">刷新</button></div>
      <table><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>详情</th></tr></thead><tbody>
      ${logs.length ? logs.map(a=>`<tr><td>${esc(a.at)}</td><td>${esc(a.who)}</td><td><span class="tag">${esc(a.act)}</span></td><td>${esc(a.target)}</td><td class="muted">${esc(a.detail||"")}</td></tr>`).join("") : emptyRow(5, "暂无操作记录")}
      </tbody></table></div>`;
  };

  views.settings = async () => `
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
    <div class="card"><h3>远程控制（noVNC）</h3>
      <div class="row"><span class="muted" style="width:80px">noVNC 地址</span>
        <input id="st-novnc" value="${esc(API.state.noVncUrl)}" style="width:340px" placeholder="https://noc.example.edu/novnc/vnc.html"/></div>
      <p class="muted">「远程控制」经 CIMS 通知→设备本地代理按需启 VNC 后，面板在此 noVNC 地址内嵌观看/操作。地址由部署方提供（需可达设备 websockify，令牌鉴权）。</p>
    </div>
    <div class="card"><h3>校园点歌联动（voicehub）</h3>
      <div class="row"><span class="muted" style="width:80px">点歌站地址</span>
        <input id="st-vhost" value="${esc(API.state.voicehubHost)}" style="width:340px" placeholder="https://voicehub.example.edu"/></div>
      <div class="row"><span class="muted" style="width:80px">API Key</span>
        <input id="st-vkey" value="${esc(API.state.voicehubKey)}" style="width:340px" placeholder="vhub_..."/></div>
      <p class="muted">用于「校园点歌」视图拉取队列 / 点歌。需在 voicehub 后台生成具备 songs:read 与 songs:request 权限的 API Key。</p>
    </div>`;

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
  }

  document.querySelectorAll(".nav").forEach((b) => b.addEventListener("click", () => { go(b.dataset.view); setNav(false); }));
  $("#btn-settings").addEventListener("click", () => {
    document.querySelectorAll(".nav").forEach(x=>x.classList.remove("active"));
    current = "settings"; go("settings"); setNav(false);
  });

  // ============ 事件委托 ============
  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act;
    try {
      if (act === "reload") return go(current);
      // 通用跳转：任意按钮都能把用户送到另一个视图（免得为了"去某页"写一个专用 action）
      if (act === "go") return go(el.dataset.v);

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
        await API.deviceAction(el.dataset.id, el.dataset.a);
        API.audit("device." + el.dataset.a, el.dataset.id, "下发设备指令");
        toast(`已下发指令：${el.dataset.a} → ${el.dataset.id}`);
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
        // 勾选的班级 = 定向推送目标（多选）。为空则交给「范围」决定。
        const cls = Array.from(view.querySelectorAll("input.nt-cls:checked")).map((x) => x.value);
        try {
          const r = await API.sendNotice(t, $("#nt-scope").value, cls, c);
          const b = r && r.broadcast;
          if (b && b.deduped) {
            toast("内容与 30 秒内的上一条完全相同，已自动去重（未重复推送）");
          } else if (b && b.ok === false) {
            toast("未送达：" + (b.error || "未知原因"));
          } else if (b) {
            toast(`通知已发布，送达 ${b.delivered}/${b.total} 台设备`);
          } else {
            toast("通知已发布");
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
      else if (act === "logout") {
        API.clearAuth(); $("#login-mask").classList.remove("hidden"); toast("已退出");
      }
      else if (act === "remote-start") {
        const uid = el.dataset.id;
        try {
          await API.deviceRemoteStart(uid, "class");
          API.audit("remote.start", uid, "请求远程控制会话");
          $("#vnc-name").textContent = uid;
          $("#vncbox").classList.remove("hidden");
          $("#vnc-frame").src = "about:blank";
          $("#vnc-note").textContent = "已下发远程控制指令（CIMS 通知 → ClassIsland 插件 → 本地代理按需启动 VNC）。正在等待设备回报会话地址…";
          toast("已请求远程控制会话：" + uid);

          // 轮询扩展网关的 VNC 会话回执（设备代理启动 VNC 后回报 ip/port/token）
          const novnc = API.state.noVncUrl;
          let session = null;
          for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 1500));
            session = await API.deviceRemoteStatus(uid);
            if (session && session.ip && session.port) break;
          }
          if (!session || !session.ip) {
            $("#vnc-note").textContent = "指令已下发，但未收到设备会话回执。"
              + (novnc ? " 可改用固定 noVNC 地址手动连接。" : " 请在「设置」配置 noVNC 地址，并确保扩展网关可达。")
              + " 会话级令牌，结束即关，每次控制写审计。";
          } else if (!novnc) {
            $("#vnc-note").textContent = "已拿到设备会话（" + session.ip + ":" + session.port + "），但未配置 noVNC 地址。请在「设置」填写 noVNC 页面。";
          } else {
          try {
            const u = new URL(novnc);
            u.searchParams.set("autoconnect", "true");
            u.searchParams.set("host", session.ip);
            u.searchParams.set("port", String(session.port));
            if (session.token) u.searchParams.set("password", session.token);
            u.searchParams.set("path", "websockify");
            $("#vnc-frame").src = u.toString();
            $("#vnc-note").textContent = "已连接设备 " + session.ip + ":" + session.port + "（令牌鉴权，结束即关，写审计）。";
          } catch { $("#vnc-frame").src = novnc; }
          }
        } catch (e) { toast("远程控制失败：" + e.message); }
      }
      else if (act === "remote-stop") {
        try { await API.deviceRemoteStop($("#vnc-name").textContent); } catch (_) {}
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

  async function loadClasses() {
    const cs = await API.listClasses();
    const sel = $("#class-select");
    sel.innerHTML = cs.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
    if (!API.state.classId && cs[0]) API.setClass(cs[0].id);
    sel.value = API.state.classId || (cs[0] && cs[0].id);
    $("#user-chip").textContent = API.state.demo ? "演示用户" : "已登录";
  }
  $("#class-select").addEventListener("change", (e) => { API.setClass(e.target.value); go(current); });
  $("#btn-login").addEventListener("click", doLogin);
  $("#btn-demo").addEventListener("click", enterDemo);

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
      // 账号资料从「无班级」变为「已绑定」（例如刚在引导卡里保存过），刷新总览去掉引导卡
      if (prevClassEmpty && getClassBound() && current === "dashboard") go("dashboard");
      else if (current === "dashboard") showDashboardOnboard();
    } catch (_) { /* 拉不到就算了，不打断主流程 */ }
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
        if (c) API.setClass("classplan_" + c.replace(/[^0-9]/g, "")); // 联想班级课表名
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
    loadClasses().then(() => go("dashboard"));
    return;
  }

  // 自动进入：若已配置过 token 则直接进
  if (API.state.token && API.state.host) {
    setConn(true); $("#login-mask").classList.add("hidden"); loadClasses().then(() => go("dashboard"));
  }
})();
