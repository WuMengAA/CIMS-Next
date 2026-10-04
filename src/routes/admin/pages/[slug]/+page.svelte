<script lang="ts">
	// 页面的「编辑」同样走独立编辑器 —— 与新建页保持同一套界面与字段，
	// 避免"新建时能设版式、编辑时改不了"这种割裂。
	import PageEditor from "$lib/components/admin/page-editor.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Eye } from "@lucide/svelte";
	import { page } from "$app/state";

	const slug = $derived(page.params.slug);

	// 「在前台查看」：只有真的发布出来了才给链接。草稿 / 未发布一律把按钮置灰并说明原因，
	// 绝不扔一条点进去看不到内容的死链给用户。
	// null = 还没确认（首帧还没拿到状态，按钮先置灰但不解释，避免对已发布内容闪一句错话）；
	// true / false = 已确认。状态与编辑器同源（都读 /api/pages?action=get），不改编辑器组件。
	let published = $state<boolean | null>(null);
	$effect(() => {
		const s = slug;
		published = null;
		if (!s || s === "new") { published = false; return; }
		let alive = true;
		fetch("/api/pages?action=get&slug=" + encodeURIComponent(s))
			.then((r) => (r.ok ? r.json() : null))
			.then((d) => { if (alive) published = d?.status === "published"; })
			.catch(() => { if (alive) published = false; });
		return () => { alive = false; };
	});
</script>

<div class="mb-4 flex flex-wrap items-center justify-end gap-2">
	{#if published === true}
		<Button variant="outline" size="sm" href={"/pages/" + slug}>
			<Eye class="size-3.5" /> 在前台查看
		</Button>
	{:else}
		{#if published === false}
			<span class="text-xs text-muted-foreground">发布后才能在前台看到</span>
		{/if}
		<Button variant="outline" size="sm" disabled>
			<Eye class="size-3.5" /> 在前台查看
		</Button>
	{/if}
</div>

<PageEditor {slug} backUrl="/admin/pages" />
