import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [sveltekit()],
    test: {
        // tests/sync-fuzz has its own config (npm run test:sync-fuzz).
        exclude: ['e2e/**', 'node_modules/**', '.svelte-kit/**', 'tests/sync-fuzz/**'],
        // Restore every vi.stubGlobal before each test, so a stub cannot leak
        // into the next test and no file tears its globals down by hand.
        unstubGlobals: true
    }
});
