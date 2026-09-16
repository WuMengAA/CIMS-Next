<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";

	let {
		size = 24,
		class: className,
		...rest
	}: HTMLAttributes<SVGElement> & { size?: number | string } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="currentColor"
	stroke="none"
	aria-hidden="true"
	class={className}
	{...rest}
>
	<path
		d="M17.813 4.653h.854c.462 0 .89.285 1.068.712l1.67 4.043H5.795l1.67-4.043A1.16 1.16 0 0 1 8.533 4.653h.854a.59.59 0 1 1 0 1.179H8.85a.57.57 0 0 0-.524.346L7.132 9.88h10.227l-1.194-3.702a.57.57 0 0 0-.524-.346h-.837a.59.59 0 1 1 0-1.179ZM7.06 10.71h10.66a2.33 2.33 0 0 1 2.327 2.328v5.12A2.33 2.33 0 0 1 17.72 20.486H6.867a2.33 2.33 0 0 1-2.327-2.328v-5.12a2.33 2.33 0 0 1 2.327-2.328Zm1.506 3.329a1.179 1.179 0 1 0 0 2.358 1.179 1.179 0 0 0 0-2.358Zm7.266 0a1.179 1.179 0 1 0 0 2.358 1.179 1.179 0 0 0 0-2.358Z"
	/>
</svg>
