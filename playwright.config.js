import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	timeout: 30_000,
	expect: {
		timeout: 5_000
	},
	use: {
		baseURL: 'http://127.0.0.1:4173',
		trace: 'retain-on-failure',
		// The app reloads itself on service-worker controllerchange, which
		// races the WebKit runs mid-test; the suite seeds state via
		// localStorage and never depends on the worker.
		serviceWorkers: 'block'
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		},
		{
			name: 'webkit-iphone',
			use: { ...devices['iPhone 14 Pro'] }
		}
	],
	webServer: {
		command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173',
		url: 'http://127.0.0.1:4173',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		env: {
			// The preview server speaks plain HTTP; without this the baked-in
			// upgrade-insecure-requests CSP directive breaks WebKit runs.
			E2E_ALLOW_HTTP: '1'
		}
	}
});
