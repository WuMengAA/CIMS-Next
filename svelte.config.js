import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// ── CSRF origin 校验 ──────────────────────────────────────────────────
		// 集控面板以内网多来源访问（127.0.0.1 / localhost / 局域网 IP）为前提。
		// adapter-node 在未设置 ORIGIN 时会默认按 https 推导自身 origin，
		// 导致 http 直连的表单提交被判为跨站而返回 403
		// （"Cross-site POST form submissions are forbidden"），表现为登录按钮点击无响应。
		// 故内网部署关闭 origin 校验。
		// ⚠️ 若日后将此站点直接暴露于公网，请改回 checkOrigin: true 并正确配置 ORIGIN。
		csrf: {
			checkOrigin: false
		}
	}
};

export default config;
