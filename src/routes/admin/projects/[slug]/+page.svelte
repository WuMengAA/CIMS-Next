<script lang="ts">
	import ContentEditor from "$lib/components/admin/content-editor.svelte";
	import { page } from "$app/state";

	const slug = $derived(page.params.slug);
</script>

<ContentEditor section="projects" {slug} backUrl="/admin/projects" />