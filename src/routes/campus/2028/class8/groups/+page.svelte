<script lang="ts">
  import { reveal } from "$lib/actions/reveal.js";
  import { page } from "$app/state";
  type G = { id: number; name: string; goal: string; members: { name: string; role: string; motto: string }[] };
  const d = $derived(page.data as { groups: G[] });
  let openGroup = $state<number | null>(null);
</script>
<div class="pg-head">
  <span class="eyebrow">2028届8班 · 小组</span>
  <h2 use:reveal class="reveal reveal-mask pg-title">小组自治</h2>
  <p class="pg-sub">8 个小组 · 组名 · 成员 · 组长 · 共同目标</p>
  <span use:reveal class="reveal ef-draw"></span>
</div>
<div class="groups-grid">
  {#each d?.groups ?? [] as g, gi}
    <div class="group-card" class:open={openGroup === g.id}>
      <button class="group-head" onclick={() => (openGroup = openGroup === g.id ? null : g.id)}>
        <span class="group-no">{String(gi + 1).padStart(2, "0")}</span>
        <div class="group-info">
          <b>{g.name}</b>
          <span class="group-goal">{g.goal}</span>
        </div>
        <span class="group-count">{g.members.length} 人</span>
      </button>
      {#if openGroup === g.id}
        <div class="group-members">
          {#each g.members as m}
            <div class="member">
              <span class="member-name">{m.name}</span>
              <span class="member-role">{m.role}</span>
              {#if m.motto}<span class="member-motto">{m.motto}</span>{/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>
<style>
  .pg-head { display: flex; flex-direction: column; gap: .7rem; margin-bottom: 1.8rem; max-width: 52ch; }
  .eyebrow { display: inline-flex; align-items: center; gap: .6rem; font-size: .72rem; letter-spacing: .22em; text-transform: uppercase; color: #8a8178; font-weight: 500; }
  .eyebrow::before { content: ""; width: 1.6rem; height: 1px; background: #c8542e; }
  .pg-title { font-family: var(--font-heading); font-weight: 700; font-size: clamp(1.9rem, 4vw, 2.5rem); letter-spacing: -.02em; line-height: 1.1; margin: 0; }
  .pg-sub { color: #8a8178; font-size: .95rem; margin: 0; }
  .groups-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
  .group-card { background: #fffdf7; border: 1px solid rgba(42,38,32,.12); border-radius: 14px; overflow: hidden; }
  .group-head { width: 100%; display: flex; align-items: center; gap: 12px; padding: 16px; background: none; border: none; cursor: pointer; text-align: left; }
  .group-no { font-size: 20px; font-weight: 800; color: #c8542e; width: 34px; }
  .group-info { flex: 1; min-width: 0; }
  .group-info b { display: block; font-size: 17px; }
  .group-goal { font-size: 12px; color: #8a8178; }
  .group-count { font-size: 12px; color: #8a8178; }
  .group-members { border-top: 1px solid #f3ecdd; padding: 12px 16px; display: grid; gap: 8px; }
  .member { display: flex; align-items: center; gap: 10px; font-size: 13px; }
  .member-name { font-weight: 600; }
  .member-role { color: #8a8178; background: #f3ecdd; padding: 2px 8px; border-radius: 6px; font-size: 11px; }
  .member-motto { color: #8a8178; font-size: 11px; margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px; }
</style>
