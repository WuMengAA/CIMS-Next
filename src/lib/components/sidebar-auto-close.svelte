<script lang="ts">
	import { page } from "$app/state";
	import { useSidebar } from "$lib/components/ui/sidebar/index.js";

	const sidebar = useSidebar();

	// 窄屏下侧栏是**浮层抽屉**，不是常驻列。若不自动收起，点完菜单项后抽屉会继续
	// 盖住刚打开的页面，用户看到的是「点了没反应」——必须先点一次遮罩才能读到内容。
	//
	// 只动 openMobile（抽屉），不碰 open（桌面折叠态）：桌面折叠是用户偏好，
	// 已被 Provider 写进 cookie，跟着导航重置会让侧栏在每次换页时弹回来。
	//
	// 本组件必须渲染在 <Sidebar.Provider> 内部才能拿到 context，因此挂在根布局里，
	// 前台与后台共用同一份实现，避免两处各写一遍再次漂移。
	$effect(() => {
		// 显式读取，建立对路径的依赖（导航即触发）。
		page.url.pathname;
		sidebar.setOpenMobile(false);
	});
</script>
