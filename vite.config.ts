import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import fs from 'node:fs';

// Load .env into process.env so server code can read ADMIN_PASSWORD etc.
function loadEnvIntoProcess(mode: string) {
	const env = loadEnv(mode, process.cwd(), '');
	for (const [k, v] of Object.entries(env)) {
		if (process.env[k] === undefined) process.env[k] = v;
	}
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
		noExternal: ['morphicons']
	},
	plugins: [
		tailwindcss(),
		sveltekit()
	]
};
});