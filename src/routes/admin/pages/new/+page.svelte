<script lang="ts">
	// 页面的「新建」走独立编辑器（page-editor），不再复用文章编辑器：
	// 页面需要版心/页头/主题色这些版式维度，文章编辑器没有也不该有。
	import PageEditor from "$lib/components/admin/page-editor.svelte";
</script>

<PageEditor slug="new" backUrl="/admin/pages" />
