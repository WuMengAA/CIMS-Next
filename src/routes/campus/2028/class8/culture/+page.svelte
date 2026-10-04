<script lang="ts">
  import { reveal } from "$lib/actions/reveal.js";
  import { page } from "$app/state";
  type D = { spots: { id: number; key: string; title: string; slogan: string; body: string }[] };
  const d = $derived(page.data as D);
  const icons: Record<string, string> = { entry: "🚪", south_wall: "🧲", north_wall: "📢", back_wall: "📊", water: "💧", ac: "❄️", hygiene: "🧹" };
</script>
<div class="pg-head">
  <span class="eyebrow">2028届8班 · 文化</span>
  <h2 use:reveal class="reveal reveal-mask pg-title">文化点位</h2>
  <p class="pg-sub">教室里处处有育人细节 —— 点击点位了解设计</p>
  <span use:reveal class="reveal ef-draw"></span>
</div>
<div class="spot-grid">
  {#each d?.spots ?? [] as s}
    <div class="spot-card">
      <span class="spot-icon">{icons[s.key] || "📍"}</span>
      <h3>{s.title}</h3>
      <b class="spot-slogan">「{s.slogan}」</b>
      <p>{s.body}</p>
    </div>
  {/each}
</div>
<style>
  .pg-head { display: flex; flex-direction: column; gap: .7rem; margin-bottom: 1.8rem; max-width: 52ch; }
  .eyebrow { display: inline-flex; align-items: center; gap: .6rem; font-size: .72rem; letter-spacing: .22em; text-transform: uppercase; color: #8a8178; font-weight: 500; }
  .eyebrow::before { content: ""; width: 1.6rem; height: 1px; background: #c8542e; }
  .pg-title { font-family: var(--font-heading); font-weight: 700; font-size: clamp(1.9rem, 4vw, 2.5rem); letter-spacing: -.02em; line-height: 1.1; margin: 0; }
  .pg-sub { color: #8a8178; font-size: .95rem; margin: 0; }
  .spot-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
  .spot-card { background: #fffdf7; border: 1px solid rgba(42,38,32,.12); border-radius: 14px; padding: 20px; }
  .spot-icon { font-size: 30px; }
  .spot-card h3 { margin: 10px 0 8px; font-size: 17px; }
  .spot-slogan { color: #c8542e; font-size: 14px; display: block; margin-bottom: 6px; }
  .spot-card p { margin: 0; font-size: 13px; color: #8a8178; line-height: 1.7; }
</style>
