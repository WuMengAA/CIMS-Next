<script lang="ts">
  import { reveal } from "$lib/actions/reveal.js";
  import { page } from "$app/state";
  type D = { stars: { month: string; category: string; subject: string; reason: string }[]; events: { at: string; title: string; body: string }[] };
  const d = $derived(page.data as D);
  const starCats = ["学业进步", "作业优秀", "值日尽责", "互助奉献", "课堂活跃"];
  function catColor(c: string) {
    const m: Record<string, string> = { "学业进步": "#c8542e", "作业优秀": "#10b981", "值日尽责": "#f59e0b", "互助奉献": "#cc785c", "课堂活跃": "#f43f5e" };
    return m[c] || "#64748b";
  }
</script>
<div class="pg-head">
  <span class="eyebrow">2028届8班 · 成长</span>
  <h2 use:reveal class="reveal reveal-mask pg-title">成长看板</h2>
  <p class="pg-sub">星光榜 · 目标宣言 · 大事记</p>
  <span use:reveal class="reveal ef-draw"></span>
</div>

<section class="panel">
  <h3>月度星光榜</h3>
  <div class="star-grid">
    {#each d?.stars ?? [] as s}
      <div class="star-card">
        <span class="star-badge" style={`background:${catColor(s.category)}`}>{s.category}</span>
        <b class="star-subject">{s.subject}</b>
        <span class="star-reason">{s.reason}</span>
        <span class="star-month">{s.month}</span>
      </div>
    {/each}
  </div>
</section>

<section class="panel">
  <h3>班级大事记</h3>
  <div class="timeline">
    {#each d?.events ?? [] as e}
      <div class="tl-item">
        <span class="tl-dot"></span>
        <div class="tl-body">
          <b>{e.title}</b>
          <span class="tl-at">{e.at}</span>
          <p>{e.body}</p>
        </div>
      </div>
    {/each}
  </div>
</section>
<style>
  .pg-head { display: flex; flex-direction: column; gap: .7rem; margin-bottom: 1.8rem; max-width: 52ch; }
  .eyebrow { display: inline-flex; align-items: center; gap: .6rem; font-size: .72rem; letter-spacing: .22em; text-transform: uppercase; color: #8a8178; font-weight: 500; }
  .eyebrow::before { content: ""; width: 1.6rem; height: 1px; background: #c8542e; }
  .pg-title { font-family: var(--font-heading); font-weight: 700; font-size: clamp(1.9rem, 4vw, 2.5rem); letter-spacing: -.02em; line-height: 1.1; margin: 0; }
  .pg-sub { color: #8a8178; font-size: .95rem; margin: 0; }
  .panel { background: #fffdf7; border: 1px solid rgba(42,38,32,.12); border-radius: 14px; padding: 20px; margin-bottom: 18px; }
  .panel h3 { margin: 0 0 14px; font-size: 17px; }
  .star-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 12px; }
  .star-card { border: 1px solid #f3ecdd; border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 6px; }
  .star-badge { align-self: flex-start; color: #fff; font-size: 11px; padding: 2px 8px; border-radius: 6px; }
  .star-subject { font-size: 16px; }
  .star-reason { font-size: 12px; color: #8a8178; }
  .star-month { font-size: 11px; color: #8a8178; }
  .timeline { position: relative; padding-left: 22px; }
  .timeline::before { content: ""; position: absolute; left: 6px; top: 4px; bottom: 4px; width: 2px; background: rgba(42,38,32,.12); }
  .tl-item { position: relative; padding: 0 0 18px 10px; }
  .tl-dot { position: absolute; left: -20px; top: 6px; width: 12px; height: 12px; border-radius: 50%; background: #c8542e; border: 3px solid rgba(200,84,46,.16); }
  .tl-body b { font-size: 15px; }
  .tl-at { font-size: 11px; color: #8a8178; margin-left: 8px; }
  .tl-body p { margin: 4px 0 0; font-size: 13px; color: #8a8178; }
</style>
