import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [sveltekit()],
    test: {
        exclude: ['e2e/**', 'node_modules/**', '.svelte-kit/**']
    }
});
