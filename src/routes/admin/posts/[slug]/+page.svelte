<script lang="ts">
	import ContentEditor from "$lib/components/admin/content-editor.svelte";
	import { page } from "$app/state";

	const slug = $derived(page.params.slug);
</script>

<!--
	这里刻意**不加**「在前台查看」：博客文章这条线目前没有前台详情页
	（/posts/[slug] 路由不存在），加了就是一条点进去 404 的死链。
	等前台文章详情页做出来之后，再补上与其他三个编辑页一致的按钮。
-->
<ContentEditor section="posts" {slug} backUrl="/admin/posts" />
