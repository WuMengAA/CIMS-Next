<script lang="ts">
  import { reveal } from "$lib/actions/reveal.js";
  import { page } from "$app/state";
  type D = { profile: { class_name: string; slogan: string; concept: string; intro: string; teacher: string }; };
  const d = $derived(page.data as D);
  const rules = [
    "入室即静，入座即学",
    "按时到班，不迟到不早退",
    "作业独立完成，不抄不拖",
    "值日尽责，工具归位",
    "课堂积极思考，勇于发言",
    "同学互助，不嘲笑不孤立",
    "手机不进教室，专注学习",
    "爱护公物，节约水电"
  ];
  const timetables = [
    { t: "7:30", v: "早读" },
    { t: "8:00-8:45", v: "第一节" },
    { t: "9:00-9:45", v: "第二节" },
    { t: "10:00-10:45", v: "第三节" },
    { t: "11:00-11:45", v: "第四节" },
    { t: "14:00-14:45", v: "第五节" },
    { t: "15:00-15:45", v: "第六节" },
    { t: "16:00-16:45", v: "第七节" }
  ];
</script>
<div class="pg-head">
  <span class="eyebrow">2028届8班 · 公约</span>
  <h2 use:reveal class="reveal reveal-mask pg-title">班级公约</h2>
  <p class="pg-sub">{d?.profile?.class_name ?? ""} · 全体同学共同讨论制定</p>
  <span use:reveal class="reveal ef-draw"></span>
</div>
<div class="rules-grid">
  {#each rules as r, i}
    <div class="rule-card"><span class="rule-no">{i + 1}</span><span>{r}</span></div>
  {/each}
</div>
<h3 class="pg-h3">每日作息</h3>
<div class="timetable">
  {#each timetables as t}
    <div class="tt-row"><span class="tt-time">{t.t}</span><span>{t.v}</span></div>
  {/each}
</div>
<style>
  .pg-head { display: flex; flex-direction: column; gap: .7rem; margin-bottom: 1.8rem; max-width: 52ch; }
  .eyebrow { display: inline-flex; align-items: center; gap: .6rem; font-size: .72rem; letter-spacing: .22em; text-transform: uppercase; color: #8a8178; font-weight: 500; }
  .eyebrow::before { content: ""; width: 1.6rem; height: 1px; background: #c8542e; }
  .pg-title { font-family: var(--font-heading); font-weight: 700; font-size: clamp(1.9rem, 4vw, 2.5rem); letter-spacing: -.02em; line-height: 1.1; margin: 0; }
  .pg-sub { color: #8a8178; font-size: .95rem; margin: 0; }
  .rules-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .rule-card { display: flex; align-items: center; gap: 12px; background: #fffdf7; border: 1px solid rgba(42,38,32,.12); border-radius: 12px; padding: 16px 18px; font-size: 15px; }
  .rule-no { width: 26px; height: 26px; border-radius: 8px; background: #c8542e; color: #fff; display: grid; place-items: center; font-size: 13px; font-weight: 700; flex: none; }
  .pg-h3 { margin: 30px 0 12px; font-size: 19px; }
  .timetable { background: #fffdf7; border: 1px solid rgba(42,38,32,.12); border-radius: 12px; overflow: hidden; max-width: 520px; }
  .tt-row { display: flex; gap: 16px; padding: 10px 16px; border-bottom: 1px solid #f3ecdd; font-size: 14px; }
  .tt-row:last-child { border-bottom: none; }
  .tt-time { width: 110px; color: #8a8178; font-variant-numeric: tabular-nums; }
</style>
