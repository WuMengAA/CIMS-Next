import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';

/** @type {import('@sveltejs/kit').Config} */
// ── 构建版本标识（client / server 必须一致，否则 hydration 全崩）─────────────
// 症状：页面能渲染，但所有交互失效（侧边栏按钮无反应、弹窗异常、逻辑缺失），
// 控制台报 `Cannot read properties of undefined (reading 'data')`。
// 根因：SvelteKit 把 version 写进 SSR 的 `__sveltekit_<hash>` 全局对象，客户端用同名
// 变量取 hydration 数据。本项目走 rolldown-vite，client 与 server 是**两次独立构建**，
// 各自按默认规则（时间戳）算出不同的 hash —— 于是服务端注入 A、客户端等着 B，
// hydration 拿不到数据，整个应用从未真正启动。
// 解法：显式给定 version.name。取值优先级：
//   1) 环境变量 BUILD_ID（构建流水线可传时间戳/CI 号，便于「新部署→客户端自动刷新」）
//   2) 退化为 package.json 的 version —— 固定值，仍**保证 client/server 一致**（这是硬要求）
// 注意：这里绝不能用 Date.now()/随机数，否则两次构建又各算一个，等于没修。
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const BUILD_ID = process.env.BUILD_ID || "v" + (pkg.version || "0.0.0");

const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		version: { name: BUILD_ID },
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
