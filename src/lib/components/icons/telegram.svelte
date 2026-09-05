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
	aria-hidden="true"
	class={className}
	{...rest}
	viewBox="0 0 24 24"
	role="img"
>
	<path
		d="M23.91 3.79 20.3 20.84c-.25 1.21-.98 1.5-2 .94l-5.5-4.07-2.66 2.57c-.3.3-.55.56-1.1.56l.4-5.57 10.1-9.16c.44-.4-.1-.62-.68-.22L6.03 13.1.54 11.31c-1.2-.37-1.22-1.2.26-1.78l22.06-8.5c1.02-.37 1.93.23 1.6 1.76z"
	/>
</svg>
