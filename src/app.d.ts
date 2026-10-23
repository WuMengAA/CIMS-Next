// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};

// 版本注入（vite.config.ts 的 stelarithVersionPlugin）：
// SITE_VERSION 站点 semver / CONTENT_COMMIT 内容 git commit / CONTENT_BUILT_AT 提交时间。
declare module 'virtual:stelarith-version' {
	export const SITE_VERSION: string;
	export const CONTENT_COMMIT: string;
	export const CONTENT_BUILT_AT: string;
}
