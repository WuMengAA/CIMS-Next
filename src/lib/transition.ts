/**
 * 页面过渡（路由切换动画）。
 *
 * 策略：优先使用浏览器原生的 **View Transitions API**
 * （Chrome/Edge 111+，做真正的旧页淡出 / 新页淡入交叉过渡），
 * 不支持的浏览器退化为一次轻量 fade-in，保证任何环境都有过渡感。
 *
 * 为什么不用 `{#key}` 的 out: 过渡做主方案：
 * layout 里的包裹层在导航间是**常驻**的，双向 out/in 会让新旧两棵子树同时存在，
 * 造成高度跳变。View Transitions 由浏览器在合成层做快照交叉，无重排、无 jank。
 *
 * CSS 侧配合见 `src/routes/layout.css` 的 `::view-transition-*` 规则：
 * 根快照动画被关闭，只对内容区命名元素（page-content / admin-content）做过渡，
 * 因此侧边栏、背景、进度条不会跟着闪。
 */
import { onNavigate } from "$app/navigation";
import { fade, type TransitionConfig } from "svelte/transition";
import { onDestroy } from "svelte";

/** 内容区 view-transition-name（前台）。 */
export const SITE_VT_NAME = "page-content";
/** 内容区 view-transition-name（后台）。 */
export const ADMIN_VT_NAME = "admin-content";

function supportsViewTransition(): boolean {
	return typeof document !== "undefined" && typeof (document as any).startViewTransition === "function";
}

/** 幂等标记：保证全应用只有一份 onNavigate 接管者。 */
let registered = false;

/**
 * 在 **根 layout** 初始化时调用一次：把 SvelteKit 的客户端导航接管为 View Transition。
 * 不支持的环境下自动降级（onNavigate 直接返回，不阻塞导航）。
 *
 * 幂等：重复调用不会重复注册。子布局请勿再调用（见 admin/+layout.svelte 注释）。
 */
export function enableViewTransitions(): void {
	// 幂等：根布局与后台布局都会调用本函数。若各注册一份，同一次导航会连开两次
	// View Transition —— 后一次把前一次顶掉，前一次的 ready/finished 便以
	// "AbortError: Transition was skipped" 拒绝（登录后跳 /admin 时的控制台报错即此因）。
	// 由于 onNavigate 是**组件级**生命周期（onMount 注册、随组件销毁注销），
	// 这里既要防重复注册，也要在注销后复位，允许将来根布局重挂载时再次接管。
	if (registered) return;
	registered = true;
	onDestroy(() => {
		registered = false;
	});

	onNavigate((navigation) => {
		if (!supportsViewTransition()) return;

		return new Promise<void>((resolve) => {
			// 结构化声明，避免依赖 tsconfig 的 DOM lib 版本是否已包含 ViewTransition。
			let vt: { ready?: Promise<unknown>; finished?: Promise<unknown> } | undefined;
			try {
				vt = (document as any).startViewTransition(async () => {
					// 先放行 SvelteKit 的导航（resolve 后浏览器才会做快照交叉），
					// 再等这次导航真正落定，过渡才会跟着结束。
					resolve();
					try {
						await navigation.complete;
					} catch {
						// 导航被更新的导航取代 / 主动取消属于正常竞态，不该冒泡成错误。
					}
				});
			} catch (e) {
				// 极端情况下启动失败（如文档处于不可过渡状态）：直接放行导航，不阻塞跳转。
				console.warn("[transition] startViewTransition 启动失败，已降级为无过渡", e);
				resolve();
				return;
			}

			// 关键：ViewTransition 的 ready/finished 在“过渡被跳过 / 被新过渡取代”时
			// 会以 AbortError 拒绝。必须主动接管，否则控制台会留下 unhandled rejection。
			// 典型触发场景：登录成功后 SvelteKit 立即失效重取 /admin/__data.json，
			// 第二次导航把第一次的过渡顶掉，于是抛出 "AbortError: Transition was skipped"。
			vt?.ready?.catch(() => {});
			vt?.finished?.catch(() => {});
		});
	});
}

/**
 * 内容区入场过渡。
 * 支持 View Transitions 时返回空配置（避免与原生过渡叠加成"双重动画"）；
 * 否则给一次 180ms 的淡入，保证老浏览器也有换页反馈。
 */
export function pageIn(node: Element): TransitionConfig | Record<string, never> {
	if (supportsViewTransition()) return {};
	return fade(node, { duration: 180 });
}
