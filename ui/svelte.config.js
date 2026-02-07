import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import adapterStatic from '@sveltejs/adapter-static';

const isDesktop = process.env.DESKTOP_BUILD === '1';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		// Static adapter for both desktop (bundled) and web (nginx-served) builds
		adapter: adapterStatic({ fallback: 'index.html' }),
		paths: {
			// Desktop: no base path. Web deploy: set BASE_PATH=/v2 (or similar) at build time.
			base: isDesktop ? '' : (process.env.BASE_PATH || '')
		}
	}
};

export default config;
