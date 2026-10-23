import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import type { Plugin } from 'vite';

// Load .env into process.env so server code can read ADMIN_PASSWORD etc.
function loadEnvIntoProcess(mode: string) {
	const env = loadEnv(mode, process.cwd(), '');
	for (const [k, v] of Object.entries(env)) {
		if (process.env[k] === undefined) process.env[k] = v;
	}
}

/**
 * 执行 git 命令取版本信息；失败（无 git / 非仓库目录）返回空串。
 */
function readGit(cmd: string): string {
	try {
		return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
	} catch {
		return '';
	}
}

/**
 * 版本注入插件 —— 参考 acofork.com 的双轨版本体系：
 *   ① 站点版本（semver）：package.json 的 version，管「发版」概念
 *   ② 内容版本（git commit）：HEAD 短 hash + 提交时间，管「页面/样式/功能」热更新
 *
 * 经 virtual module `virtual:stelarith-version` 下发，SSR 与客户端同源。
 * 无 git 环境（如 Docker 构建未 COPY .git）时退化为 "dev"，不让构建失败。
 */
function stelarithVersionPlugin(): Plugin {
	let siteVersion = '0.0.0';
	let commit = 'dev';
	let builtAt = '';
	return {
		name: 'stelarith-version',
		configResolved() {
			try {
				const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
				siteVersion = pkg.version || '0.0.0';
			} catch {
				/* package.json 读不到时用兜底值 */
			}
			// commit 读取优先级：构建参数（Docker --build-arg GIT_COMMIT，因 .dockerignore
			// 排除了 .git）> 本机 git > "dev"（无 git 环境，UI 侧会隐藏 commit 展示）。
			commit = (process.env.GIT_COMMIT || '').trim() || readGit('git rev-parse --short HEAD') || 'dev';
			builtAt = (process.env.GIT_COMMIT_AT || '').trim() || readGit('git log -1 --format=%cd --date=format:%Y-%m-%d %H:%M');
		},
		resolveId(id) {
			if (id === 'virtual:stelarith-version') return '\0stelarith-version';
		},
		load(id) {
			if (id === '\0stelarith-version') {
				return [
					`export const SITE_VERSION = ${JSON.stringify(siteVersion)};`,
					`export const CONTENT_COMMIT = ${JSON.stringify(commit)};`,
					`export const CONTENT_BUILT_AT = ${JSON.stringify(builtAt)};`
				].join('\n');
			}
		}
	};
}

export default defineConfig(({ mode }) => {
	loadEnvIntoProcess(mode);
	return {
		server: {
			fs: {
				// Allow serving files from uploads/ (media library previews)
				allow: ['.', './uploads']
			}
		},
		ssr: {
			// Libraries shipping .svelte source must be compiled by Svelte, not Node
			noExternal: ['morphicons'],
			// node:sqlite 是 Node 22 内置模块（非 npm 包），显式外置避免打包器尝试解析
			external: ['node:sqlite']
		},
		plugins: [
			tailwindcss(),
			stelarithVersionPlugin(),
			sveltekit()
		]
	};
});
