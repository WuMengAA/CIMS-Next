<script lang="ts">
  import { onMount } from "svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { userCan } from "$lib/permissions.js";
  import { School, Plus, Trash2, Save, RefreshCw, History, ExternalLink, Pencil, Download, Upload, Sparkles, Table2, Copy, FileSpreadsheet } from "@lucide/svelte";

  type R = Record<string, any>;
  let snap = $state<R | null>(null);
  let canEdit = $state(false);
  let busy = $state(false);
  let msg = $state("");
  const api = "/api/campus/class8";

  async function load() {
    const r = await fetch(api);
    const j = await r.json();
    snap = j;
    canEdit = !!(j.viewer && userCan({ role: j.viewer.role } as any, "manageContent"));
  }
  async function post(body: R, label = "") {
    busy = true; msg = "";
    try {
      const r = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || j.error) { msg = j.error || "保存失败"; return; }
      snap = j;
      msg = "✓ 已保存" + (label ? "：" + label : "");
    } catch (e: any) { msg = "网络错误: " + String(e); } finally { busy = false; }
  }
  const del = (kind: string, id: number, label = "") => post({ op: "delete", kind, id }, label);
  onMount(load);

  // 新增行局部状态
  let nLeader = $state({ subject: "", name: "", icon: "" });
  let nRank = $state({ group_name: "", avg: 0, honor: "" });
  let nMember = $state<Record<number, string>>({});
  let nStar = $state({ month: "", category: "", subject: "", reason: "" });
  let nEvent = $state({ at: "", title: "", body: "", photosText: "" });
  let nSpot = $state({ key: "", title: "", slogan: "", body: "" });
  // 照片文本 → photos 数组（每行 "图片URL|说明"）
  const parsePhotos = (txt: string) => txt.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
    const [src, ...rest] = l.split("|");
    return { src: src.trim(), caption: rest.join("|").trim() || "" };
  });


  // 星光/事件编辑态
  let editStar = $state<Record<number, any>>({});
  let editEvent = $state<Record<number, any>>({});
  let editSpot = $state<Record<number, any>>({});
  // 导入导出
  let exportData = $state("");
  let importText = $state("");
  let showExport = $state(false);
  async function doExport() {
    const r = await fetch(api + "?export=1");
    const j = await r.json();
    exportData = JSON.stringify(j, null, 2);
    showExport = true;
  }
  async function doImport() {
    if (!confirm("导入将覆盖全部班级数据（含小组/成员/排名/星光/事件/点位），确定继续？")) return;
    let data; try { data = JSON.parse(importText); } catch { msg = "JSON 解析失败"; return; }
    await post({ op: "import", data }, "全量导入");
  }




  // ══ 表格导入（Excel .xls HTML / CSV）══
  let impKind = $state("members");
  let impFile = $state("");
  let impRows = $state<string[][] | null>(null);
  let impPreview = $state<{ cells: string[]; st: string }[] | null>(null);
  let impExam = $state<number | null>(null);
  let impSubject = $state("语文");
  const IMP_KINDS: Record<string, { label: string; head: string[] }> = {
    members: { label: "成员名单（小组|姓名|角色|座右铭|座位）", head: ["小组", "姓名", "角色", "座右铭", "座位"] },
    groups: { label: "小组（组名|目标|emoji）", head: ["组名", "目标", "emoji"] },
    ranks: { label: "排名（小组|均分|荣誉）", head: ["小组", "均分", "荣誉"] },
    stars: { label: "星光榜（月份|类别|同学|理由）", head: ["月份", "类别", "同学", "理由"] },
    events: { label: "大事记（时间|标题|内容）", head: ["时间", "标题", "内容"] },
    scores: { label: "成绩（姓名|分数，绑考试+科目）", head: ["姓名", "分数"] }
  };
  async function parseImportFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const text = await f.text();
    const rows: string[][] = [];
    if (/^\s*</.test(text)) {
      const doc = new DOMParser().parseFromString(text, "text/html");
      doc.querySelectorAll("table tr").forEach((tr) => {
        const cells = Array.from(tr.querySelectorAll("td,th")).map((c) => (c.textContent || "").trim());
        if (cells.some((c) => c)) rows.push(cells);
      });
    } else {
      const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
      for (const l of lines) {
        const cells: string[] = []; let cur = ""; let q = false;
        for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { cells.push(cur.trim()); cur = ""; } else cur += ch; }
        cells.push(cur.trim());
        if (cells.some((c) => c)) rows.push(cells);
      }
    }
    if (rows.length) rows.shift(); // 跳过表头
    impRows = rows;
    impPreview = buildPreview(rows);
  }
  // 差异预览：标注每行将「新增 / 跳过」
  function buildPreview(rows: string[][]) {
    const knownNames = new Set<string>();
    for (const g of snap?.groups || []) for (const m of g.members || []) knownNames.add(g.name + "|" + m.name);
    const knownGroups = new Set((snap?.groups || []).map((g: any) => g.name));
    const knownRanks = new Set((snap?.ranks || []).map((r: any) => r.group_name));
    if (impKind === "members") {
      return rows.map(function (r) { const key = (r[0] || "") + "|" + (r[1] || ""); return { cells: r, st: knownNames.has(key) ? "跳过(已存在)" : "新增" }; });
    }
    if (impKind === "groups") return rows.map(function (r) { return { cells: r, st: knownGroups.has(r[0] || "") ? "跳过(组已存在)" : "新增" }; });
    if (impKind === "ranks") return rows.map(function (r) { return { cells: r, st: knownRanks.has(r[0] || "") ? "跳过(已存在)" : "新增" }; });
    if (impKind === "scores") return rows.map(function (r) { return { cells: r, st: Array.from(knownNames.values()).some(function (k) { return k.endsWith("|" + (r[0] || "")); }) ? "新增" : "跳过(查无此人)" }; });
    return rows.map(function (r) { return { cells: r, st: "新增" }; });
  }
  async function doTableImport() {
    if (!impRows || !impRows.length) { msg = "请先选择文件并解析"; return; }
    const kindMap = (r: string[]): Record<string, unknown> => {
      if (impKind === "members") return { group: r[0], name: r[1], role: r[2], motto: r[3], seat: r[4] };
      if (impKind === "stars") return { month: r[0], category: r[1], subject: r[2], reason: r[3] };
      if (impKind === "events") return { at: r[0], title: r[1], body: r[2] };
      if (impKind === "groups") return { name: r[0], goal: r[1], emoji: r[2] };
      if (impKind === "ranks") return { group: r[0], avg: r[1], honor: r[2] };
      return { name: r[0], score: r[1] };
    };
    const payload: Record<string, unknown> = { op: "importTable", kind: impKind, rows: impRows.map(kindMap).filter(Boolean) };
    if (impKind === "scores") { payload.exam_id = impExam; payload.subject = impSubject; }
    const res = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const j = await res.json();
    impRows = null; impFile = "";
    msg = "✓ 表格导入完成" + (j.importResult ? "（成功 " + j.importResult.ok + " 行，跳过 " + j.importResult.skip + " 行）" : "");
    await load();
  }

  // ══ Excel 导出（HTML .xls，Excel/WPS 直接打开，中文 OK）══
  const escX = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  function exportXls(filename: string, sheets: { label: string; head: string[]; rows: (string | number)[][] }[]) {
    const sc = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"><style>table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px 8px;font-size:12px}th{background:#f0eee6;font-weight:700}h3{font-size:14px;margin:14px 0 6px}</style></head><body>';
    const tables = sheets.map(function (s) {
      return '<h3>' + escX(s.label) + '</h3><table><tr>' + s.head.map((h) => "<th>" + escX(h) + "</th>").join("") + "</tr>" +
        s.rows.map((r) => "<tr>" + r.map((c) => "<td>" + escX(c) + "</td>").join("") + "</tr>").join("") + "</table>";
    }).join("");
    const blob = new Blob(["﻿", sc + tables + "</body></html>"], { type: "application/vnd.ms-excel;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
  }
  // 成员名单表
  const membersXls = () => {
    const rows: (string | number)[][] = [];
    for (const g of snap.groups || []) for (const m of g.members || []) rows.push([g.name, m.name, m.role === "组长" ? "组长" : m.role, m.motto || ""]);
    exportXls("班级成员名单.xls", [{ label: snap.profile.class_name + " · 成员名单（" + rows.length + " 人）", head: ["小组", "姓名", "角色", "座右铭"], rows }]);
  };
  const ranksXls = () => exportXls("班级排名表.xls", [{ label: "官方排名", head: ["名次", "小组", "均分", "荣誉"], rows: (snap.ranks || []).map((r, i) => [i + 1, r.group_name, r.avg, r.honor || ""]) }]);
  const eventsXls = () => exportXls("运动会与大事记.xls", [{ label: "班级大事记 / 运动会", head: ["时间", "标题", "内容", "照片数"], rows: (snap.events || []).map((e) => [e.at, e.title, e.body || "", e.photos?.length || 0]) }]);
  const starsXls = () => exportXls("星光榜.xls", [{ label: "月度星光榜", head: ["月份", "类别", "同学", "理由"], rows: (snap.stars || []).map((s) => [s.month, s.category, s.subject, s.reason]) }]);
  const allXls = () => exportXls("班级数据全表.xls", [
    { label: "成员名单", head: ["小组", "姓名", "角色", "座右铭"], rows: (() => { const r: (string | number)[][] = []; for (const g of snap.groups || []) for (const m of g.members || []) r.push([g.name, m.name, m.role === "组长" ? "组长" : m.role, m.motto || ""]); return r; })() },
    { label: "官方排名", head: ["名次", "小组", "均分", "荣誉"], rows: (snap.ranks || []).map((r, i) => [i + 1, r.group_name, r.avg, r.honor || ""]) },
    { label: "大事记 / 运动会", head: ["时间", "标题", "内容", "照片数"], rows: (snap.events || []).map((e) => [e.at, e.title, e.body || "", e.photos?.length || 0]) },
    { label: "星光榜", head: ["月份", "类别", "同学", "理由"], rows: (snap.stars || []).map((s) => [s.month, s.category, s.subject, s.reason]) },
    { label: "学科领航人", head: ["学科", "领航人"], rows: (snap.leaders || []).map((l) => [l.subject, l.name]) }
  ]);
  // 视图：edit 编辑 / table 快捷表格
  let view = $state<"edit" | "table">("edit");
  // AI 侧边面板
  let aiOpen = $state(false);
  let aiOut = $state("");
  let aiBusy = $state(false);
  const aiSummary = () => {
    if (!snap) return "";
    const g = snap.groups || [], r = snap.ranks || [], e = snap.events || [], l = snap.leaders || [];
    const total = g.reduce((a, x) => a + (x.members?.length || 0), 0);
    const top = r[0];
    const sports = e.filter((x: any) => x.title?.includes("运动会"));
    let s = snap.profile?.class_name || "班级";
    s += "，共 " + g.length + " 个小组、" + total + " 名同学，配备 " + l.length + " 位学科领航人。";
    if (top) s += " 期末均分领跑小组为「" + top.group_name + "」（" + top.avg.toFixed(2) + " 分），" + (top.honor || "") + "。";
    if (sports.length) s += " 运动会历程：" + sports.map((x: any) => (x.title || "").split("·")[0] + "（" + (x.photos?.length || 0) + " 张照片）").join("、") + "。";
    if (r.length > 1) s += " 排名依次为：" + r.map((x: any) => x.group_name).join("、") + "。";
    return s;
  };
  // AI 快速生成（填入编辑框）
  async function aiGen(kind: string) {
    aiBusy = true;
    await new Promise((res) => setTimeout(res, 350));
    if (kind === "intro") {
      snap.profile.intro = snap.profile.class_name + "，以小组为单元、以成长看板为镜，把每一天的努力显性化。共 " + snap.groups.length + " 个小组、" + (snap.groups.reduce((a: number, x: any) => a + (x.members?.length || 0), 0)) + " 名同学，在" + (snap.leaders.length || 0) + " 位学科领航人带领下，不比基础比进步，不比聪明比勤奋。";
      aiOut = "✓ 班级简介已生成，可点击下方「保存档案」提交。";
    } else if (kind === "sports") {
      const sp = (snap.events || []).filter((x: any) => x.title?.includes("运动会"));
      const line = sp.length ? "本届运动会：各班选手奋力拼搏，接力赛与个人项目中均留下精彩瞬间。" : "本班运动会风采待补充——可在下方「大事记」新建运动会并附照片。";
      nEvent.title = "咸林中学运动会 · " + snap.profile.class_name;
      nEvent.body = line;
      aiOut = "✓ 运动会文案已填入「新建事件」表单，补上日期与照片即可保存。";
    } else if (kind === "points") {
      const names = (snap.groups || []).map((g: any) => g.name + "（" + g.members?.map((m: any) => m.name).join("、") + "）").join("\n");
      aiOut = "点名表（共 " + (snap.groups.reduce((a: number, x: any) => a + (x.members?.length || 0), 0)) + " 人）：\n" + names;
    } else if (kind === "analysis") {
      const r = snap.ranks || [];
      aiOut = "成绩分析：期末均分最高 " + (r[0]?.group_name || "—") + "（" + (r[0]?.avg || 0) + " 分），最低 " + (r[r.length - 1]?.group_name || "—") + "（" + (r[r.length - 1]?.avg || 0) + " 分）。建议对尾部小组开展结对帮扶，保持头部优势。";
    }
    aiBusy = false;
  }

  // 成绩录入
  const SUBJECTS = ["语文", "数学", "英语", "物理", "化学", "生物", "政治", "历史", "地理"];
  let sExam = $state<number | null>(null);
  let sSubject = $state("语文");
  let scoreMap = $state<Record<number, string>>({});
  let scoresLoaded = $state(false);
  async function loadScores() {
    const r = await fetch(api + "?scores=1");
    const j = await r.json();
    if (j.scoresByExam) snap = Object.assign({}, snap, { scoresByExam: j.scoresByExam });
    scoresLoaded = true;
  }
  async function saveAllScores() {
    const items = [];
    for (const g of snap.groups) for (const m of g.members) {
      const v = scoreMap[m.id]; if (v === undefined || v === "") continue;
      items.push({ member_id: m.id, group_id: g.id, subject: sSubject, score: Number(v) || 0 });
    }
    if (!items.length) { msg = "未输入任何分数"; return; }
    await post({ op: "scoreBatch", exam_id: sExam, items }, "成绩");
  }
  function pickExam(eid: number) {
    sExam = eid; scoreMap = {};
    const by = (snap as any).scoresByExam?.[eid]?.[sSubject] || {};
  }
</script>

<svelte:head><title>班级栏目管理 | Stelarith</title></svelte:head>

<div class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 md:px-8">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 class="flex items-center gap-2 font-heading text-2xl font-semibold tracking-tight">
        <School class="size-6 text-primary" /> 班级栏目管理
      </h1>
      <p class="mt-1 text-sm text-muted-foreground">档案 · 领航人 · 小组 · 排名 · 星光 · 大事记 · 变更记录（一处保存，全站同步）</p>
    </div>
    <div class="flex items-center gap-2">
      {#if msg}<Badge variant="outline" class="text-[11px]">{msg}</Badge>{/if}
      <Button size="sm" variant={view === "table" ? "default" : "outline"} onclick={() => (view = "table")}>表格</Button>
      <Button size="sm" variant={view === "edit" ? "default" : "outline"} onclick={() => (view = "edit")}>编辑</Button>
      <Button size="sm" variant="outline" disabled={busy || !snap} onclick={() => (aiOpen = !aiOpen)}><Sparkles class="mr-1 size-3.5" />AI 助手</Button>
      <a href="/campus/2028/class8" target="_blank" rel="noopener">
        <Button variant="outline" size="sm"><ExternalLink class="mr-1 size-3.5" />推出到前台</Button>
      </a>
      <Button variant="outline" size="sm" onclick={load} disabled={busy}><RefreshCw class="mr-1 size-3.5 {busy ? 'animate-spin' : ''}" />刷新</Button>
    </div>
  </div>

  {#if !snap}
    <p class="text-sm text-muted-foreground">加载中…</p>
  {:else if !canEdit}
    <div class="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">仅班主任或管理员可维护班级内容。</div>
  {:else}
{#if view === "edit"}
    <!-- ══ 班级档案 ══ -->
    <section class="rounded-xl border border-border/60 bg-card p-5">
      <h2 class="mb-3 font-heading text-lg font-semibold">班级档案</h2>
      <div class="grid gap-3 sm:grid-cols-2">
        <div><Label>班级名称</Label><Input bind:value={snap.profile.class_name} /></div>
        <div><Label>班主任</Label><Input bind:value={snap.profile.teacher} /></div>
        <div class="sm:col-span-2"><Label>口号 slogan</Label><Input bind:value={snap.profile.slogan} /></div>
        <div class="sm:col-span-2"><Label>副标题（展板副标题）</Label><Input bind:value={snap.profile.subtitle} /></div>
        <div class="sm:col-span-2"><Label>班级寄语 quote（展板板块四）</Label><Input bind:value={snap.profile.quote} /></div>
        <div class="sm:col-span-2"><Label>理念 concept</Label><Input bind:value={snap.profile.concept} /></div>
        <div class="sm:col-span-2"><Label>简介 intro</Label><Input bind:value={snap.profile.intro} /></div>
      </div>
      <Button class="mt-4" size="sm" disabled={busy} onclick={() => post({ op: "profile", class_name: snap.profile.class_name, teacher: snap.profile.teacher, slogan: snap.profile.slogan, subtitle: snap.profile.subtitle, quote: snap.profile.quote, concept: snap.profile.concept, intro: snap.profile.intro }, "档案")}>
        <Save class="mr-1.5 size-3.5" />保存档案
      </Button>
    </section>

    <!-- ══ 学科领航人 ══ -->
    <section class="rounded-xl border border-border/60 bg-card p-5">
      <h2 class="mb-3 font-heading text-lg font-semibold">学科领航人</h2>
      <div class="flex flex-col gap-2">
        {#each snap.leaders as l, i (l.id)}
          <div class="flex flex-wrap items-center gap-2">
            <Input class="w-14" bind:value={l.icon} />
            <Input class="w-24" bind:value={l.subject} />
            <Input class="flex-1 min-w-28" bind:value={l.name} />
            <Button size="sm" variant="outline" disabled={busy} onclick={() => post({ op: "leader", id: l.id, subject: l.subject, name: l.name, icon: l.icon, seq: i + 1 }, "领航人")}><Save class="size-3.5" /></Button>
            <Button size="sm" variant="ghost" disabled={busy} onclick={() => post({ op: "leaderDelete", id: l.id }, "删领航人")}><Trash2 class="size-3.5 text-destructive" /></Button>
          </div>
        {/each}
        <div class="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
          <Input class="w-14" bind:value={nLeader.icon} placeholder="图标" />
          <Input class="w-24" bind:value={nLeader.subject} placeholder="学科" />
          <Input class="flex-1 min-w-28" bind:value={nLeader.name} placeholder="姓名" />
          <Button size="sm" variant="outline" disabled={busy || !nLeader.name} onclick={() => post({ op: "leader", subject: nLeader.subject, name: nLeader.name, icon: nLeader.icon }, "新领航人")}><Plus class="mr-1 size-3.5" />新增</Button>
        </div>
      </div>
    </section>

    <!-- ══ 官方排名 ══ -->
    <section class="rounded-xl border border-border/60 bg-card p-5">
      <h2 class="mb-3 font-heading text-lg font-semibold">官方排名（期末均分 · 展板板块三）</h2>
      <div class="flex flex-col gap-2">
        {#each snap.ranks as r, i (r.id)}
          <div class="flex flex-wrap items-center gap-2">
            <span class="w-5 text-right font-mono text-xs text-muted-foreground">{i + 1}</span>
            <Input class="flex-1 min-w-28" bind:value={r.group_name} />
            <Input class="w-24" type="number" step="0.01" bind:value={r.avg} />
            <Input class="w-32" bind:value={r.honor} />
            <Button size="sm" variant="outline" disabled={busy} onclick={() => post({ op: "rank", id: r.id, group_name: r.group_name, avg: Number(r.avg) || 0, honor: r.honor, seq: i + 1 }, "排名")}><Save class="size-3.5" /></Button>
            <Button size="sm" variant="ghost" disabled={busy} onclick={() => post({ op: "rankDelete", id: r.id }, "删排名")}><Trash2 class="size-3.5 text-destructive" /></Button>
          </div>
        {/each}
        <div class="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
          <span class="w-5"></span>
          <Input class="flex-1 min-w-28" bind:value={nRank.group_name} placeholder="小组名" />
          <Input class="w-24" type="number" step="0.01" bind:value={nRank.avg} placeholder="均分" />
          <Input class="w-32" bind:value={nRank.honor} placeholder="荣誉徽章" />
          <Button size="sm" variant="outline" disabled={busy || !nRank.group_name} onclick={() => post({ op: "rank", group_name: nRank.group_name, avg: Number(nRank.avg) || 0, honor: nRank.honor }, "新排名")}><Plus class="mr-1 size-3.5" />新增</Button>
        </div>
      </div>
    </section>

    <!-- ══ 小组与成员 ══ -->
    <section class="rounded-xl border border-border/60 bg-card p-5">
      <h2 class="mb-3 font-heading text-lg font-semibold">小组与成员（展板板块二）</h2>
      <div class="grid gap-3 md:grid-cols-2">
        {#each snap.groups as g (g.id)}
          <div class="rounded-lg border border-border/60 p-3">
            <div class="flex flex-wrap items-center gap-2">
              <Input class="w-12" bind:value={g.emoji} />
              <Input class="flex-1 min-w-24" bind:value={g.name} />
              <span class="text-xs text-muted-foreground">{g.members.length}人</span>
              <Button size="sm" variant="outline" disabled={busy} onclick={() => post({ op: "group", id: g.id, name: g.name, emoji: g.emoji, goal: g.goal }, "小组")}><Save class="size-3.5" /></Button>
              <Button size="sm" variant="ghost" disabled={busy} onclick={() => del("group", g.id, "删组")}><Trash2 class="size-3.5 text-destructive" /></Button>
            </div>
            <Input class="mt-2 w-full" bind:value={g.goal} placeholder="小组目标" />
            <div class="mt-2 flex flex-col gap-1.5">
              {#each g.members as m (m.id)}
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="w-16 truncate text-xs font-medium">{m.name}</span>
                  <Input class="w-20 text-xs" bind:value={m.role} placeholder="角色" />
                  <Input class="flex-1 min-w-20 text-xs" bind:value={m.motto} placeholder="座右铭" />
                  <Button size="sm" variant="ghost" disabled={busy} onclick={() => post({ op: "member", id: m.id, group_id: g.id, name: m.name, role: m.role, motto: m.motto, seat: m.seat }, "成员")}><Save class="size-3.5" /></Button>
                  <Button size="sm" variant="ghost" disabled={busy} onclick={() => del("member", m.id, "删成员")}><Trash2 class="size-3.5 text-destructive" /></Button>
                </div>
              {/each}
              <div class="flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-1.5">
                <Input class="flex-1 min-w-20 text-xs" bind:value={nMember[g.id]} placeholder="新成员姓名" />
                <Button size="sm" variant="outline" disabled={busy || !nMember[g.id]} onclick={() => post({ op: "member", group_id: g.id, name: nMember[g.id] }, "新成员").then(() => (nMember[g.id] = ""))}><Plus class="size-3.5" />加人</Button>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </section>

    <!-- ══ 考试管理 ══ -->
    <section class="rounded-xl border border-border/60 bg-card p-5">
      <h2 class="mb-3 font-heading text-lg font-semibold">考试管理</h2>
      <div class="flex flex-col gap-1.5">
        {#each snap.exams as e (e.id)}
          <div class="flex items-center gap-2 text-xs">
            <span class="shrink-0 font-mono text-muted-foreground">{e.exam_date}</span>
            <span class="font-medium">{e.title}</span>
            <span class="ml-auto shrink-0 text-[10px] text-muted-foreground">{e.seq} 场</span>
            <Button size="sm" variant="ghost" disabled={busy} onclick={() => { if (confirm("删除考试「" + e.title + "」将同时删除该场全部成绩，确定？")) post({ op: "examDelete", id: e.id }, "删考试"); }}><Trash2 class="size-3.5 text-destructive" /></Button>
          </div>
        {/each}
        {#if (snap.exams || []).length === 0}
          <p class="text-xs text-muted-foreground">暂无考试 · 成绩录入前先在这里添加？</p>
        {/if}
      </div>
    </section>

    <!-- ══ 成绩批量录入 ══ -->
    <section class="rounded-xl border border-border/60 bg-card p-5">
      <h2 class="mb-3 font-heading text-lg font-semibold">成绩批量录入</h2>
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <select class="rounded-md border border-border/60 bg-background px-2 py-1.5 text-sm" bind:value={sExam}>
          <option value={null} disabled>选择考试</option>
          {#each snap.exams as e (e.id)}<option value={e.id}>{e.title}</option>{/each}
        </select>
        <select class="rounded-md border border-border/60 bg-background px-2 py-1.5 text-sm" bind:value={sSubject}>
          {#each SUBJECTS as s}<option value={s}>{s}</option>{/each}
        </select>
        <Button size="sm" variant="outline" disabled={busy} onclick={loadScores}>载入已录分数</Button>
        <Button size="sm" disabled={busy || !sExam} onclick={saveAllScores}><Save class="mr-1 size-3.5" />保存该科全部分数</Button>
      </div>
      {#if sExam}
        <div class="grid gap-3 md:grid-cols-2">
          {#each snap.groups as g (g.id)}
            <div class="rounded-lg border border-border/60 p-3">
              <div class="mb-2 text-sm font-semibold">{g.emoji}{g.name}</div>
              <div class="flex flex-col gap-1">
                {#each g.members as m (m.id)}
                  <div class="flex items-center gap-2 text-xs">
                    <span class="w-16 truncate">{m.name}</span>
                    <Input class="h-7 w-20 text-xs" type="number" step="0.1" min="0" max="100"
                      bind:value={scoreMap[m.id]}
                      onblur={() => { const by = sExam == null ? null : (snap as any).scoresByExam?.[sExam]; if (by?.[m.id]?.[sSubject] !== undefined && scoreMap[m.id] === undefined) scoreMap[m.id] = String(by[m.id][sSubject]); }} />
                    <span class="text-[10px] text-muted-foreground">{sSubject}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
        <p class="mt-2 text-xs text-muted-foreground">预填：点「载入已录分数」后，未改动即留空表示不覆盖；改动保存将覆盖该科该生成绩。</p>
      {/if}
    </section>

    <!-- ══ 文化点位 ══ -->
    <section class="rounded-xl border border-border/60 bg-card p-5">
      <h2 class="mb-3 font-heading text-lg font-semibold">文化点位</h2>
      <div class="flex flex-col gap-1.5">
        {#each snap.spots as sp (sp.id)}
          {#if editSpot[sp.id]}
            <div class="grid grid-cols-4 gap-1.5 border border-border/40 rounded-md p-1.5 text-xs md:grid-cols-[4rem_1fr_1fr_1fr]">
              <Input class="text-xs" bind:value={editSpot[sp.id].key} placeholder="key" />
              <Input class="text-xs" bind:value={editSpot[sp.id].title} placeholder="标题" />
              <Input class="text-xs" bind:value={editSpot[sp.id].slogan} placeholder="口号" />
              <Input class="text-xs" bind:value={editSpot[sp.id].body} placeholder="内容" />
              <Button class="col-span-2 md:col-span-4" size="sm" variant="outline" disabled={busy} onclick={() => post({ op: "spot", id: sp.id, key: editSpot[sp.id].key, title: editSpot[sp.id].title, slogan: editSpot[sp.id].slogan, body: editSpot[sp.id].body }, "改点位").then(() => (editSpot[sp.id] = null))}>保存点位</Button>
            </div>
          {:else}
            <div class="flex items-center gap-2 text-xs">
              <span class="shrink-0 font-mono text-[10px] text-muted-foreground">{sp.key}</span>
              <span class="font-medium">{sp.title}</span>
              <span class="min-w-0 flex-1 truncate text-muted-foreground">「{sp.slogan}」{sp.body}</span>
              <Button size="sm" variant="ghost" disabled={busy} onclick={() => (editSpot[sp.id] = { key: sp.key, title: sp.title, slogan: sp.slogan, body: sp.body })}><Pencil class="size-3.5" /></Button>
              <Button size="sm" variant="ghost" disabled={busy} onclick={() => post({ op: "spotDelete", id: sp.id }, "删点位")}><Trash2 class="size-3.5 text-destructive" /></Button>
            </div>
          {/if}
        {/each}
        <div class="flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-1.5">
          <Input class="w-16 text-xs" bind:value={nSpot.key} placeholder="key" />
          <Input class="flex-1 min-w-20 text-xs" bind:value={nSpot.title} placeholder="标题" />
          <Input class="w-32 text-xs" bind:value={nSpot.slogan} placeholder="口号" />
          <Input class="flex-1 min-w-20 text-xs" bind:value={nSpot.body} placeholder="内容" />
          <Button size="sm" variant="outline" disabled={busy || !nSpot.title} onclick={() => post({ op: "spot", key: nSpot.key, title: nSpot.title, slogan: nSpot.slogan, body: nSpot.body }, "新点位").then(() => (nSpot = { key: "", title: "", slogan: "", body: "" }))}><Plus class="size-3.5" />加点位</Button>
        </div>
      </div>
    </section>

    <!-- ══ 星光榜 / 大事记 ══ -->
    <div class="grid gap-4 md:grid-cols-2">
      <section class="rounded-xl border border-border/60 bg-card p-5">
        <h2 class="mb-3 font-heading text-lg font-semibold">星光榜</h2>
        <div class="mb-3 grid grid-cols-2 gap-2">
          <Input class="text-xs" bind:value={nStar.month} placeholder="月份 2026-09" />
          <Input class="text-xs" bind:value={nStar.category} placeholder="类别" />
          <Input class="text-xs" bind:value={nStar.subject} placeholder="同学" />
          <Input class="text-xs" bind:value={nStar.reason} placeholder="理由" />
          <Button class="col-span-2" size="sm" variant="outline" disabled={busy || !nStar.subject} onclick={() => post({ op: "star", month: nStar.month, category: nStar.category, subject: nStar.subject, reason: nStar.reason }, "星光").then(() => (nStar = { month: "", category: "", subject: "", reason: "" }))}><Plus class="mr-1 size-3.5" />新增星光</Button>
        </div>
        <div class="flex flex-col gap-1.5">
          {#each snap.stars as s (s.id)}
            {#if editStar[s.id]}
              <div class="grid grid-cols-2 gap-1.5 border border-border/40 rounded-md p-1.5 text-xs">
                <Input class="text-xs" bind:value={editStar[s.id].month} placeholder="月份" />
                <Input class="text-xs" bind:value={editStar[s.id].category} placeholder="类别" />
                <Input class="text-xs" bind:value={editStar[s.id].subject} placeholder="同学" />
                <Input class="text-xs" bind:value={editStar[s.id].reason} placeholder="理由" />
                <Button class="col-span-2" size="sm" variant="outline" disabled={busy} onclick={() => post({ op: "starUpdate", id: s.id, month: editStar[s.id].month, category: editStar[s.id].category, subject: editStar[s.id].subject, reason: editStar[s.id].reason }, "改星光").then(() => (editStar[s.id] = null))}>保存</Button>
              </div>
            {:else}
              <div class="flex items-center gap-2 text-xs">
                <Badge variant="outline" class="shrink-0 text-[10px]">{s.category}</Badge>
                <span class="font-medium">{s.subject}</span>
                <span class="min-w-0 flex-1 truncate text-muted-foreground">{s.reason}</span>
                <span class="shrink-0 text-muted-foreground">{s.month}</span>
                <Button size="sm" variant="ghost" disabled={busy} onclick={() => (editStar[s.id] = { month: s.month, category: s.category, subject: s.subject, reason: s.reason })}><Pencil class="size-3.5" /></Button>
                <Button size="sm" variant="ghost" disabled={busy} onclick={() => del("star", s.id, "删星光")}><Trash2 class="size-3.5 text-destructive" /></Button>
              </div>
            {/if}
          {/each}
        </div>
      </section>

      <section class="rounded-xl border border-border/60 bg-card p-5">
        <h2 class="mb-3 font-heading text-lg font-semibold">大事记</h2>
        <div class="mb-3 flex flex-col gap-2">
          <Input class="text-xs" bind:value={nEvent.at} placeholder="日期 2026-10-01" />
          <Input class="text-xs" bind:value={nEvent.title} placeholder="标题（含「运动会」自动进时间轴）" />
          <Input class="text-xs" bind:value={nEvent.body} placeholder="项目·名次（每行一个，如：女子4×100接力：第三名）" />
          <textarea class="h-16 w-full rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs" bind:value={nEvent.photosText} placeholder={"照片（每行：图片URL|说明）\n如：/campus/2028/class8/sports/mmexport1.jpg|女子4×100接力 · 合影"}></textarea>
          <Button size="sm" variant="outline" disabled={busy || !nEvent.title} onclick={() => post({ op: "event", at: nEvent.at, title: nEvent.title, body: nEvent.body, photos: parsePhotos(nEvent.photosText) }, "新建事件").then(() => (nEvent = { at: "", title: "", body: "", photosText: "" }))}><Plus class="mr-1 size-3.5" />新建事件</Button>
        </div>
        <div class="flex flex-col gap-1.5">
          {#each snap.events as e (e.id)}
            {#if editEvent[e.id]}
              <div class="flex flex-col gap-1.5 border border-border/40 rounded-md p-1.5 text-xs">
                <Input class="text-xs" bind:value={editEvent[e.id].at} placeholder="日期" />
                <Input class="text-xs" bind:value={editEvent[e.id].title} placeholder="标题" />
                <textarea class="h-10 rounded-md border border-border/60 bg-background px-2 py-1 text-xs" bind:value={editEvent[e.id].body} placeholder="内容"></textarea>
                <Button size="sm" variant="outline" disabled={busy} onclick={() => post({ op: "eventUpdate", id: e.id, at: editEvent[e.id].at, title: editEvent[e.id].title, body: editEvent[e.id].body }, "改事件").then(() => (editEvent[e.id] = null))}>保存</Button>
              </div>
            {:else}
              <div class="flex items-center gap-2 text-xs">
                <span class="shrink-0 font-mono text-muted-foreground">{e.at}</span>
                <span class="font-medium">{e.title}</span>
                <span class="min-w-0 flex-1 truncate text-muted-foreground">{e.body}</span>
                <span class="shrink-0 text-[10px] text-muted-foreground">{(e.photos?.length || 0)}图</span>
                <Button size="sm" variant="ghost" disabled={busy} onclick={() => (editEvent[e.id] = { at: e.at, title: e.title, body: e.body })}><Pencil class="size-3.5" /></Button>
                <Button size="sm" variant="ghost" disabled={busy} onclick={() => del("event", e.id, "删事件")}><Trash2 class="size-3.5 text-destructive" /></Button>
              </div>
            {/if}
          {/each}
        </div>
      </section>
    </div>

    <!-- ══ 数据导出 / 导入（全换） ══ -->
    <section class="rounded-xl border border-border/60 bg-card p-5">
      <h2 class="mb-3 font-heading text-lg font-semibold">数据备份 · 全量更换</h2>
      <div class="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy} onclick={doExport}><Download class="mr-1 size-3.5" />导出全部数据（JSON）</Button>
      </div>
      <div class="mt-3 border-t border-border/40 pt-3">
        <p class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Excel 表格（老师使用，Excel/WPS 打开）</p>
        <div class="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy || !snap} onclick={membersXls}><FileSpreadsheet class="mr-1 size-3.5" />成员名单</Button>
          <Button size="sm" variant="outline" disabled={busy || !snap} onclick={ranksXls}><FileSpreadsheet class="mr-1 size-3.5" />排名表</Button>
          <Button size="sm" variant="outline" disabled={busy || !snap} onclick={eventsXls}><FileSpreadsheet class="mr-1 size-3.5" />运动会大事记</Button>
          <Button size="sm" variant="outline" disabled={busy || !snap} onclick={starsXls}><FileSpreadsheet class="mr-1 size-3.5" />星光榜</Button>
          <Button size="sm" variant="outline" disabled={busy || !snap} onclick={allXls}><FileSpreadsheet class="mr-1 size-3.5" />全部数据全表</Button>
        </div>
      </div>
      <div class="mt-3 border-t border-border/40 pt-3">
        <p class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">表格导入（Excel .xls / CSV，先生成模板再回填）</p>
        <div class="flex flex-wrap items-center gap-2">
          <select class="rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs" bind:value={impKind}>
            {#each Object.entries(IMP_KINDS) as [k, v] (k)}
              <option value={k}>{v.label}</option>
            {/each}
          </select>
          {#if impKind === "scores"}
            <select class="rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs" bind:value={impExam}>
              <option value={null}>选择考试</option>
              {#each snap.exams as e (e.id)}
                <option value={e.id}>{e.title}</option>
              {/each}
            </select>
            <select class="rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs" bind:value={impSubject}>
              {#each SUBJECTS as s}<option value={s}>{s}</option>{/each}
            </select>
          {/if}
          <input type="file" accept=".xls,.csv,text/csv" class="text-xs" bind:value={impFile} onchange={parseImportFile} />
          <Button size="sm" variant="outline" disabled={busy || !impRows?.length} onclick={doTableImport}><Table2 class="mr-1 size-3.5" />导入 {impRows?.length ?? 0} 行</Button>
        </div>
        {#if impRows?.length}
          <div class="mt-2 rounded-md border border-border/40 bg-muted/30 p-2">
            <p class="mb-1 text-[11px] text-muted-foreground">已解析 {impRows.length} 行：<b class="text-emerald-600">{impPreview?.filter((x) => x.st === "新增").length ?? 0} 新增</b> · <b class="text-amber-600">{impPreview?.filter((x) => x.st !== "新增").length ?? 0} 跳过</b></p>
            <div class="max-h-32 overflow-y-auto">
              {#each impPreview ?? [] as pr, pi (pi)}
                <p class="text-[11px]"><span class={pr.st === "新增" ? "text-emerald-600" : "text-amber-600"}>{pr.st}</span>：{pr.cells.join(" / ").slice(0, 80)}</p>
              {/each}
            </div>
          </div>
        {/if}
      </div>
      {#if showExport}
        <textarea class="mt-2 h-28 w-full rounded-md border border-border/60 bg-background px-2 py-1.5 font-mono text-[11px]" bind:value={exportData}></textarea>
        <p class="mt-1 text-[11px] text-muted-foreground">复制上方 JSON 保存，可在新班级全量导入。</p>
      {/if}
      <div class="mt-3 flex flex-col gap-2">
        <textarea class="h-28 w-full rounded-md border border-border/60 bg-background px-2 py-1.5 font-mono text-[11px]" bind:value={importText} placeholder="粘贴导出的 JSON 后点「全量导入」覆盖当前数据"></textarea>
        <div class="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy || !importText} onclick={doImport}><Upload class="mr-1 size-3.5" />全量导入（覆盖）</Button>
          <span class="text-[11px] text-muted-foreground">⚠ 覆盖前建议先导出备份；操作记入变更记录。</span>
        </div>
      </div>
    </section>

    <!-- ══ 变更记录 ══ -->
    <section class="rounded-xl border border-border/60 bg-card p-5">
      <h2 class="mb-3 flex items-center gap-2 font-heading text-lg font-semibold"><History class="size-4" />变更记录（最近 30 条，每次保存自动留痕）</h2>
      <div class="flex flex-col gap-1">
        {#each snap.changelog as c (c.id)}
          <div class="flex items-start gap-2 border-b border-border/40 py-1.5 text-xs last:border-0">
            <span class="shrink-0 font-mono text-muted-foreground">{c.at}</span>
            <Badge variant="outline" class="shrink-0 text-[10px]">{c.op}</Badge>
            <span class="shrink-0 font-medium">{c.actor}</span>
            <span class="min-w-0 flex-1 truncate text-muted-foreground">{c.detail}</span>
          </div>
        {/each}
      </div>
    </section>
    {:else}
      <!-- ══ 快捷文档表格 ══ -->
      <section class="rounded-xl border border-border/60 bg-card p-5">
        <h2 class="mb-3 font-heading text-lg font-semibold">快捷文档表格</h2>
        <h3 class="mb-2 text-sm font-semibold text-muted-foreground">成员名单（{snap.groups.reduce((a: number, x: any) => a + (x.members?.length || 0), 0)} 人）</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead><tr class="border-b border-border/60 text-left text-muted-foreground"><th class="py-1.5 pr-2">小组</th><th class="py-1.5 pr-2">姓名</th><th class="py-1.5 pr-2">角色</th><th class="py-1.5">座右铭</th></tr></thead>
            <tbody>
              {#each snap.groups as g (g.id)}
                {#each g.members as m (m.id)}
                  <tr class="border-b border-border/40">
                    <td class="py-1 pr-2">{g.emoji}{g.name}</td>
                    <td class="py-1 pr-2 font-medium">{m.name}</td>
                    <td class="py-1 pr-2 text-muted-foreground">{m.role}</td>
                    <td class="py-1 text-muted-foreground">{m.motto}</td>
                  </tr>
                {/each}
              {/each}
            </tbody>
          </table>
        </div>
        <h3 class="mb-2 mt-4 text-sm font-semibold text-muted-foreground">官方排名</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead><tr class="border-b border-border/60 text-left text-muted-foreground"><th class="py-1.5 pr-2">#</th><th class="py-1.5 pr-2">小组</th><th class="py-1.5 pr-2">均分</th><th class="py-1.5">荣誉</th></tr></thead>
            <tbody>
              {#each snap.ranks as r, i (r.id)}
                <tr class="border-b border-border/40"><td class="py-1 pr-2">{i + 1}</td><td class="py-1 pr-2 font-medium">{r.group_name}</td><td class="py-1 pr-2">{r.avg.toFixed(2)}</td><td class="py-1 text-muted-foreground">{r.honor}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
        <h3 class="mb-2 mt-4 text-sm font-semibold text-muted-foreground">运动会 / 大事记</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead><tr class="border-b border-border/60 text-left text-muted-foreground"><th class="py-1.5 pr-2">时间</th><th class="py-1.5 pr-2">标题</th><th class="py-1.5 pr-2">内容</th><th class="py-1.5">照片</th></tr></thead>
            <tbody>
              {#each snap.events as e (e.id)}
                <tr class="border-b border-border/40"><td class="py-1 pr-2 font-mono">{e.at}</td><td class="py-1 pr-2 font-medium">{e.title}</td><td class="py-1 pr-2 text-muted-foreground">{e.body}</td><td class="py-1">{e.photos?.length || 0} 张</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="mt-4 flex items-center gap-2">
          <Button size="sm" variant="outline" onclick={() => (view = "edit")}><Pencil class="mr-1 size-3.5" />回到编辑视图</Button>
        </div>
      </section>
    {/if}
  {/if}
</div>

<!-- ══ AI 侧边助手 ══ -->
{#if aiOpen && snap}
  <div class="ai-mask" onclick={() => (aiOpen = false)}></div>
  <aside class="ai-panel">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="flex items-center gap-2 font-heading text-lg font-semibold"><Sparkles class="size-4 text-primary" />AI 助手</h2>
      <Button size="sm" variant="ghost" onclick={() => (aiOpen = false)}>×</Button>
    </div>
    <div class="ai-section">
      <h3 class="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">班级 AI 总结</h3>
      <p class="text-sm leading-relaxed text-foreground">{aiSummary()}</p>
    </div>
    <div class="ai-section mt-4">
      <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">AI 快速编辑</h3>
      <div class="flex flex-col gap-2">
        <Button size="sm" variant="outline" disabled={aiBusy} onclick={() => aiGen("intro")}>生成班级简介（填入档案）</Button>
        <Button size="sm" variant="outline" disabled={aiBusy} onclick={() => aiGen("sports")}>生成运动会文案（填入新建）</Button>
        <Button size="sm" variant="outline" disabled={aiBusy} onclick={() => aiGen("analysis")}>成绩分析建议</Button>
        <Button size="sm" variant="outline" disabled={aiBusy} onclick={() => aiGen("points")}>生成点名表</Button>
      </div>
      {#if aiOut}
        <div class="mt-3 rounded-md border border-border/40 bg-muted/30 p-2">
          <p class="whitespace-pre-wrap text-xs leading-relaxed">{aiOut}</p>
          <Button size="sm" variant="ghost" class="mt-2" onclick={async () => { try { await navigator.clipboard.writeText(aiOut); } catch {} }}><Copy class="mr-1 size-3.5" />复制</Button>
        </div>
      {/if}
    </div>
    <p class="mt-4 text-[10px] text-muted-foreground">AI 助手基于班级数据实时生成，保存由你确认后提交。</p>
  </aside>
{/if}

<style>
  .ai-mask { position: fixed; inset: 0; z-index: 70; background: rgba(0,0,0,.35); }
  .ai-panel { position: fixed; top: 0; right: 0; bottom: 0; z-index: 71; width: min(340px, 92vw); background: var(--background); border-left: 1px solid var(--border); padding: 1.2rem; overflow-y: auto; box-shadow: -12px 0 40px -20px rgba(0,0,0,.5); animation: ai-in .3s var(--ease-expo); }
  .ai-section { border-top: 1px solid var(--border); }
  @keyframes ai-in { from { opacity: 0; transform: translateX(30px); } to { opacity: 1; transform: none; } }
</style>
