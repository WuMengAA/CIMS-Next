<script lang="ts">
  import { reveal } from "$lib/actions/reveal.js";
  import { page } from "$app/state";

  type D = {
    profile: { quote: string; subtitle: string },
    leaders: { id: number; subject: string; name: string; icon: string }[],
    ranks: { id: number; group_name: string; avg: number; honor: string }[],
    groups: { id: number; name: string; emoji: string; goal: string; members: { name: string; role: string }[] }[]
  };
  const d = $derived(page.data as unknown as D);
  const totalMembers = $derived((d?.groups ?? []).reduce((n, g) => n + (g.members?.length ?? 0), 0));
  const topRank = $derived((d?.ranks ?? [])[0]);
  const MAX = $derived((d?.ranks ?? [])[0]?.avg ?? 400);
  const pct = (v: number) => Math.max(4, Math.round((v / MAX) * 1000) / 10);
  const medals = ["🥇", "🥈", "🥉", "4", "5", "6", "7", "8"];
  const medalOf = (i: number) => medals[i] ?? String(i + 1);
  const clsOf = (i: number) => (i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "");
</script>

<div class="board">
  <div class="pg-head">
    <span class="eyebrow">2028届8班 · 风采展</span>
    <h2 use:reveal class="reveal reveal-mask pg-title">小组风采展</h2>
    <p class="pg-sub">{d?.profile?.subtitle ?? "携手共进 · 顶峰相见"} —— 八个小组、{totalMembers} 位同学，一学期并肩同行。</p>
    <span use:reveal class="reveal ef-draw"></span>
  </div>

  <section class="sec">
    <div use:reveal class="reveal sec-head">
      <span class="sec-no">01 · 学科领航人</span>
      <h3>七位组长，各领一方</h3>
    </div>
    <div class="leaders">
      {#each d?.leaders ?? [] as l, i (l.id)}
        <div use:reveal class="reveal-wipe leader" style="--reveal-delay:{i + 1}">
          <span class="l-ico">{l.icon}</span>
          <span class="l-subj">{l.subject}组长</span>
          <span class="l-name">{l.name}</span>
        </div>
      {/each}
    </div>
  </section>

  <section class="sec">
    <div use:reveal class="reveal sec-head">
      <span class="sec-no">02 · 小组风采</span>
      <h3>八个小组，五十人集结</h3>
    </div>
    <div class="groups">
      {#each d?.groups ?? [] as g, gi (g.id)}
        <div use:reveal class="reveal-wipe group" style="--reveal-delay:{gi + 1}">
          <div class="g-head">
            <span class="g-emoji">{g.emoji}</span>
            <span class="g-name">{g.name}</span>
            <span class="g-cnt">{g.members?.length ?? 0} 人</span>
          </div>
          <div class="g-body">
            {#each g.members ?? [] as m (m.name)}
              <span class="chip" class:leader={m.role === "组长"}>{m.name}</span>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </section>

  <section class="sec">
    <div use:reveal class="reveal sec-head">
      <span class="sec-no">03 · 荣耀时刻</span>
      <h3>期末平均分排行</h3>
    </div>
    <div class="rank">
      {#each d?.ranks ?? [] as r, i (r.id)}
        <div use:reveal class="reveal rank-row {clsOf(i)}" style="--reveal-delay:{i + 1}">
          <span class="r-medal">{medalOf(i)}</span>
          <span class="r-name">{r.group_name}</span>
          <div class="r-bar"><i class="fill" style="--w:{pct(r.avg)}%"></i></div>
          <span class="r-avg">{r.avg.toFixed(2)}</span>
          <span class="r-honor">{r.honor}</span>
        </div>
      {/each}
    </div>
  </section>

  <section class="sec">
    <div use:reveal class="reveal sec-head">
      <span class="sec-no">04 · 班级寄语</span>
      <h3>目标墙 · 留白互动区</h3>
    </div>
    <blockquote use:reveal class="reveal-clamp quote">
      <p>{d?.profile?.quote ?? "一朵花独绽不是春天，百花齐放才是春色满园。高二八班，不比基础比进步，不比聪明比勤奋！"}</p>
    </blockquote>
    <div class="facts">
      <div use:reveal class="reveal fact"><b>{totalMembers} 人</b><span>班级总人数</span></div>
      <div use:reveal class="reveal fact"><b>{(d?.groups ?? []).length} 组</b><span>学习小组</span></div>
      <div use:reveal class="reveal fact"><b>{topRank ? topRank.group_name + " · " + topRank.avg.toFixed(2) : "—"}</b><span>最高分小组</span></div>
    </div>
  </section></div>
<style>
  .pg-head { display: flex; flex-direction: column; gap: .7rem; margin-bottom: 2rem; max-width: 52ch; }
  .eyebrow { display: inline-flex; align-items: center; gap: .6rem; font-size: .72rem; letter-spacing: .22em; text-transform: uppercase; color: #8a8178; font-weight: 500; }
  .eyebrow::before { content: ""; width: 1.6rem; height: 1px; background: #c8542e; }
  .pg-title { font-family: var(--font-heading); font-weight: 700; font-size: clamp(1.9rem, 4vw, 2.5rem); letter-spacing: -.02em; line-height: 1.1; margin: 0; }
  .pg-sub { color: #8a8178; font-size: .95rem; margin: 0; }

  .sec { padding: 2.4rem 0 0; margin-top: 2.4rem; border-top: 1px solid rgba(42,38,32,.12); }
  .sec-head { display: flex; flex-direction: column; gap: .25rem; margin-bottom: 1.3rem; }
  .sec-no { font-size: .75rem; font-weight: 700; letter-spacing: .18em; color: #c8542e; font-variant-numeric: tabular-nums; }
  .sec-head h3 { font-family: var(--font-heading); font-size: 1.5rem; font-weight: 700; letter-spacing: -.01em; margin: 0; }

  .leaders { display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: .8rem; }
  .leader { display: flex; flex-direction: column; align-items: center; gap: .2rem; padding: 1rem .6rem; background: #fffdf7; border: 1px solid rgba(42,38,32,.12); border-radius: .9rem; text-align: center; transition: transform .5s var(--ease-expo), border-color .5s var(--ease-expo), box-shadow .5s var(--ease-expo); }
  .leader:hover { transform: translateY(-3px); border-color: #c8542e; box-shadow: 0 16px 32px -22px rgba(42,38,32,.35); }
  .l-ico { font-size: 1.4rem; }
  .l-subj { font-size: .7rem; letter-spacing: .12em; color: #8a8178; }
  .l-name { font-family: var(--font-heading); font-weight: 700; font-size: 1rem; }

  .groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(235px, 1fr)); gap: 1rem; }
  .group { background: #fffdf7; border: 1px solid rgba(42,38,32,.12); border-radius: 1rem; overflow: hidden; transition: transform .5s var(--ease-expo), border-color .5s var(--ease-expo), box-shadow .5s var(--ease-expo); }
  .group:hover { transform: translateY(-4px); border-color: #b8891a; box-shadow: 0 20px 40px -26px rgba(42,38,32,.4); }
  .g-head { display: flex; align-items: center; gap: .6rem; padding: .85rem 1rem; background: linear-gradient(120deg, #f3ecdd, #fffdf7); border-bottom: 1px solid rgba(42,38,32,.08); }
  .g-emoji { font-size: 1.3rem; }
  .g-name { font-family: var(--font-heading); font-weight: 700; font-size: 1.08rem; flex: 1; }
  .g-cnt { font-size: .72rem; color: #8a8178; border: 1px solid rgba(42,38,32,.14); padding: .12rem .5rem; border-radius: 999px; flex: none; }
  .g-body { padding: .8rem 1rem 1rem; display: flex; flex-wrap: wrap; gap: .35rem; }
  .chip { font-size: .78rem; padding: .12rem .55rem; border-radius: 999px; background: #f3ecdd; color: #4a443c; }
  .chip.leader { background: rgba(200,84,46,.14); color: #c8542e; font-weight: 600; }

  .rank { display: flex; flex-direction: column; gap: .5rem; }
  .rank-row { display: grid; grid-template-columns: 2.2rem 7.5rem 1fr 4.6rem; align-items: center; gap: .7rem; padding: .5rem .85rem; border-radius: .8rem; background: #fffdf7; border: 1px solid rgba(42,38,32,.08); }
  .r-medal { font-size: 1.1rem; text-align: center; }
  .r-name { font-family: var(--font-heading); font-weight: 700; font-size: .95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .r-bar { height: 1rem; border-radius: 999px; background: #f3ecdd; overflow: hidden; }
  .fill { display: block; height: 100%; width: 0; border-radius: 999px; background: linear-gradient(90deg, #c8542e, #b8891a); transition: width 1.25s var(--ease-expo); }
  .fill.revealed { width: var(--w); }
  .rank-row.gold .fill { background: linear-gradient(90deg, #b8891a, #e8c84a); }
  .rank-row.silver .fill { background: linear-gradient(90deg, #7c7670, #b5b0a9); }
  .rank-row.bronze .fill { background: linear-gradient(90deg, #a97b4d, #d5a87b); }
  .r-avg { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; font-size: .9rem; font-family: var(--font-heading); white-space: nowrap; }
  .r-honor { grid-column: 2 / -1; font-size: .72rem; color: #8a8178; letter-spacing: .06em; }

  .quote { position: relative; padding: 1.8rem 2rem; background: linear-gradient(135deg, #fffdf7, #f3ecdd); border: 1px solid rgba(42,38,32,.12); border-radius: 1.2rem; margin: 0; }
  .quote p { font-family: var(--font-heading); font-weight: 600; font-size: 1.1rem; line-height: 1.9; margin: 0; }
  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: .9rem; margin-top: 1.1rem; }
  .fact { display: flex; flex-direction: column; gap: .15rem; padding: .9rem 1.1rem; background: #fffdf7; border: 1px solid rgba(42,38,32,.08); border-left: 3px solid #c8542e; border-radius: .6rem; }
  .fact b { font-family: var(--font-heading); font-weight: 700; font-size: 1.1rem; }
  .fact span { font-size: .76rem; color: #8a8178; }

  @media (max-width: 720px) {
    .rank-row { grid-template-columns: 1.8rem 6rem 1fr 3.6rem; gap: .45rem; }
    .r-honor { grid-column: 1 / -1; padding-left: 2.2rem; }
    .groups { grid-template-columns: 1fr; }
  }
</style>
