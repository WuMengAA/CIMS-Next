<script lang="ts">
	/**
	 * 在线心跳：登录状态下每 60s 打一次 /api/presence，
	 * 让服务端 sessions.last_seen_at 保持新鲜 —— 多用户「谁在线」由此实时判定。
	 * 页面重新可见时立即补一次心跳（切回标签页不用等下一个周期）。
	 */
	import { onMount } from "svelte";

	let { interval = 60000 }: { interval?: number } = $props();

	onMount(() => {
		let stopped = false;
		const ping = () => {
			if (stopped) return;
			fetch("/api/presence", { method: "POST" }).catch(() => { /* 离线静默 */ });
		};
		const onVisibility = () => {
			if (document.visibilityState === "visible") ping();
		};
		ping();
		const id = setInterval(ping, interval);
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			stopped = true;
			clearInterval(id);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	});
</script>
