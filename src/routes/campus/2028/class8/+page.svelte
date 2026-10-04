<script lang="ts">
  import { reveal } from "$lib/actions/reveal.js";
  import { page } from "$app/state";

  type D = {
    profile: { class_name: string; slogan: string; concept: string; intro: string; teacher: string; quote: string; subtitle: string };
    groups: { id: number; name: string; emoji: string; goal: string; posterSrc?: string; members: { name: string; role: string; motto: string }[] }[];
    leaders: { id: number; subject: string; name: string; icon: string }[];
    ranks: { id: number; group_name: string; avg: number; honor: string }[];
    exams: { id: number; title: string; exam_date: string }[];
    ranking: { name: string; avg: number | null }[];
    curves: { exams: string[]; groups: { id: number; name: string; points: (number | null)[] }[] };
    stars: { id: number; month: string; category: string; subject: string; reason: string }[];
    events: { id: number; at: string; title: string; body: string; photos?: { src: string; caption: string }[] }[];
    spots: { id: number; key: string; title: string; slogan: string; body: string }[];
  };
  const d = $derived(page.data as D);
  const totalMembers = $derived((d?.groups ?? []).reduce((a, g) => a + (g.members?.length ?? 0), 0));
  const topRank = $derived((d?.ranks ?? [])[0]);
  const MAX = $derived((d?.ranks ?? [])[0]?.avg ?? 400);
  const pct = (v: number) => Math.max(4, Math.round((v / MAX) * 1000) / 10);
  const medals = ["🥇", "🥈", "🥉", "4", "5", "6", "7", "8"];
  const medalOf = (i: number) => medals[i] ?? String(i + 1);
  const clsOf = (i: number) => (i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "");
  let openGroup = $state<number | null>(null);
  let subject = $state("全部");
  const SUBJECTS = ["全部", "语文", "数学", "英语", "物理", "化学", "生物", "政治", "历史", "地理"];
  const W = 720, H = 260, PAD = 34;
  const LC = ["#c8542e", "#10b981", "#f59e0b", "#cc785c", "#ef4444", "#14b8a6", "#f43f5e", "#6366f1"];
  function rangeOf() {
    const a: number[] = [];
    for (const g of d?.curves?.groups ?? []) for (const v of g.points) if (v !== null) a.push(v);
    return a.length ? { max: Math.max.apply(null, a), min: Math.min.apply(null, a) } : { max: 100, min: 60 };
  }
  function linePoints(pts: (number | null)[]) {
    const r = rangeOf();
    return pts.map((v: number | null, i: number) => {
      if (v === null) return null;
      const x = PAD + (i / Math.max(1, pts.length - 1)) * (W - PAD * 2);
      const y = H - PAD - ((v - r.min) / Math.max(1, r.max - r.min)) * (H - PAD * 2);
      return x + "," + y;
    }).filter(Boolean).join(" ");
  }
  const xAxis = (i: number, n: number) => PAD + (i / Math.max(1, n - 1)) * (W - PAD * 2);
  const NAV_ITEMS: [string, string][] = [["#sec-hero", "概况"], ["#sec-rules", "公约"], ["#sec-leaders", "领航人"], ["#sec-groups", "小组"], ["#sec-rank", "排行"], ["#sec-acad", "学业"], ["#sec-growth", "成长"], ["#sec-sports", "运动会"], ["#sec-culture", "文化"], ["#sec-quote", "寄语"]];
  const rules: string[] = ["入室即静，入座即学", "按时到班，不迟到不早退", "作业独立完成，不抄不拖", "值日尽责，工具归位", "课堂积极思考，勇于发言", "同学互助，不嘲笑不孤立", "手机不进教室，专注学习", "爱护公物，节约水电"];
  const timetable: [string, string][] = [["7:30", "早读"], ["8:00-8:45", "第一节"], ["9:00-9:45", "第二节"], ["10:00-10:45", "第三节"], ["11:00-11:45", "第四节"], ["14:00-14:45", "第五节"], ["15:00-15:45", "第六节"], ["16:00-16:45", "第七节"]];
  const CULT_ICONS: Record<string, string> = { entry: "🚪", south_wall: "🧲", north_wall: "📢", back_wall: "📊", water: "💧", ac: "❄️", hygiene: "🧹" };
  const STAR_COLORS: Record<string, string> = { "学业进步": "#c8542e", "作业优秀": "#10b981", "值日尽责": "#f59e0b", "互助奉献": "#cc785c", "课堂活跃": "#f43f5e" };
  const cultIcon = (k: string) => CULT_ICONS[k] || "📍";
  const starColor = (c: string) => STAR_COLORS[c] || "#64748b";

  // 运动会全屏幻灯片（照片扁平化 + 说明）
  type SlidePhoto = { src: string; caption: string; sportTitle: string; sportAt: string; proj: string; rank: string };
  let slide = $state<{ photos: SlidePhoto[]; i: number } | null>(null);
  let slideDir = $state(1);
  function openSlide(e: any, idx: number) {
    const bodyLines = String(e.body || "").split("\n");
    const photos: SlidePhoto[] = (e.photos ?? []).map((ph: any) => {
      const proj = String(ph.caption || "").split("·")[0].trim();
      const line = bodyLines.find((l: string) => l.includes(proj));
      const rank = line ? (line.split("：")[1] || line).trim() : "";
      return { src: ph.src, caption: ph.caption, sportTitle: e.title, sportAt: e.at, proj, rank };
    });
    slide = { photos, i: idx }; slideDir = 1;
  }
  function closeSlide() { slide = null; }
  function stepSlide(d: number) { if (slide) { slideDir = d; slide = { ...slide, i: (slide.i + d + slide.photos.length) % slide.photos.length }; } }
  const nextSlide = () => stepSlide(1);
  const prevSlide = () => stepSlide(-1);
  // 键盘：← → 切换，Esc 关闭（$effect 只在客户端、slide 打开时挂监听）
  $effect(() => {
    if (!slide) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") { e.preventDefault(); nextSlide(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prevSlide(); }
      else if (e.key === "Escape") { closeSlide(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  // 触摸滑动
  let _tx = 0;
  const onTouchStart = (e: TouchEvent) => { _tx = (e.touches[0] as any)?.clientX ?? 0; };
  const onTouchEnd = (e: TouchEvent) => {
    const ex = (e.changedTouches[0] as any)?.clientX ?? _tx;
    const dx = ex - _tx;
    if (Math.abs(dx) > 50) stepSlide(dx > 0 ? -1 : 1);
  };
  // 名次徽章奖牌配色
  const rankCls = (r: string) => {
    if (r.includes("第一")) return "medal-gold";
    if (r.includes("第二")) return "medal-silver";
    if (r.includes("第三")) return "medal-bronze";
    return "";
  };
  const sportEvents = $derived((d?.events ?? []).filter((e) => e.title && e.title.includes("运动会")));
  // 运动会时间轴元数据：届别 / 项目明细（奖次） / 照片分类
  const medalOfRank = (r: string) => {
    if (!r) return "";
    if (r.includes("第一")) return "🥇";
    if (r.includes("第二")) return "🥈";
    if (r.includes("第三")) return "🥉";
    return "";
  };
  const formatAt = (at: string) => {
    const m = String(at || "").match(/(\d{4})-(\d{2})/);
    return m ? m[1] + "年" + Number(m[2]) + "月" : at;
  };
  const photoCat = (cap: string) => {
    if (cap.includes("奖状")) return "荣誉";
    if (cap.includes("合影")) return "合影";
    return "赛场";
  };
  const sportMeta = $derived(
    [...sportEvents]
      .sort((a: any, b: any) => (String(a.at) < String(b.at) ? -1 : 1))
      .map((e) => {
        const parts = String(e.title || "").split("·");
        const meetName = parts[0]?.trim() || e.title;
        const grade = parts[1]?.trim() || "";
        const items = String(e.body || "").split("\n").filter(Boolean).map((line: string) => {
          const [proj, rank] = line.split("：");
          const rankT = (rank || "").trim();
          return { proj: (proj || line).trim(), rank: rankT, medal: medalOfRank(rankT) };
        });
        const photos = (e.photos ?? []).map((ph: any) => Object.assign({}, ph, { cat: photoCat(String(ph.caption || "")) }));
        return Object.assign({}, e, { meetName, grade, items, photos });
      })
  );
</script>
<nav class="sec-nav">
  {#each NAV_ITEMS as item (item[0])}
    <a class="nav-pill" href={item[0]}>{item[1]}</a>
  {/each}
</nav>

<section id="sec-hero" class="hero">
  <div class="hero-left">
    <div use:reveal class="reveal eyebrow" style="--reveal-delay:0">{d?.profile?.concept ?? "2028届 · 高二 · 班级文化建设"}</div>
    <h1 use:reveal class="reveal reveal-mask hero-title" style="--reveal-delay:1">{d?.profile?.class_name ?? "2028届8班"}</h1>
    <p use:reveal class="reveal hero-slogan" style="--reveal-delay:2">{d?.profile?.slogan ?? "携手共进，顶峰相见"}</p>
    <p use:reveal class="reveal hero-intro" style="--reveal-delay:3">{d?.profile?.intro ?? ""}</p>
  </div>
  <div class="hero-right">
    <div use:reveal class="reveal hero-stats" style="--reveal-delay:3">
      <div class="stat"><b>{(d?.groups ?? []).length}</b><span>学习小组</span></div>
      <div class="stat"><b>{totalMembers}</b><span>同学</span></div>
      <div class="stat"><b>{d?.exams?.length ?? 0}</b><span>次考试</span></div>
      <div class="stat"><b>{topRank ? topRank.group_name : "—"}</b><span>当前领跑</span></div>
    </div>
    <span use:reveal class="reveal ef-draw hero-draw" style="--reveal-delay:4"></span>
  </div>
</section>

<section id="sec-rules" class="sec">
  <div use:reveal class="reveal sec-head">
    <span class="sec-no">01 · 班级公约</span>
    <h2 class="h-serif">以约束为前提的自由</h2>
  </div>
  <div class="rules-grid">
    {#each rules as r, i (r)}
      <div use:reveal class="reveal-wipe rule-card" style="--reveal-delay:{1 + (i % 4)}"><span class="rule-no">{i + 1}</span><span>{r}</span></div>
    {/each}
  </div>
  <h3 class="h-sub">每日作息</h3>
  <div class="timetable">
    {#each timetable as row (row[0])}
      <div class="tt-row"><span class="tt-time">{row[0]}</span><span>{row[1]}</span></div>
    {/each}
  </div>
</section>

<section id="sec-leaders" class="sec">
  <div use:reveal class="reveal sec-head">
    <span class="sec-no">02 · 学科领航人</span>
    <h2 class="h-serif">七位组长，各领一方</h2>
  </div>
  <div class="leaders">
    {#each d?.leaders ?? [] as l, i (l.id)}
      <div use:reveal class="reveal-wipe leader" style="--reveal-delay:{i + 1}">
        <span class="l-ico">{l.icon}</span><span class="l-subj">{l.subject}组长</span><span class="l-name">{l.name}</span>
      </div>
    {/each}
  </div>
</section>

<section id="sec-groups" class="sec">
  <div use:reveal class="reveal sec-head">
    <span class="sec-no">03 · 小组风采</span>
    <h2 class="h-serif">八个小组 · {totalMembers} 人集结</h2>
  </div>
  <div class="group-cards">
    {#each d?.groups ?? [] as g, gi (g.id)}
      <div use:reveal class="reveal-wipe group-card" style="--reveal-delay:{gi + 1}">
        <!-- 手抄报展区：左图右文 -->
        <div class="g-poster">
          {#if g.posterSrc}
            <img src={g.posterSrc} alt={g.name + "手抄报"} loading="lazy" onload={(ev) => ((ev.currentTarget as HTMLElement).style.opacity = "1")} />
          {:else}
            <div class="g-poster-empty"><span>📰</span><b>手抄报待上传</b><i>在后台「小组」填写后展示</i></div>
          {/if}
        </div>
        <div class="g-info">
          <div class="g-headline">
            <span class="g-emoji">{g.emoji}</span>
            <span class="g-name">{g.name}</span>
            <span class="g-cnt">{g.members?.length || 0} 人</span>
          </div>
          <p class="g-goal">🎯 {g.goal || "目标待补充"}</p>
          {#if (g.members ?? []).some((m) => m.role === "组长")}
            <p class="g-leader">组长：{#each g.members ?? [] as m (m.name)}{#if m.role === "组长"}<b class="leader-badge">{m.name}</b>{/if}{/each}</p>
          {:else}
            <p class="g-leader">组长：<i class="g-leader-none">待任命</i></p>
          {/if}
          <div class="chips">
            {#each g.members ?? [] as m (m.name)}
              <span class="chip" class:leader={m.role === "组长"} title={m.role === "组长" ? "组长" : m.role}>{m.name}</span>
            {/each}
          </div>
        </div>
      </div>
    {/each}
  </div>
</section>

<section id="sec-rank" class="sec">
  <div use:reveal class="reveal sec-head">
    <span class="sec-no">04 · 荣耀时刻</span>
    <h2 class="h-serif">期末平均分排行</h2>
  </div>
  <div class="rank">
    {#each d?.ranks ?? [] as r, i (r.id)}
      <div use:reveal class="reveal rank-row {clsOf(i)}" style="--reveal-delay:{i + 1}">
        <span class="r-medal">{medalOf(i)}</span><span class="r-name">{r.group_name}</span>
        <div class="r-bar"><i class="fill" style="--w:{pct(r.avg)}%"></i></div>
        <span class="r-avg">{r.avg.toFixed(2)}</span><span class="r-honor">{r.honor}</span>
      </div>
    {/each}
  </div>
</section>

<section id="sec-acad" class="sec">
  <div use:reveal class="reveal sec-head">
    <span class="sec-no">05 · 学业追踪</span>
    <h2 class="h-serif">小组均分趋势</h2>
    <p class="sec-sub">小组维度 · 不公开个人排名。切换学科查看各组成长曲线。</p>
  </div>
  <div use:reveal class="reveal panel" style="--reveal-delay:1">
    <div class="panel-head">
      <select bind:value={subject}>
        {#each SUBJECTS as s}<option value={s}>{s}</option>{/each}
      </select>
      <div class="legend">
        {#each d?.curves?.groups ?? [] as g, i (g.id)}
          <span class="lg"><i style="background:{LC[i % LC.length]}"></i>{g.name}</span>
        {/each}
      </div>
    </div>
  <div class="chart-wrap">
    {#if (d?.curves?.exams ?? []).length > 0}
      <svg class="chart" viewBox="0 0 720 260" preserveAspectRatio="none">
        {#each d?.curves?.groups ?? [] as g, i (g.id)}
          <polyline points={linePoints(g.points)} fill="none" stroke={LC[i % LC.length]} stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
        {/each}
        {#each d?.curves?.exams ?? [] as e, i (e)}
          <text x={xAxis(i, (d?.curves?.exams ?? []).length)} y={H - 8} text-anchor="middle" class="axis" transform={i === (d?.curves?.exams ?? []).length - 1 ? "translate(-8 0)" : ""}>{e}</text>
        {/each}
      </svg>
    {:else}
      <div class="chart-empty">
        <span>📊</span>
        <b>本学期暂无考试成绩录入</b>
        <i>班主任在后台「成绩批量录入」添加考试与分数后，这里自动生成趋势曲线。</i>
      </div>
    {/if}
  </div>
  </div>
</section>

<section id="sec-growth" class="sec">
  <div use:reveal class="reveal sec-head">
    <span class="sec-no">06 · 成长看板</span>
    <h2 class="h-serif">星光榜 · 大事记</h2>
  </div>
  <div class="growth-grid">
    <div use:reveal class="reveal panel" style="--reveal-delay:1">
      <h3 class="h-sub">月度星光榜</h3>
      <div class="star-grid">
        {#each d?.stars ?? [] as s (s.id)}
          <div class="star-card">
            <span class="star-badge" style="background:{starColor(s.category)}">{s.category}</span>
            <b>{s.subject}</b><span class="star-reason">{s.reason}</span><span class="star-month">{s.month}</span>
          </div>
        {/each}
      </div>
    </div>
    <div use:reveal class="reveal panel" style="--reveal-delay:2">
      <h3 class="h-sub">班级大事记</h3>
      <div class="timeline">
        {#each d?.events ?? [] as e (e.id)}
          {#if !(e.title && e.title.includes("运动会"))}
          <div class="tl-item"><span class="tl-dot"></span><div class="tl-body"><b>{e.title}</b><span class="tl-at">{e.at}</span><p>{e.body}</p></div></div>
          {/if}
        {/each}
      </div>
    </div>
  </div>
</section>

<section id="sec-sports" class="sec">
  <div use:reveal class="reveal sec-head">
    <span class="sec-no">07 · 运动会</span>
    <h2 class="h-serif">赛场风云 · 班级高光时刻</h2>
    <p class="sec-sub">点击照片查看大图，左右切换。</p>
  </div>
  <div class="sports-timeline">
    {#each sportMeta as e, ei (e.id)}
      <div class="tl-node" use:reveal style="--reveal-delay:{ei + 1}">
        <div class="tl-marker">
          <span class="tl-dot2"></span>
          <span class="tl-time">{formatAt(e.at)}</span>
        </div>
        <div class="tl-card sport-card">
          <div class="sport-head">
            <span class="sport-badge">{e.grade || "运动会"}</span>
            <h3>{e.meetName}</h3>
            <span class="sport-at">{e.at}</span>
          </div>
          <div class="sport-body">
            <div class="sport-items">
              {#each e.items as it (it.proj)}
                <div class="sport-item">
                  <span class="sport-item-ico">{it.medal || "🏃"}</span>
                  <span class="sport-item-name">{it.proj}</span>
                  <span class="sport-item-rank {it.medal ? "has-medal" : ""}">{it.rank || "参赛"}</span>
                </div>
              {/each}
            </div>
            <div class="sport-photos">
              {#each e.photos as ph, i (ph.src)}
                <button class="sport-thumb" onclick={() => openSlide(e, i)} aria-label={ph.caption}>
                  <img src={ph.src} alt={ph.caption} loading="lazy" onload={(ev) => ((ev.currentTarget as HTMLElement).style.opacity = "1")} />
                  <span class="thumb-cap">{ph.caption}</span>
                  <span class="thumb-cat cat-{ph.cat}">{ph.cat}</span>
                </button>
              {/each}
            </div>
          </div>
        </div>
      </div>
    {/each}
  </div>
</section>

<section id="sec-culture" class="sec">
  <div use:reveal class="reveal sec-head">
    <span class="sec-no">07 · 文化点位</span>
    <h2 class="h-serif">教室里处处有育人细节</h2>
  </div>
  <div class="spot-grid">
    {#each d?.spots ?? [] as s (s.id)}
      <div use:reveal class="reveal-wipe spot-card" style="--reveal-delay:2">
        <span class="spot-icon">{cultIcon(s.key)}</span>
        <h3>{s.title}</h3><b class="spot-slogan">「{s.slogan}」</b><p>{s.body}</p>
      </div>
    {/each}
  </div>
</section>

<section id="sec-quote" class="sec">
  <div use:reveal class="reveal sec-head">
    <span class="sec-no">08 · 班级寄语</span>
    <h2 class="h-serif">目标墙 · 留白互动区</h2>
  </div>
  <blockquote use:reveal class="reveal-clamp quote">
    <p>{d?.profile?.quote ?? "一朵花独绽不是春天，百花齐放才是春色满园。高二八班，不比基础比进步，不比聪明比勤奋！"}</p>
  </blockquote>
  <div class="facts">
    <div use:reveal class="reveal fact"><b>{totalMembers} 人</b><span>班级总人数</span></div>
    <div use:reveal class="reveal fact"><b>{(d?.groups ?? []).length} 组</b><span>学习小组</span></div>
    <div use:reveal class="reveal fact"><b>{topRank ? topRank.group_name + " · " + topRank.avg.toFixed(2) : "—"}</b><span>最高分小组</span></div>
    <div use:reveal class="reveal fact"><b>{d?.leaders?.length ?? 0}</b><span>学科领航人</span></div>
  </div>
</section>
<style>
  .sec-nav { position: sticky; top: 0; z-index: 30; display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 0; background: rgba(250,246,238,.92); backdrop-filter: blur(8px); border-bottom: 1px solid rgba(42,38,32,.1); }
  .nav-pill { padding: 5px 13px; border-radius: 999px; font-size: .8rem; color: #4a443c; text-decoration: none; transition: background .3s, color .3s; }
  .nav-pill:hover { background: #f3ecdd; }
  .eyebrow { display: inline-flex; align-items: center; gap: .6rem; font-size: .72rem; letter-spacing: .22em; text-transform: uppercase; color: #8a8178; font-weight: 500; margin-bottom: .8rem; }
  .eyebrow::before { content: ""; width: 1.6rem; height: 1px; background: #c8542e; }
  .hero { display: grid; grid-template-columns: 1.25fr 1fr; gap: 2rem; align-items: center; padding: 1.6rem 0 1.2rem; }
  .hero-title { font-family: var(--font-heading); font-weight: 800; font-size: clamp(2.6rem, 7vw, 4.6rem); letter-spacing: -.02em; line-height: 1.02; margin: 0; }
  .hero-slogan { margin-top: 1rem; font-family: var(--font-heading); font-weight: 600; font-size: clamp(1.1rem, 2.6vw, 1.5rem); color: #c8542e; letter-spacing: .06em; }
  .hero-intro { margin-top: .8rem; max-width: 56ch; color: #4a443c; line-height: 1.8; font-size: .95rem; }
  .hero-stats { display: grid; grid-template-columns: 1fr 1fr; gap: .8rem; }
  .stat { padding: .8rem 1rem; background: #fffdf7; border: 1px solid rgba(42,38,32,.1); border-radius: .7rem; } .stat b { display: block; font-family: var(--font-heading); font-size: 1.45rem; font-weight: 700; }
  .stat span { font-size: .78rem; color: #8a8178; }
  .hero-draw { width: 100%; margin-top: 1rem; }
  .sec { padding: 1.8rem 0 .3rem; border-top: 1px solid rgba(42,38,32,.1); scroll-margin-top: 52px; }
  .sec-head { display: flex; flex-direction: column; gap: .25rem; margin-bottom: .9rem; }
  .sec-no { font-size: .75rem; font-weight: 700; letter-spacing: .18em; color: #c8542e; }
  .h-serif { font-family: var(--font-heading); font-size: clamp(1.5rem, 3.6vw, 2.1rem); font-weight: 700; letter-spacing: -.01em; margin: 0; }
  .sec-sub { color: #8a8178; font-size: .9rem; }
  .h-sub { font-family: var(--font-heading); font-weight: 700; font-size: 1.1rem; margin: 1rem 0 .5rem; }
  .rules-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
  .rule-card { display: flex; align-items: center; gap: 10px; padding: .8rem 1rem; background: #fffdf7; border: 1px solid rgba(42,38,32,.1); border-radius: .8rem; font-size: .9rem; }
  .rule-no { width: 24px; height: 24px; border-radius: 8px; background: #c8542e; color: #fff; display: grid; place-items: center; font-size: .75rem; font-weight: 700; flex: none; }
  .timetable { background: #fffdf7; border: 1px solid rgba(42,38,32,.1); border-radius: .9rem; overflow: hidden; max-width: 560px; }
  .tt-row { display: flex; gap: 14px; padding: .55rem 1rem; border-bottom: 1px solid rgba(42,38,32,.06); font-size: .88rem; }
  .tt-row:last-child { border-bottom: none; }
  .tt-time { width: 6.5rem; color: #8a8178; font-variant-numeric: tabular-nums; }
  .leaders { display: grid; grid-template-columns: repeat(auto-fill, minmax(126px, 1fr)); gap: .8rem; }
  .leader { display: flex; flex-direction: column; align-items: center; gap: .2rem; padding: 1rem .6rem; background: #fffdf7; border: 1px solid rgba(42,38,32,.1); border-radius: .9rem; text-align: center; transition: transform .5s var(--ease-expo), border-color .5s var(--ease-expo), box-shadow .5s var(--ease-expo); }
  .leader:hover { transform: translateY(-3px); border-color: #c8542e; box-shadow: 0 16px 32px -22px rgba(42,38,32,.35); }
  .l-ico { font-size: 1.35rem; }
  .l-subj { font-size: .68rem; letter-spacing: .12em; color: #8a8178; }
  .l-name { font-family: var(--font-heading); font-weight: 700; font-size: .98rem; }
  .groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(235px, 1fr)); gap: 1rem; }
  .group { background: #fffdf7; border: 1px solid rgba(42,38,32,.1); border-radius: 1rem; overflow: hidden; transition: transform .5s var(--ease-expo), border-color .5s var(--ease-expo), box-shadow .5s var(--ease-expo); }
  .group:hover { transform: translateY(-4px); border-color: #b8891a; box-shadow: 0 20px 40px -26px rgba(42,38,32,.4); }
  .g-head { width: 100%; display: flex; align-items: center; gap: .6rem; padding: .9rem 1rem; background: linear-gradient(120deg, #f3ecdd, #fffdf7); border: none; cursor: pointer; font: inherit; text-align: left; }
  .g-emoji { font-size: 1.25rem; }
  .g-name { font-family: var(--font-heading); font-weight: 700; font-size: 1.06rem; flex: 1; }
  .g-cnt { font-size: .72rem; color: #8a8178; border: 1px solid rgba(42,38,32,.14); padding: .12rem .5rem; border-radius: 999px; flex: none; }
  .g-toggle { color: #c8542e; font-weight: 700; }
  .g-body { padding: .8rem 1rem 1rem; border-top: 1px solid rgba(42,38,32,.06); }
  .g-goal { font-size: .78rem; color: #c8542e; margin: 0 0 .6rem; }
  .chips { display: flex; flex-wrap: wrap; gap: .35rem; }
  .chip { font-size: .78rem; padding: .12rem .55rem; border-radius: 999px; background: #f3ecdd; color: #4a443c; }
  .chip.leader { background: rgba(200,84,46,.14); color: #c8542e; font-weight: 600; }
  .rank { display: flex; flex-direction: column; gap: .5rem; }
  .rank-row { display: grid; grid-template-columns: 2.2rem 7rem 1fr 4.2rem 5.4rem; align-items: center; gap: .6rem; padding: .42rem .8rem; border-radius: .8rem; background: #fffdf7; border: 1px solid rgba(42,38,32,.08); }
  .r-medal { font-size: 1.1rem; text-align: center; }
  .r-name { font-family: var(--font-heading); font-weight: 700; font-size: .95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .r-bar { height: 1rem; border-radius: 999px; background: #f3ecdd; overflow: hidden; }
  .fill { display: block; height: 100%; width: 0; border-radius: 999px; background: linear-gradient(90deg, #c8542e, #b8891a); transition: width 1.25s var(--ease-expo); }
  .fill.revealed { width: var(--w); }
  .rank-row.gold .fill { background: linear-gradient(90deg, #b8891a, #e8c84a); }
  .rank-row.silver .fill { background: linear-gradient(90deg, #7c7670, #b5b0a9); }
  .rank-row.bronze .fill { background: linear-gradient(90deg, #a97b4d, #d5a87b); }
  .r-avg { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; font-size: .9rem; font-family: var(--font-heading); white-space: nowrap; }
  .r-honor { font-size: .72rem; color: #8a8178; letter-spacing: .03em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .panel { background: #fffdf7; border: 1px solid rgba(42,38,32,.1); border-radius: 1rem; padding: 1.2rem; }
  .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-bottom: .8rem; }
  select { background: #fffdf7; border: 1px solid rgba(42,38,32,.14); border-radius: .6rem; padding: .3rem .6rem; font: inherit; font-size: .85rem; color: #2a2620; }
  .chart-empty { min-height: 260px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .4rem; color: #8a8178; text-align: center; background: #f3ecdd; border-radius: .8rem; padding: 1rem; }
  .chart-empty span { font-size: 1.8rem; }
  .chart-empty b { font-size: .9rem; color: #4a443c; font-family: var(--font-heading); }
  .chart-empty i { font-style: normal; font-size: .7rem; opacity: .8; }
  .chart-wrap { overflow-x: auto; }
  .chart { width: 100%; min-width: 560px; height: 260px; }
  .chart polyline { vector-effect: non-scaling-stroke; }
  .axis { font-size: 10px; fill: #8a8178; }
  .legend { display: flex; flex-wrap: wrap; gap: 10px; }
  .lg { display: flex; align-items: center; gap: 5px; font-size: .72rem; color: #4a443c; }
  .lg i { width: 9px; height: 9px; border-radius: 3px; }
  .growth-grid { display: grid; gap: 1rem; grid-template-columns: 1.1fr .9fr; }
  .star-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
  .star-card { border: 1px solid rgba(42,38,32,.08); border-radius: .8rem; padding: .7rem; display: flex; flex-direction: column; gap: .25rem; }
  .star-badge { align-self: flex-start; color: #fff; font-size: .68rem; padding: .1rem .5rem; border-radius: 6px; }
  .star-card b { font-size: .9rem; }
  .star-reason { font-size: .74rem; color: #8a8178; }
  .star-month { font-size: .68rem; color: #b8b0a4; }
  .timeline { position: relative; padding-left: 20px; }
  .timeline::before { content: ""; position: absolute; left: 5px; top: 4px; bottom: 4px; width: 2px; background: rgba(42,38,32,.12); }
  .tl-item { position: relative; padding: 0 0 16px 10px; }
  .tl-dot { position: absolute; left: -18px; top: 6px; width: 11px; height: 11px; border-radius: 50%; background: #c8542e; }
  .tl-body b { font-size: .93rem; }
  .tl-at { font-size: .7rem; color: #b8b0a4; margin-left: 8px; }
  .tl-body p { margin: 3px 0 0; font-size: .8rem; color: #4a443c; }
  .spot-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(224px, 1fr)); gap: 12px; }
  .spot-card { background: #fffdf7; border: 1px solid rgba(42,38,32,.1); border-radius: 1rem; padding: 1.1rem; transition: transform .5s var(--ease-expo), border-color .5s var(--ease-expo); }
  .spot-card:hover { transform: translateY(-3px); border-color: #c8542e; }
  .spot-icon { font-size: 1.5rem; }
  .spot-card h3 { margin: .5rem 0 .3rem; font-size: 1rem; font-family: var(--font-heading); }
  .spot-slogan { color: #c8542e; font-size: .85rem; display: block; margin-bottom: .35rem; }
  .spot-card p { margin: 0; font-size: .8rem; color: #4a443c; line-height: 1.7; }
  .quote { position: relative; padding: 1.8rem 2rem; background: linear-gradient(135deg, #fffdf7, #f3ecdd); border: 1px solid rgba(42,38,32,.1); border-radius: 1.2rem; margin: 0; }
  .quote::before { content: "“"; position: absolute; top: .1rem; left: 1rem; font-family: var(--font-heading); font-size: 4.4rem; color: #b8891a; opacity: .35; }
  .quote p { font-family: var(--font-heading); font-weight: 600; font-size: 1.08rem; line-height: 1.9; margin: 0; }
  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: .8rem; margin-top: 1rem; }
  .fact { display: flex; flex-direction: column; gap: .15rem; padding: .85rem 1rem; background: #fffdf7; border: 1px solid rgba(42,38,32,.08); border-left: 3px solid #c8542e; border-radius: .6rem; }
  .fact b { font-family: var(--font-heading); font-weight: 700; font-size: 1.05rem; }
  .fact span { font-size: .74rem; color: #8a8178; }
  @media (max-width: 768px) { .hero { grid-template-columns: 1fr; gap: 1.2rem; } }
  @media (max-width: 820px) { .growth-grid { grid-template-columns: 1fr; } .rank-row { grid-template-columns: 1.6rem 5rem 1fr 3rem; gap: .35rem; padding: .35rem .6rem; } .r-honor { grid-column: 1 / -1; padding-left: 1.8rem; font-size: .68rem; } .groups { grid-template-columns: 1fr; } }


  /* 运动会 */
  
  /* 运动会时间轴 */
  .sports-timeline { position: relative; padding-left: 1.6rem; display: flex; flex-direction: column; gap: 1.4rem; }
  .sports-timeline::before { content: ""; position: absolute; left: 5px; top: 8px; bottom: 8px; width: 2px; background: linear-gradient(180deg, #c8542e, #b8891a, rgba(200,84,46,.15)); border-radius: 2px; }
  .tl-node { position: relative; }
  .tl-marker { display: flex; align-items: center; gap: .5rem; margin-bottom: .5rem; }
  .tl-dot2 { position: absolute; left: -1.6rem; top: 0; width: 12px; height: 12px; border-radius: 50%; background: #fffdf7; border: 3px solid #c8542e; box-shadow: 0 0 0 3px rgba(200,84,46,.15); }
  .tl-time { font-family: var(--font-heading); font-weight: 700; font-size: .8rem; color: #c8542e; letter-spacing: .06em; }
  /* 项目明细 */
  .sport-items { display: flex; flex-direction: column; gap: .4rem; margin-bottom: .9rem; }
  .sport-item { display: flex; align-items: center; gap: .55rem; padding: .42rem .7rem; background: #f3ecdd; border-radius: .6rem; }
  .sport-item-ico { font-size: .9rem; flex: none; }
  .sport-item-name { font-size: .85rem; font-weight: 600; color: #2a2620; flex: 1; }
  .sport-item-rank { font-size: .74rem; font-weight: 700; color: #4a443c; background: #fffdf7; border: 1px solid rgba(42,38,32,.12); padding: .12rem .55rem; border-radius: 999px; }
  .sport-item-rank.has-medal { background: rgba(200,84,46,.14); color: #c8542e; border-color: rgba(200,84,46,.35); }
  /* 照片分类徽章 */
  .sport-thumb { position: relative; }
  .thumb-cat { position: absolute; top: .3rem; left: .3rem; font-size: .62rem; font-weight: 700; color: #fff; padding: .1rem .45rem; border-radius: 6px; letter-spacing: .04em; }
  .thumb-cat.cat-合影 { background: rgba(59,130,134,.85); }
  .thumb-cat.cat-赛场 { background: rgba(200,84,46,.85); }
  .thumb-cat.cat-荣誉 { background: rgba(184,137,26,.9); }

  .sports-list { display: flex; flex-direction: column; gap: 1.1rem; }
  .sport-card { background: #fffdf7; border: 1px solid rgba(42,38,32,.1); border-radius: 1rem; overflow: hidden; }
  .sport-head { display: flex; align-items: center; gap: .7rem; padding: .9rem 1.1rem; background: linear-gradient(120deg, #f3ecdd, #fffdf7); border-bottom: 1px solid rgba(42,38,32,.08); flex-wrap: wrap; }
  .sport-badge { background: #c8542e; color: #fff; font-size: .68rem; font-weight: 700; letter-spacing: .08em; padding: .15rem .55rem; border-radius: 6px; flex: none; }
  .sport-head h3 { font-family: var(--font-heading); font-weight: 700; font-size: 1.05rem; margin: 0; flex: 1; min-width: 0; }
  .sport-at { font-size: .72rem; color: #8a8178; font-variant-numeric: tabular-nums; flex: none; }
  .sport-body { padding: 1rem 1.1rem 1.1rem; }
  .sport-lines { display: flex; flex-wrap: wrap; gap: .45rem; margin-bottom: .9rem; }
  .sport-line { font-size: .86rem; color: #4a443c; background: #f3ecdd; border-radius: 999px; padding: .25rem .8rem; margin: 0; }
  .sport-photos { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: .7rem; }
  .sport-thumb { position: relative; border: 1px solid rgba(42,38,32,.1); border-radius: .7rem; overflow: hidden; padding: 0; background: #f3ecdd; cursor: zoom-in; display: flex; flex-direction: column; text-align: left; }
  .sport-thumb img { width: 100%; height: 110px; object-fit: cover; display: block; opacity: 1; transition: transform .5s var(--ease-expo); }
  
  .sport-thumb:hover img { transform: scale(1.04); }
  .thumb-cap { font-size: .7rem; color: #4a443c; padding: .35rem .5rem; line-height: 1.4; }
  /* 灯箱 */
  .lightbox { position: fixed; inset: 0; z-index: 60; background: rgba(20,16,12,.95); display: flex; align-items: center; justify-content: center; padding: 1.6rem; animation: lb-fade .25s var(--ease-expo); overflow: hidden; }
  .lb-figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: .9rem; max-width: 94vw; }
  .lb-figure.fig-next { animation: lb-in-r .5s var(--ease-expo); }
  .lb-figure.fig-prev { animation: lb-in-l .5s var(--ease-expo); }
  @keyframes lb-in-r { from { opacity: 0; transform: translateX(60px); } to { opacity: 1; transform: none; } }
  @keyframes lb-in-l { from { opacity: 0; transform: translateX(-60px); } to { opacity: 1; transform: none; } }
  .lb-img { max-width: 94vw; max-height: 68vh; object-fit: contain; border-radius: .6rem; box-shadow: 0 20px 60px -20px rgba(0,0,0,.6); opacity: 1; }
  
  .lb-cap { display: flex; flex-direction: column; align-items: center; gap: .45rem; color: #f3ecdd; text-align: center; max-width: 680px; }
  .lb-cap-main { font-family: var(--font-heading); font-size: 1.15rem; letter-spacing: .02em; line-height: 1.4; }
  .lb-sport { font-size: .78rem; color: #cfa88b; letter-spacing: .08em; }
  .lb-rank { font-size: .78rem; font-weight: 700; letter-spacing: .04em; background: rgba(200,84,46,.22); color: #f5c8b4; border: 1px solid rgba(200,84,46,.4); padding: .28rem .9rem; border-radius: 999px; }
  .lb-rank.medal-gold { background: rgba(184,137,26,.25); border-color: rgba(232,200,74,.5); color: #f5df9a; }
  .lb-rank.medal-silver { background: rgba(124,118,112,.3); border-color: rgba(181,176,169,.5); color: #e4e0d8; }
  .lb-rank.medal-bronze { background: rgba(169,123,77,.3); border-color: rgba(213,168,123,.5); color: #efd3b2; }
  .lb-brand { position: absolute; top: 1.4rem; left: 1.5rem; font-size: .76rem; letter-spacing: .14em; color: #f5df9a; background: rgba(184,137,26,.18); border: 1px solid rgba(232,200,74,.35); padding: .24rem .8rem; border-radius: 999px; }
  .lb-progress { position: absolute; top: 1.4rem; left: 50%; transform: translateX(-50%); color: #cfc5b8; font-size: .78rem; letter-spacing: .1em; font-variant-numeric: tabular-nums; background: rgba(0,0,0,.4); padding: .22rem .7rem; border-radius: 999px; }
  .lb-hint { position: absolute; bottom: 1.2rem; left: 50%; transform: translateX(-50%); color: #8f867a; font-size: .68rem; letter-spacing: .08em; }
  .lb-btn { position: absolute; border: none; background: rgba(255,253,247,.9); color: #2a2620; font-size: 1.5rem; line-height: 1; width: 2.6rem; height: 2.6rem; border-radius: 50%; cursor: pointer; display: grid; place-items: center; transition: background .3s, transform .3s var(--ease-expo); }
  .lb-btn:hover { background: #fff; }
  .lb-prev { left: 1.5rem; top: 50%; transform: translateY(-50%); }
  .lb-prev:hover { transform: translateY(-50%) scale(1.08); }
  .lb-next { right: 1.5rem; top: 50%; transform: translateY(-50%); }
  .lb-next:hover { transform: translateY(-50%) scale(1.08); }
  .lb-close { right: 1.5rem; top: 1.5rem; }
  @keyframes lb-fade { from { opacity: 0; } to { opacity: 1; } }
  .sport-thumb:focus-visible, .lb-btn:focus-visible { outline: 2px solid #c8542e; outline-offset: 2px; }
  @media (max-width: 560px) { .lb-prev { left: .7rem; } .lb-next { right: .7rem; } }


  /* 03 小组卡片 */
  .group-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1rem; }
  .group-card { display: grid; grid-template-columns: 110px 1fr; gap: .9rem; padding: 1rem; background: #fffdf7; border: 1px solid rgba(42,38,32,.1); border-radius: 1rem; }
  .g-poster { border-radius: .7rem; overflow: hidden; background: #f3ecdd; aspect-ratio: 3/4; }
  .g-poster img { width: 100%; height: 100%; object-fit: cover; display: block; opacity: 0; transition: opacity .6s var(--ease-expo); }
  .g-poster-empty { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .3rem; text-align: center; color: #8a8178; padding: .5rem; }
  .g-poster-empty span { font-size: 1.4rem; }
  .g-poster-empty b { font-size: .7rem; color: #4a443c; }
  .g-poster-empty i { font-style: normal; font-size: .6rem; opacity: .8; }
  .g-info { display: flex; flex-direction: column; gap: .45rem; min-width: 0; }
  .g-headline { display: flex; align-items: center; gap: .45rem; flex-wrap: wrap; }
  .g-leader { font-size: .78rem; color: #4a443c; display: flex; align-items: center; gap: .4rem; flex-wrap: wrap; }
  .leader-badge { background: rgba(184,137,26,.16); color: #8a6d12; border: 1px solid rgba(184,137,26,.35); padding: .1rem .55rem; border-radius: 999px; font-weight: 700; }
  .g-leader-none { color: #b8b0a4; font-style: normal; }
  @media (max-width: 720px) { .group-card { grid-template-columns: 1fr; } .g-poster { aspect-ratio: 16/9; } }

</style>
<!-- 全屏幻灯片 -->
{#if slide}
  <div class="lightbox" role="dialog" aria-modal="true" ontouchstart={onTouchStart} ontouchend={onTouchEnd} onclick={closeSlide}>
    {#key slide.i}
      <figure class="lb-figure {slideDir > 0 ? "fig-next" : "fig-prev"}">
        <img src={slide.photos[slide.i].src} alt={slide.photos[slide.i].caption} class="lb-img" onload={(ev) => ((ev.currentTarget as HTMLElement).style.opacity = "1")} />
        <figcaption class="lb-cap">
          <b class="lb-cap-main">{slide.photos[slide.i].caption}</b>
          <span class="lb-sport">{slide.photos[slide.i].sportTitle} · {slide.photos[slide.i].sportAt}</span>
          {#if slide.photos[slide.i].rank}
            <span class="lb-rank {rankCls(slide.photos[slide.i].rank)}">🏅 {slide.photos[slide.i].proj} · {slide.photos[slide.i].rank}</span>
          {/if}
        </figcaption>
      </figure>
    {/key}
    <div class="lb-brand">🏅 赛场高光 · 运动会图集</div>
    <div class="lb-progress">{slide.i + 1} / {slide.photos.length}</div>
    <p class="lb-hint">← 滑动 / 方向键切换 → · Esc 关闭</p>
    <button class="lb-btn lb-prev" aria-label="上一张" onclick={(ev) => { ev.stopPropagation(); prevSlide(); }}>‹</button>
    <button class="lb-btn lb-next" aria-label="下一张" onclick={(ev) => { ev.stopPropagation(); nextSlide(); }}>›</button>
    <button class="lb-btn lb-close" aria-label="关闭" onclick={(ev) => { ev.stopPropagation(); closeSlide(); }}>×</button>
  </div>
{/if}
