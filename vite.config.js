import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [sveltekit()],
    test: {
        exclude: ['e2e/**', 'node_modules/**', '.svelte-kit/**'],
        // Restore every vi.stubGlobal before each test, so a stub cannot leak
        // into the next test and no file tears its globals down by hand.
        unstubGlobals: true
    }
});
