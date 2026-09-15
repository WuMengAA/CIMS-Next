<script lang="ts">
	// 页面的「编辑」同样走独立编辑器 —— 与新建页保持同一套界面与字段，
	// 避免"新建时能设版式、编辑时改不了"这种割裂。
	import PageEditor from "$lib/components/admin/page-editor.svelte";
	import { page } from "$app/state";

	const slug = $derived(page.params.slug);
</script>

<PageEditor {slug} backUrl="/admin/pages" />
