import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const isDesktop = process.env.DESKTOP_BUILD === '1';

const adapterModule = isDesktop
	? await import('@sveltejs/adapter-static')
	: await import('@sveltejs/adapter-auto');
const adapter = adapterModule.default;

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
		adapter: isDesktop ? adapter({ fallback: 'index.html' }) : adapter()
	}
};

export default config;
