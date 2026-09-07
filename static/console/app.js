// 星集控 · 面板逻辑（零依赖，事件委托，渲染即绑定）
(function () {
  const $ = (s) => document.querySelector(s);
  const view = $("#view");
  let current = "dashboard";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const toast = (m) => { $("#status-msg").textContent = m; };
  const meta = (m) => { $("#status-meta").textContent = m; };

  function setConn(ok, txt) {
    const el = $("#conn");
    el.className = "conn " + (ok ? "online" : "offline");
    el.textContent = txt || (ok ? "已连接" : "未连接");
  }

  // ============ 视图 ============
  const views = {};

  views.dashboard = async () => {
    const [devs, sched, notices] = await Promise.all([API.listDevices(), API.getSchedule(), API.listNotices()]);
    const online = devs.filter((d) => d.online).length;
    return `
      <div class="grid g4">
        <div class="kpi"><div class="n">${online}/${devs.length}</div><div class="l">设备在线</div></div>
        <div class="kpi"><div class="n">${(sched.days[0] || {}).items ? sched.days[0].items.length : "-"}</div><div class="l">今日课程</div></div>
        <div class="kpi"><div class="n">${notices.length}</div><div class="l">通知</div></div>
        <div class="kpi"><div class="n">${devs.filter(d=>!d.online).length}</div><div class="l">离线告警</div></div>
      </div>
      <div class="grid g2">
        <div class="card"><h3>设备状态</h3>
          <table><thead><tr><th>名称</th><th>IP</th><th>版本</th><th>状态</th></tr></thead><tbody>
          ${devs.map(d=>`<tr><td>${esc(d.name)}</td><td>${esc(d.ip)}</td><td>${esc(d.ver)}</td>
            <td><span class="tag ${d.online?"ok":"err"}">${d.online?"在线":"离线"}</span></td></tr>`).join("")}
          </tbody></table></div>
        <div class="card"><h3>今日课表</h3>
          <table><thead><tr><th>节次</th><th>课程</th></tr></thead><tbody>
          ${((sched.days[0]||{}).items||[]).map((c,i)=>`<tr><td>第${i+1}节</td><td>${esc(c)}</td></tr>`).join("")}
          </tbody></table></div>
      </div>
      <div class="card"><h3>最近通知</h3>
        <table><thead><tr><th>标题</th><th>范围</th><th>时间</th></tr></thead><tbody>
        ${notices.map(n=>`<tr><td>${esc(n.title)}</td><td>${esc(n.scope)}</td><td>${esc(n.at)}</td></tr>`).join("")}
        </tbody></table></div>`;
  };

  views.schedule = async () => {
    const s = await API.getSchedule();
    return `
      <div class="card"><h3>课表 · ${esc(API.state.classId)}</h3>
        <p class="muted">直接编辑后点击「保存并下发」，配置将推送到本班所有设备。</p>
        ${s.days.map(d=>`
          <div class="row" style="margin:6px 0">
            <span style="width:44px" class="muted">${esc(d.name)}</span>
            ${d.items.map((c,i)=>`<input data-day="${d.day}" data-i="${i}" value="${esc(c)}" style="width:78px"/>`).join("")}
          </div>`).join("")}
        <div class="row" style="margin-top:10px">
          <button class="primary" data-act="save-schedule">保存并下发</button>
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
          <button class="primary" data-act="save-config">保存并下发</button>
          <button data-act="reload">重新拉取</button>
        </div>
      </div>`;
  };

  views.plugins = async () => {
    const ps = await API.listPlugins();
    return `
      <div class="card"><h3>插件管理</h3>
        <table><thead><tr><th>名称</th><th>版本</th><th>状态</th><th>操作</th></tr></thead><tbody>
        ${ps.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.ver)}</td>
          <td><span class="tag ${p.enabled?"ok":""}">${p.enabled?"已启用":"已禁用"}</span></td>
          <td><button data-act="toggle-plugin" data-id="${p.id}" data-on="${p.enabled?0:1}">${p.enabled?"禁用":"启用"}</button></td></tr>`).join("")}
        </tbody></table></div>`;
  };

  views.devices = async () => {
    const ds = await API.listDevices();
    return `
      <div class="card"><h3>设备控制</h3>
        <table><thead><tr><th>名称</th><th>IP</th><th>版本</th><th>最后心跳</th><th>状态</th><th>操作</th></tr></thead><tbody>
        ${ds.map(d=>`<tr><td>${esc(d.name)}</td><td>${esc(d.ip)}</td><td>${esc(d.ver)}</td><td>${esc(d.last)}</td>
          <td><span class="tag ${d.online?"ok":"err"}">${d.online?"在线":"离线"}</span></td>
          <td>
            <button data-act="dev" data-id="${d.id}" data-a="restart">重启</button>
            <button data-act="dev" data-id="${d.id}" data-a="refresh">刷新</button>
            <button data-act="dev" data-id="${d.id}" data-a="lock">锁屏</button>
            <button data-act="dev" data-id="${d.id}" data-a="screenshot">截图</button>
          </td></tr>`).join("")}
        </tbody></table>
        <p class="muted">重启/刷新/锁屏/截图经 CIMS management 端口命令通道（HTTP→gRPC，CIMS 原生）；锁屏/截图由本机 ClassIsland 插件 + 本地代理执行。</p>
      </div>`;
  };

  views.remote = async () => {
    const ds = await API.listDevices();
    return `
      <div class="card"><h3>远程屏幕控制</h3>
        <p class="muted">点「远程控制」→ 经 CIMS 通知 → ClassIsland 插件 → 本地代理<b>按需启动 VNC</b> → 面板内嵌 noVNC 连接。会话级端口 + 令牌，结束即关；全程 HTTPS/加密隧道，每次控制写审计。</p>
        <table><thead><tr><th>名称</th><th>状态</th><th>操作</th></tr></thead><tbody>
        ${ds.map(d=>`<tr><td>${esc(d.name)}</td>
          <td><span class="tag ${d.online?"ok":"err"}">${d.online?"在线":"离线"}</span></td>
          <td><button class="primary" data-act="remote-start" data-id="${d.id}" ${d.online?"":"disabled"}>远程控制</button></td></tr>`).join("")}
        </tbody></table>
      </div>
      <div id="vncbox" class="card hidden"><h3>VNC 会话 · <span id="vnc-name"></span></h3>
        <p class="muted" id="vnc-note"></p>
        <iframe id="vnc-frame" style="width:100%;height:340px;border:0;background:#000"></iframe>
        <div class="row"><button data-act="remote-stop">结束会话</button></div>
      </div>`;
  };

  views.voicehub = async () => {
    const { now, queue } = await API.voicehubList();
    return `
      <div class="card"><h3>校园点歌 · 实时联动</h3>
        <p class="muted">数据来自 voicehub（校园点歌站，公开 API）。可在「连接设置」配置点歌站地址与 API Key。点「推送到本班屏幕」会把当前播放 + 队列写入 CIMS 资源 <code>songboard</code>，由 ClassIsland 点歌看板插件拉取上屏。</p>
        <div class="row"><button class="primary" data-act="vh-push">推送到本班屏幕</button>
          <button data-act="vh-refresh">刷新</button></div>
        <h4 style="margin:14px 0 6px">正在播放</h4>
        ${now ? `<div class="song-now"><b>${esc(now.title)}</b> — ${esc(now.artist||"")}<span class="muted"> · ${esc(now.by||"")} · ${esc(now.at||"")}</span></div>`
              : `<p class="muted">暂无播放中曲目</p>`}
        <h4 style="margin:14px 0 6px">待播队列（${queue.length}）</h4>
        <table><thead><tr><th>歌曲</th><th>点歌人</th><th>票数</th><th>提交时间</th></tr></thead><tbody>
          ${queue.map(s=>`<tr><td>${esc(s.title)}</td><td>${esc(s.by||"")}</td><td>${esc(s.votes||0)}</td><td>${esc(s.at||"")}</td></tr>`).join("")}
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

  views.notify = async () => {
    const ns = await API.listNotices();
    return `
      <div class="card"><h3>发布通知</h3>
        <div class="row">
          <input id="nt-title" placeholder="通知标题" style="width:320px"/>
          <select id="nt-scope"><option>本班</option><option>本年级</option><option>全校</option></select>
          <button class="primary" data-act="send-notice">发布</button>
        </div></div>
      <div class="card"><h3>历史通知</h3>
        <table><thead><tr><th>标题</th><th>范围</th><th>时间</th></tr></thead><tbody>
        ${ns.map(n=>`<tr><td>${esc(n.title)}</td><td>${esc(n.scope)}</td><td>${esc(n.at)}</td></tr>`).join("")}
        </tbody></table></div>`;
  };

  let chatRoom = API.CHAT_ROOM_GLOBAL || "techrep-global";
  views.chat = async () => {
    const ms = await API.listChat(chatRoom);
    const classId = API.state.classId || "";
    const roomOpts = [
      { id: API.CHAT_ROOM_GLOBAL || "techrep-global", name: "全校电教委员群" },
      classId ? { id: classId, name: "本班（" + classId + "）" } : null,
    ].filter(Boolean);
    const curName = (roomOpts.find((r) => r.id === chatRoom) || {}).name || chatRoom;
    return `
      <div class="card"><h3>班级交流 · 跨班互通</h3>
        <div class="row">
          <select id="chat-room">
            ${roomOpts.map((r) => `<option value="${esc(r.id)}" ${r.id === chatRoom ? "selected" : ""}>${esc(r.name)}</option>`).join("")}
          </select>
          <span class="muted">切换房间，不同班级/群组消息隔离</span>
        </div>
        <div class="log" style="min-height:180px;margin-top:8px">
          ${ms.length ? ms.map((m) => `<div style="margin:4px 0">
            <b>${esc(m.from)}</b> <span class="muted">${esc(m.room || "")} · ${esc(m.at)}</span><br/>${esc(m.text)}</div>`).join("")
            : `<p class="muted">「${esc(curName)}」暂无消息，发一条试试。</p>`}
        </div>
        <div class="row" style="margin-top:8px">
          <input id="chat-text" placeholder="在「${esc(curName)}」输入消息，回车发送" style="flex:1"/>
          <button class="primary" data-act="send-chat">发送</button>
        </div>
        <p class="muted">全校电教委员群用于跨班互助；本班房间仅本班可见。消息经集控网关中转并按房间隔离。</p>
      </div>`;
  };

  views.report = async () => {
    const rs = await API.listReports();
    return `
      <div class="card"><h3>故障上报</h3>
        <div class="row">
          <input id="rp-title" placeholder="故障标题" style="width:320px"/>
          <select id="rp-level"><option>高</option><option>中</option><option>低</option></select>
        </div>
        <textarea id="rp-desc" placeholder="故障描述（现象、发生时间、已尝试的操作）"></textarea>
        <div class="row"><button class="primary" data-act="submit-report">提交工单</button></div>
      </div>
      <div class="card"><h3>我的工单</h3>
        <table><thead><tr><th>标题</th><th>等级</th><th>状态</th><th>时间</th></tr></thead><tbody>
        ${rs.map(r=>`<tr><td>${esc(r.title)}</td><td>${esc(r.level)}</td>
          <td><span class="tag ${r.status==="已解决"?"ok":"warn"}">${esc(r.status)}</span></td><td>${esc(r.at)}</td></tr>`).join("")}
        </tbody></table></div>`;
  };

  views.bug = async () => {
    const bs = await API.listBugs();
    return `
      <div class="card"><h3>提交 Bug</h3>
        <div class="row"><input id="bg-title" placeholder="问题标题" style="width:320px"/></div>
        <textarea id="bg-steps" placeholder="复现步骤：1) ... 2) ... 3) ..."></textarea>
        <textarea id="bg-log" placeholder="粘贴相关日志（ClassIsland / CIMS 日志）" style="min-height:80px"></textarea>
        <div class="row"><button class="primary" data-act="submit-bug">提交</button>
          <span class="muted">提交内容含环境信息与日志，便于维护者定位。</span></div>
      </div>
      <div class="card"><h3>我提交的</h3>
        <table><thead><tr><th>标题</th><th>状态</th><th>时间</th></tr></thead><tbody>
        ${bs.map(b=>`<tr><td>${esc(b.title)}</td><td>${esc(b.status)}</td><td>${esc(b.at)}</td></tr>`).join("")}
        </tbody></table></div>`;
  };

  views.audit = async () => {
    const as = await API.listAudit();
    return `<div class="card"><h3>操作日志</h3>
      <table><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th></tr></thead><tbody>
      ${as.map(a=>`<tr><td>${esc(a.at)}</td><td>${esc(a.who)}</td><td>${esc(a.act)}</td><td>${esc(a.target)}</td></tr>`).join("")}
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

  // ============ 渲染与导航 ============
  async function go(v) {
    current = v || current;
    document.querySelectorAll(".nav").forEach((b) => b.classList.toggle("active", b.dataset.view === current));
    view.innerHTML = `<p class="muted">加载中…</p>`;
    try {
      view.innerHTML = await views[current]();
      toast("就绪");
    } catch (e) {
      view.innerHTML = `<div class="card"><h3>加载失败</h3><p class="muted">${esc(e.message)}</p></div>`;
      toast("错误：" + e.message);
    }
    meta(`视图：${current} · ${API.state.demo ? "演示模式" : "后端模式"}`);
  }

  document.querySelectorAll(".nav").forEach((b) => b.addEventListener("click", () => go(b.dataset.view)));
  $("#btn-settings").addEventListener("click", () => {
    document.querySelectorAll(".nav").forEach(x=>x.classList.remove("active"));
    current = "settings"; go("settings");
  });

  // ============ 事件委托 ============
  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act;
    try {
      if (act === "reload") return go(current);

      if (act === "save-schedule") {
        const s = await API.getSchedule();
        view.querySelectorAll("input[data-day]").forEach((i) => {
          const d = s.days.find((x) => String(x.day) === i.dataset.day);
          if (d) d.items[+i.dataset.i] = i.value;
        });
        await API.putSchedule(API.state.classId, s);
        toast("课表已保存并下发");
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
        toast("插件状态已更新"); go("plugins");
      }
      else if (act === "dev") {
        await API.deviceAction(el.dataset.id, el.dataset.a);
        toast(`已下发指令：${el.dataset.a} → ${el.dataset.id}`);
      }
      else if (act === "send-notice") {
        const t = $("#nt-title").value.trim(); if (!t) return toast("请输入标题");
        await API.sendNotice(t, $("#nt-scope").value);
        toast("通知已发布"); go("notify");
      }
      else if (act === "send-chat") {
        const t = $("#chat-text").value.trim(); if (!t) return;
        await API.sendChat(t, API.state.classId || "电教委员", chatRoom); toast("已发送"); go("chat");
      }
      else if (act === "submit-report") {
        const t = $("#rp-title").value.trim(); if (!t) return toast("请输入标题");
        await API.submitReport({ title: t, level: $("#rp-level").value, desc: $("#rp-desc").value });
        toast("工单已提交"); go("report");
      }
      else if (act === "submit-bug") {
        const t = $("#bg-title").value.trim(); if (!t) return toast("请输入标题");
        await API.submitBug({ title: t, steps: $("#bg-steps").value, log: $("#bg-log").value });
        toast("Bug 已提交，感谢反馈"); go("bug");
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
          let acct = API.acct();
          if (!acct) {
            const list = await API.cims("/account/list");
            acct = Array.isArray(list) && list[0] && (list[0].id || list[0]);
          }
          if (!acct) return toast("无法确定集控账户");
          const { now, queue } = await API.voicehubList();
          await API.cims(`/account/${acct}/Components/write?name=songboard`, {
            method: "POST",
            body: JSON.stringify({ name: "songboard", now: now || null, queue: queue || [], pushedAt: Date.now() }),
          });
          toast("点歌看板已推送到本班屏幕（CIMS 资源 songboard 写入）");
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
    if (e.target && e.target.id === "chat-room") { chatRoom = e.target.value; go("chat"); }
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

  // 内嵌于网站 /admin/console：复用网站会话，经服务端代理访问 CIMS，跳过自身登录
  if (location.pathname.startsWith("/admin/console")) {
    API.setMgmtHost("/api/console/cims");
    API.setClientHost("/api/console/cims");
    API.setDemo(false);
    API.setEmbedded(true);
    API.setSiteHost(""); // 同源：协作/上报走网站 /api/feedback
    $("#login-mask").classList.add("hidden");
    setConn(true, "网站代理");
    loadClasses().then(() => go("dashboard"));
    return;
  }

  // 自动进入：若已配置过 token 则直接进
  if (API.state.token && API.state.host) {
    setConn(true); $("#login-mask").classList.add("hidden"); loadClasses().then(() => go("dashboard"));
  }
})();
