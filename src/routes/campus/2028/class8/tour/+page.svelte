<script lang="ts">
  import { reveal } from "$lib/actions/reveal.js";
  import { page } from "$app/state";
  type D = { spots: { id: number; key: string; title: string; slogan: string; body: string }[] };
  const d = $derived(page.data as D);
  // 讲解员路线：宣传栏 → 饮水处 → 侧墙 → 空调 → 后墙 → 卫生角
  const routeKeys = ["entry", "water", "south_wall", "ac", "back_wall", "hygiene"];
  const route = $derived(
    routeKeys.map((k) => (d?.spots ?? []).find((s) => s.key === k)).filter(Boolean) as { id: number; key: string; title: string; slogan: string; body: string }[]
  );
  let step = $state(0);
  const current = $derived(route[Math.min(step, route.length - 1)]);
  const isLast = $derived(step >= route.length - 1);
</script>

<div class="pg-head">
  <span class="eyebrow">2028届8班 · 验收</span>
  <h2 use:reveal class="reveal reveal-mask pg-title">虚拟验收</h2>
  <p class="pg-sub">学生文化讲解员路线：宣传栏 → 饮水处 → 侧墙 → 空调 → 后墙 → 卫生角</p>
  <span use:reveal class="reveal ef-draw"></span>
</div>

<div class="tour-progress">
  {#each route as r, i}
    <div class="tp-node" class:done={i < step} class:cur={i === step}>
      <span class="tp-no">{i + 1}</span>
      <span class="tp-label">{r.title}</span>
    </div>
    {#if i < route.length - 1}<span class="tp-arrow">→</span>{/if}
  {/each}
</div>

{#if current}
  <div class="tour-stage">
    <div class="tour-card">
      <span class="tour-step">第 {step + 1} 站</span>
      <h3>{current.title}</h3>
      <b class="tour-slogan">「{current.slogan}」</b>
      <p>{current.body}</p>
      <p class="tour-script">讲解词（示例）：这里是{current.title}，我们班的理念是「{current.slogan}」——{current.body}这一设计希望让每位同学在细节中养成好习惯。（占位文案，可替换）</p>
    </div>
  </div>
  <div class="tour-nav">
    <button disabled={step === 0} onclick={() => step--}>← 上一站</button>
    {#if !isLast}
      <button class="primary" onclick={() => step++}>下一站 →</button>
    {:else}
      <button class="primary" onclick={() => (step = 0)}>🔄 重新开始</button>
    {/if}
  </div>
{/if}

<style>
  .pg-head { display: flex; flex-direction: column; gap: .7rem; margin-bottom: 1.8rem; max-width: 52ch; }
  .eyebrow { display: inline-flex; align-items: center; gap: .6rem; font-size: .72rem; letter-spacing: .22em; text-transform: uppercase; color: #8a8178; font-weight: 500; }
  .eyebrow::before { content: ""; width: 1.6rem; height: 1px; background: #c8542e; }
  .pg-title { font-family: var(--font-heading); font-weight: 700; font-size: clamp(1.9rem, 4vw, 2.5rem); letter-spacing: -.02em; line-height: 1.1; margin: 0; }
  .pg-sub { color: #8a8178; font-size: .95rem; margin: 0; }
  .tour-progress { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 22px; background: #fffdf7; border: 1px solid rgba(42,38,32,.12); border-radius: 14px; padding: 14px 18px; }
  .tp-node { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 10px; background: #f3ecdd; }
  .tp-no { width: 22px; height: 22px; border-radius: 7px; background: rgba(200,84,46,.16); color: #c8542e; display: grid; place-items: center; font-size: 12px; font-weight: 700; }
  .tp-label { font-size: 13px; }
  .tp-node.done { background: #e9f0e3; } .tp-node.done .tp-no { background: #10b981; color: #fff; }
  .tp-node.cur { background: rgba(200,84,46,.12); box-shadow: 0 0 0 2px #c8542e; } .tp-node.cur .tp-no { background: #c8542e; color: #fff; }
  .tp-arrow { color: #b8b0a4; }
  .tour-stage { background: #fffdf7; border: 1px solid rgba(42,38,32,.12); border-radius: 16px; padding: 32px; max-width: 720px; }
  .tour-step { font-size: 12px; letter-spacing: 2px; color: #c8542e; font-weight: 700; }
  .tour-card h3 { font-size: 26px; margin: 10px 0 8px; }
  .tour-slogan { color: #c8542e; font-size: 18px; display: block; margin-bottom: 12px; }
  .tour-card p { font-size: 14px; color: #4a443c; line-height: 1.8; margin: 0 0 12px; }
  .tour-script { background: #f6f0e4; border-radius: 10px; padding: 12px 14px; font-size: 13px; color: #8a8178; }
  .tour-nav { display: flex; gap: 12px; margin-top: 16px; }
  .tour-nav button { padding: 10px 22px; border-radius: 10px; border: 1px solid #d4dae3; background: #fffdf7; cursor: pointer; font-size: 14px; }
  .tour-nav button.primary { background: #c8542e; color: #fff; border-color: #c8542e; }
  .tour-nav button:disabled { opacity: .45; cursor: not-allowed; }
</style>
