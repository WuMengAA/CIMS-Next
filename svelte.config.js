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

// ── 构建输出目录可覆盖（原子发布用，见 scripts/release-site.mjs）──────────────
// 默认仍是 "build"，与历史行为完全一致。
// 发布时传 STELLARITH_BUILD_OUT=build.next，把新版本构到**旁路目录**，
// 全程不碰正在服务的 build/ —— 这样"构建中恰好重启"永远不会撞到半成品产物
// （症状：node 启动后 0.15 秒即退出、连崩 20+ 次 = 数分钟打不开）。
const BUILD_OUT = process.env.STELLARITH_BUILD_OUT || "build";

const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({ out: BUILD_OUT }),
		version: { name: BUILD_ID },
		// ── CSRF origin 校验 ──────────────────────────────────────────────────
		// 站点已通过 Cloudflare Tunnel 接入公网（正式域名 www.245959623.xyz），
		// .env 的 ORIGIN 已设为该正式域名，故开启 origin 校验以防御 CSRF。
		// 内网调试期曾因多来源访问（127.0.0.1 / localhost / 局域网 IP）+ ORIGIN 未配置，
		// 导致 http 直连表单提交被判跨站返回 403，彼时临时关闭（checkOrigin: false）；
		// 公网暴露后必须开启，否则等于无 CSRF 防护。
		// ⚠️ 前置硬条件：运行时 ORIGIN 必须等于浏览器实际访问的域名
		//   （https://www.245959623.xyz），否则所有 POST/表单会被判跨站 403。
		//   源站真实 .env（非 .env.example）的 ORIGIN 若为 localhost，必须先改。
		csrf: {
			checkOrigin: true
		}
	}
};

export default config;
