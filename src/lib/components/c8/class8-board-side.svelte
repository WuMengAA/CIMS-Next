<script lang="ts">
  import { page } from "$app/state";
  // 右侧看板：班级数据总览 + 分类二级折叠菜单
  let { data }: { data: any } = $props();

  type Item = { label: string; href: string };
  const CATS: { key: string; label: string; icon: string; items: Item[] }[] = [
    { key: "overview", label: "班级概览", icon: "📌", items: [{ label: "班级主页", href: "/campus/2028/class8" }] },
    { key: "autonomy", label: "班级自治", icon: "📚", items: [
      { label: "班级公约", href: "/campus/2028/class8/rules" },
      { label: "小组自治", href: "/campus/2028/class8/groups" },
      { label: "学业追踪", href: "/campus/2028/class8/academics" },
      { label: "成长看板", href: "/campus/2028/class8/growth" }
    ] },
    { key: "showcase", label: "班级展示", icon: "🏅", items: [
      { label: "风采展", href: "/campus/2028/class8/board" },
      { label: "3D 教室", href: "/campus/2028/class8/classroom3d" },
      { label: "文化点位", href: "/campus/2028/class8/culture" },
      { label: "虚拟验收", href: "/campus/2028/class8/tour" }
    ] }
  ];

  let openCat = $state<Record<string, boolean>>({ overview: true, autonomy: true, showcase: true });

  const groups = $derived((data?.groups ?? []) as any[]);
  const total = $derived(groups.reduce((a: number, g: any) => a + (g.members?.length || 0), 0));
  const top = $derived((data?.ranks ?? [])[0] as any);
  const sports = $derived((data?.events ?? []).filter((e: any) => e.title?.includes("运动会")));
  const isActive = (href: string) => page.url.pathname === href;
</script>

<aside class="c8-side">
  <!-- 班级卡 -->
  <div class="c8-side-card c8-class-card">
    <span class="c8-side-badge">2028·8</span>
    <b class="c8-side-name">{data?.profile?.class_name ?? "2028届8班"}</b>
    <span class="c8-side-slogan">「{data?.profile?.slogan ?? "携手共进，顶峰相见"}」</span>
  </div>

  <!-- 数据总览 -->
  <div class="c8-side-card c8-stats">
    <div class="c8-stat"><b>{groups.length}</b><span>小组</span></div>
    <div class="c8-stat"><b>{total}</b><span>同学</span></div>
    <div class="c8-stat"><b>{top ? top.group_name.slice(0, 4) : "—"}</b><span>领跑</span></div>
    <div class="c8-stat"><b>{sports.length}</b><span>运动会</span></div>
  </div>

  <!-- 分类折叠菜单 -->
  <div class="c8-side-card c8-menu">
    {#each CATS as cat (cat.key)}
      <div class="c8-cat">
        <button class="c8-cat-head" onclick={() => (openCat[cat.key] = !openCat[cat.key])} aria-expanded={openCat[cat.key]}>
          <span class="c8-cat-icon">{cat.icon}</span>
          <span class="c8-cat-label">{cat.label}</span>
          <span class="c8-cat-arrow">{openCat[cat.key] ? "▾" : "▸"}</span>
        </button>
        {#if openCat[cat.key]}
          <div class="c8-cat-items">
            {#each cat.items as item (item.href)}
              <a href={item.href} class="c8-cat-item" class:c8-active={isActive(item.href)}>
                {item.label}
              </a>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <p class="c8-side-tip">点击大类折叠 · 当前页高亮</p>
</aside>

<style>
  .c8-side { position: sticky; top: 92px; display: flex; flex-direction: column; gap: .8rem; }
  .c8-side-card { background: #fffdf7; border: 1px solid rgba(42,38,32,.1); border-radius: 1rem; padding: 1rem; }
  .c8-class-card { display: flex; flex-direction: column; gap: .3rem; }
  .c8-side-badge { align-self: flex-start; background: #c8542e; color: #fff; font-weight: 700; font-size: .68rem; padding: .15rem .55rem; border-radius: 6px; letter-spacing: .06em; }
  .c8-side-name { font-family: var(--font-heading); font-weight: 700; font-size: 1.05rem; }
  .c8-side-slogan { font-size: .76rem; color: #8a8178; }
  .c8-stats { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; }
  .c8-stat { display: flex; flex-direction: column; gap: .1rem; padding: .5rem .7rem; background: #f3ecdd; border-radius: .6rem; }
  .c8-stat b { font-family: var(--font-heading); font-size: 1.2rem; color: #c8542e; }
  .c8-stat span { font-size: .68rem; color: #8a8178; }
  .c8-menu { padding: .4rem; }
  .c8-cat-head { width: 100%; display: flex; align-items: center; gap: .5rem; padding: .55rem .6rem; background: none; border: none; cursor: pointer; font: inherit; color: #2a2620; border-radius: .5rem; }
  .c8-cat-head:hover { background: #f3ecdd; }
  .c8-cat-icon { font-size: .85rem; }
  .c8-cat-label { font-weight: 700; font-size: .85rem; flex: 1; text-align: left; }
  .c8-cat-arrow { color: #c8542e; font-size: .7rem; }
  .c8-cat-items { display: flex; flex-direction: column; margin: .2rem 0 .4rem; }
  .c8-cat-item { padding: .4rem .9rem .4rem 1.9rem; font-size: .82rem; color: #4a443c; text-decoration: none; border-radius: .5rem; }
  .c8-cat-item:hover { background: #f3ecdd; }
  .c8-cat-item.c8-active { background: rgba(200,84,46,.12); color: #c8542e; font-weight: 600; }
  .c8-side-tip { font-size: .66rem; color: #b8b0a4; text-align: center; }
</style>
