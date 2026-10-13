import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const development = process.env.npm_lifecycle_event === 'dev';

// WebKit enforces upgrade-insecure-requests even on loopback origins, which
// breaks the plain-HTTP preview server the E2E suite runs against. Only the
// Playwright webServer sets this; real deploys never do.
const allowHttpPreview = process.env.E2E_ALLOW_HTTP === '1';

/** @type {import('@sveltejs/kit').CspDirectives} */
const cspDirectives = {
	'default-src': ['self'],
	'base-uri': ['self'],
	'object-src': ['none'],
	'frame-ancestors': ['none'],
	'img-src': ['self', 'data:', 'blob:'],
	'font-src': ['self', 'data:'],
	'style-src': ['self', 'unsafe-inline'],
	'script-src': development ? ['self', 'unsafe-inline', 'unsafe-eval'] : ['self'],
	'connect-src': development ? ['self', 'http:', 'https:', 'ws:'] : ['self'],
	'manifest-src': ['self'],
	'worker-src': ['self'],
	'form-action': ['self'],
	...(development || allowHttpPreview ? {} : { 'upgrade-insecure-requests': true })
};

export default defineConfig({
	plugins: [
		sveltekit({
			csp: {
				mode: development ? 'auto' : 'hash',
				directives: cspDirectives
			},
			adapter: adapter({ runtime: 'nodejs24.x', regions: ['hnd1'] }),
			// The PWA updates itself through the service worker (page-lifecycle.js).
			// Kit 3 polls /_app/version.json hourly by default; 0 turns that timer
			// off, as in Kit 2. Kit 3 still runs updated.check() when the tab regains
			// focus or visibility (not configurable); the worker answers version.json
			// cache-first after the first hit, and nothing here reads `updated`.
			version: { pollInterval: 0 }
		})
	],
	test: {
		exclude: ['e2e/**', 'node_modules/**', '.svelte-kit/**'],
		// Restore every vi.stubGlobal before each test, so a stub cannot leak
		// into the next test and no file tears its globals down by hand.
		unstubGlobals: true
	}
});
