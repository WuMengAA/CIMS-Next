<script lang="ts">
  import { page } from "$app/state";
  let { children } = $props();
  import { onMount } from "svelte";
  import Class8BoardSide from "$lib/components/c8/class8-board-side.svelte";

  type PageData = {
    profile: { class_name: string; slogan: string; concept: string; intro: string; teacher: string };
    groups: unknown[]; exams: unknown[]; ranking: unknown[];
    curves: { exams: string[]; groups: { id: number; name: string; points: (number | null)[] }[] };
    stars: unknown[]; events: unknown[]; spots: unknown[];
    viewer: { username: string; role: string } | null;
  };
  const data = $derived(page.data as PageData);

    const nav = [
    { href: "/campus/2028/class8", label: "班级主页" },
    { href: "/campus/2028/class8/board", label: "风采展" },
    { href: "/campus/2028/class8/classroom3d", label: "3D教室" }
  ];

  let sloganBar = $state("入室即静，入座即学");
  onMount(() => {
    const p = data?.profile;
    if (p && p.slogan) sloganBar = p.slogan;
  });
</script>

<svelte:head>
  <title>{data?.profile?.class_name ?? "2028届8班"} · 班级专属网站</title>
</svelte:head>

<div class="c8-shell">
  <header class="c8-nav">
    <a class="c8-brand" href="/campus/2028/class8">
      <span class="c8-brand-badge">2028·8</span>
      <span class="c8-brand-name">{data?.profile?.class_name ?? "2028届8班"}</span>
    </a>
    <span class="c8-nav-hint">左侧单页 · 右侧看板</span>
  </header>
  <div class="c8-slogan-bar">
    <span class="c8-slogan">{sloganBar}</span>
    <span class="c8-slogan-sub">{data?.profile?.concept ?? ""}</span>
  </div>
  <main class="c8-main c8-main-grid">
    <div class="c8-content">
      {@render children()}
    </div>
    <Class8BoardSide data={data} />
  </main>
  <footer class="c8-foot">
    <p>2028届8班 · 班级文化建设成果展</p>
    <p class="c8-foot-sub">星集控 · 校园附加功能</p>
  </footer>
</div>

<style>
  .c8-shell { min-height: 100vh; display: flex; flex-direction: column; background: #faf6ee; color: #2a2620; }
  .c8-nav { display: flex; align-items: center; gap: 20px; padding: 12px 24px; background: #fffdf7; border-bottom: 1px solid rgba(42,38,32,.12); position: sticky; top: 0; z-index: 40; flex-wrap: wrap; }
  .c8-brand { display: flex; align-items: center; gap: 10px; text-decoration: none; color: inherit; }
  .c8-brand-badge { background: #c8542e; color: #fff; font-weight: 700; font-size: 12px; padding: 3px 8px; border-radius: 6px; letter-spacing: 1px; }
  .c8-brand-name { font-family: var(--font-heading); font-weight: 700; font-size: 17px; letter-spacing: -.01em; }
  .c8-nav-hint { margin-left: auto; font-size: .72rem; color: #8a8178; letter-spacing: .06em; }
  .c8-link { padding: 6px 12px; border-radius: 8px; text-decoration: none; color: #4a5568; font-size: 14px; }
  .c8-link:hover { background: #f3ecdd; color: #2a2620; }
  .c8-link.c8-active { background: rgba(200,84,46,.12); color: #c8542e; font-weight: 600; }
  .c8-slogan-bar { display: flex; align-items: center; gap: 14px; padding: 8px 24px; background: linear-gradient(90deg, #c8542e, #b8891a); color: #fff; }
  .c8-slogan { font-weight: 700; letter-spacing: 4px; font-size: 15px; }
  .c8-slogan-sub { opacity: .8; font-size: 12px; }
  .c8-main { flex: 1; width: 100%; max-width: 1280px; margin: 0 auto; padding: 24px 28px; }
  .c8-main-grid { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 2rem; align-items: start; }
  .c8-content { min-width: 0; }
  @media (max-width: 1024px) { .c8-main-grid { grid-template-columns: 1fr; } .c8-side { position: static; } }
  .c8-foot { border-top: 1px solid rgba(42,38,32,.12); padding: 18px 24px; text-align: center; color: #8a8178; font-size: 12px; }
  .c8-foot-sub { margin-top: 4px; opacity: .7; }
</style>
