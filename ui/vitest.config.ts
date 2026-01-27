import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/lib/test/setup.ts'],
    // Resolve SvelteKit aliases
    alias: {
      '$lib': '/src/lib',
      '$app/environment': '/src/lib/test/mocks/app-environment.ts',
    },
  },
});
