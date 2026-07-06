import adapter from '@sveltejs/adapter-vercel';

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

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		csp: {
			mode: development ? 'auto' : 'hash',
			directives: cspDirectives
		},
		adapter: adapter({
			runtime: 'nodejs24.x',
			regions: ['hnd1']
		})
	}
};

export default config;
