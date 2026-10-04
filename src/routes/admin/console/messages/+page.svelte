<script lang="ts">
  import { Megaphone, Send, Inbox } from "@lucide/svelte";

  // 消息中心 tab 壳：聚合「广播下发 / 定向通知 / 指令回执」三个子页，
  // 同源 iframe 以 ?embed=1 嵌入（无后台外壳），一项一 tab，避免功能到处找。
  //
  // 配色一律走站点令牌（bg-muted/40、text-muted-foreground、border-border/60…），
  // 不再写死亮色 hex（#f4f5f7 / #fff / #2b4fd8）：站点默认深色，写死亮色会让
  // 这两个页在深色模式下变成刺眼的亮块，与后台其它页割裂。
  // 视觉与后台既有的 ViewSwitch 分段控件保持一致（同一套圆角/边框/选中态）。
  const tabs = [
    { id: "broadcast", label: "广播下发", icon: Megaphone, url: "/admin/console/broadcast?embed=1" },
    { id: "notify", label: "定向通知", icon: Send, url: "/admin/console/notify?embed=1" },
    { id: "receipts", label: "指令回执", icon: Inbox, url: "/admin/console/receipts?embed=1" }
  ];
  let active = $state("broadcast");
  const cur = $derived(tabs.find(t => t.id === active) ?? tabs[0]);
</script>

<div class="mg-shell">
  <div class="mg-head">
    <h1 class="mg-title text-foreground">消息中心</h1>
    <div class="mg-tabs rounded-lg border border-border/60 bg-muted/40" role="tablist">
      {#each tabs as t}
        {@const Icon = t.icon}
        <button
          class="mg-tab rounded-md text-muted-foreground transition-colors hover:text-foreground"
          class:on={t.id === active}
          role="tab"
          aria-selected={t.id === active}
          onclick={() => (active = t.id)}
        >
          <Icon class="size-4" />
          {t.label}
        </button>
      {/each}
    </div>
  </div>
  <div class="mg-body rounded-xl">
    <iframe class="mg-frame rounded-xl border border-border/60 bg-background" title={cur.label} src={cur.url} loading="eager"></iframe>
  </div>
</div>

<style>
  /* 只保留布局：高度撑满内容区（减去后台顶栏），配色交给上面的令牌类。 */
  .mg-shell { display: flex; flex-direction: column; gap: 12px; height: calc(100vh - 88px); }
  .mg-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .mg-title { font-size: 20px; font-weight: 600; margin: 0; }
  .mg-tabs { display: flex; gap: 6px; padding: 4px; }
  .mg-tab { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border: none; background: transparent; cursor: pointer; font-size: 13px; }
  /* 选中态同样走令牌。注意：本站令牌是**完整色值**（--background: #faf9f5），
     不是 HSL 三元组 —— 必须直接 var(--x)，写成 hsl(var(--x)) 会整条失效。 */
  .mg-tab.on { background: var(--background); color: var(--primary); font-weight: 500; box-shadow: 0 1px 4px rgb(0 0 0 / 0.08); }
  .mg-body { flex: 1; min-height: 0; overflow: hidden; }
  .mg-frame { width: 100%; height: 100%; }
</style>
