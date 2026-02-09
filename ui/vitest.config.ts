import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
  plugins: [sveltekit()],
  resolve: {
    conditions: ['browser'],
  },
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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      include: ['src/lib/**/*.{ts,svelte}'],
      exclude: [
        'src/lib/test/**',
        'src/lib/types/**',
        'src/lib/index.ts',
        '**/*.d.ts',
        'src/lib/components/Scene.svelte',
        'src/lib/components/*3D*.svelte',
        'src/lib/components/ViewSnapOverlay.svelte',
        'src/lib/components/DisplayControlOverlay.svelte',
      ],
      thresholds: {
        statements: 50,
        branches: 40,
        functions: 45,
        lines: 50,
      },
    },
  },
});
