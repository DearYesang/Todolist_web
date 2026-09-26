// Vitest config for the sync fuzzer and probes only. The default config
// (vite.config.js) excludes this folder, so `npm test` never runs them.
// Run from the repo root: npm run test:sync-fuzz [-- <filter>]
import { sveltekit } from '@sveltejs/kit/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
	root: fileURLToPath(new URL('../..', import.meta.url)),
	plugins: [sveltekit()],
	test: {
		include: ['tests/sync-fuzz/**/*.test.js'],
		exclude: ['node_modules/**', '.svelte-kit/**', 'tests/sync-fuzz/out/**'],
		// Same as the default config: every vi.stubGlobal is restored before each test.
		unstubGlobals: true
	}
});
