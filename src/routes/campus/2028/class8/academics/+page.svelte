<script lang="ts">
  import { reveal } from "$lib/actions/reveal.js";
  import { page } from "$app/state";
  type D = {
    exams: { id: number; title: string; exam_date: string }[];
    ranking: { name: string; avg: number | null }[];
    curves: { exams: string[]; groups: { id: number; name: string; points: (number | null)[] }[] };
    viewer: { username: string; role: string } | null;
  };
  const d = $derived(page.data as D);
  let subject = $state("全部");
  const SUBJECTS = ["全部", "语文", "数学", "英语", "物理", "化学", "生物", "政治", "历史", "地理"];

  // 折线图：简单 SVG polyline（无第三方依赖）
  const W = 720, H = 260, PAD = 34;
  const colors = ["#c8542e", "#10b981", "#f59e0b", "#cc785c", "#ef4444", "#14b8a6", "#f43f5e", "#6366f1"];
  function linePoints(pts: (number | null)[], maxV: number, minV: number) {
    const n = pts.length;
    return pts.map((v, i) => {
      if (v === null) return null;
      const x = PAD + (i / Math.max(1, n - 1)) * (W - PAD * 2);
      const y = H - PAD - ((v - minV) / Math.max(1, maxV - minV)) * (H - PAD * 2);
      return x + "," + y;
    }).filter(Boolean).join(" ");
  }
  function allVals() {
    const arr: number[] = [];
    for (const g of d?.curves?.groups ?? []) for (const v of g.points) if (v !== null) arr.push(v);
    return arr.length ? { max: Math.max(...arr), min: Math.min(...arr) } : { max: 100, min: 60 };
  }
  const range = $derived(allVals());
  const rankTop = $derived(d?.ranking ?? []);
</script>

<div class="pg-head">
  <span class="eyebrow">2028届8班 · 学业</span>
  <h2 use:reveal class="reveal reveal-mask pg-title">学业追踪</h2>
  <p class="pg-sub">小组维度 · 不公开个人排名</p>
  <span use:reveal class="reveal ef-draw"></span>
</div>

<section class="panel">
  <div class="panel-head">
    <h3>小组排行（最近一次考试均分）</h3>
  </div>
  <div class="rank-list">
    {#each rankTop as r, i}
      <div class="rank-row">
        <span class="rank-no">{i + 1}</span>
        <span class="rank-name">{r.name}</span>
        <div class="rank-bar"><i style={`width: ${r.avg === null ? 0 : Math.max(6, (r.avg - 55) * 2.4)}%`}></i></div>
        <span class="rank-avg">{r.avg === null ? "—" : r.avg.toFixed(1)}</span>
      </div>
    {/each}
  </div>
</section>

<section class="panel">
  <div class="panel-head">
    <h3>小组均分趋势</h3>
    <select bind:value={subject}>
      {#each SUBJECTS as s}<option value={s}>{s}</option>{/each}
    </select>
  </div>
  <div class="chart-wrap">
    <svg viewBox={"0 0 " + W + " " + H} class="chart">
      <!-- 网格 -->
      {#each [0, 1, 2, 3, 4] as i}
        <line x1={PAD} y1={PAD + i * ((H - PAD * 2) / 4)} x2={W - PAD} y2={PAD + i * ((H - PAD * 2) / 4)} stroke="#e8ecf2" />
      {/each}
      {#each (d?.curves?.groups ?? []) as g, gi}
        {@const pts = linePoints(g.points, range.max, range.min)}
        {#if pts}
          <polyline points={pts} fill="none" stroke={colors[gi % colors.length]} stroke-width="2.5" />
        {/if}
      {/each}
      <!-- X 轴刻度 -->
      {#each (d?.curves?.exams ?? []) as ex, i}
        <text x={PAD + (i / Math.max(1, (d?.curves?.exams?.length ?? 1) - 1)) * (W - PAD * 2)} y={H - 10} text-anchor="middle" font-size="11" fill="#8a8178">{ex}</text>
      {/each}
    </svg>
    <div class="legend">
      {#each (d?.curves?.groups ?? []) as g, gi}
        <span class="lg"><i style={`background:${colors[gi % colors.length]}`}></i>{g.name}</span>
      {/each}
    </div>
  </div>
</section>

<p class="privacy-note">🔒 成绩仅以班级/小组整体呈现，不公示个人排名 —— 保护每一位同学。</p>

<style>
  .pg-head { display: flex; flex-direction: column; gap: .7rem; margin-bottom: 1.8rem; max-width: 52ch; }
  .eyebrow { display: inline-flex; align-items: center; gap: .6rem; font-size: .72rem; letter-spacing: .22em; text-transform: uppercase; color: #8a8178; font-weight: 500; }
  .eyebrow::before { content: ""; width: 1.6rem; height: 1px; background: #c8542e; }
  .pg-title { font-family: var(--font-heading); font-weight: 700; font-size: clamp(1.9rem, 4vw, 2.5rem); letter-spacing: -.02em; line-height: 1.1; margin: 0; }
  .pg-sub { color: #8a8178; font-size: .95rem; margin: 0; }
  .panel { background: #fffdf7; border: 1px solid rgba(42,38,32,.12); border-radius: 14px; padding: 20px; margin-bottom: 18px; }
  .panel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
  .panel-head h3 { margin: 0; font-size: 17px; }
  .rank-list { display: grid; gap: 10px; }
  .rank-row { display: flex; align-items: center; gap: 12px; }
  .rank-no { width: 26px; height: 26px; border-radius: 8px; background: #f3ecdd; color: #4a443c; display: grid; place-items: center; font-weight: 700; font-size: 13px; }
  .rank-row:first-child .rank-no { background: #b8891a; color: #fff; }
  .rank-row:nth-child(2) .rank-no { background: #9a9590; color: #fff; }
  .rank-row:nth-child(3) .rank-no { background: #a97b4d; color: #fff; }
  .rank-name { width: 90px; font-weight: 600; font-size: 14px; }
  .rank-bar { flex: 1; height: 12px; background: #f3ecdd; border-radius: 6px; overflow: hidden; }
  .rank-bar i { display: block; height: 100%; background: linear-gradient(90deg, #c8542e, #b8891a); border-radius: 6px; }
  .rank-avg { width: 48px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; }
  .chart-wrap { overflow-x: auto; }
  .chart { width: 100%; min-width: 560px; }
  .legend { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 10px; }
  .lg { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #8a8178; }
  .lg i { width: 10px; height: 10px; border-radius: 3px; }
  .privacy-note { margin-top: 6px; font-size: 12px; color: #8a8178; }
</style>
