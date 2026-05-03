import { describe, expect, it } from 'vitest';
import { getHostname, normalizeRpID, normalizeWebAuthnOrigin } from './webauthn-options.js';

describe('WebAuthn option normalization', () => {
	it('normalizes origins to the exact browser origin string', () => {
		expect(normalizeWebAuthnOrigin('https://todokanban-alpha.vercel.app/')).toBe('https://todokanban-alpha.vercel.app');
		expect(normalizeWebAuthnOrigin('https://todokanban-alpha.vercel.app/path')).toBe('https://todokanban-alpha.vercel.app');
	});

	it('normalizes URL-shaped RP IDs to hostnames', () => {
		expect(normalizeRpID('https://todokanban-alpha.vercel.app/')).toBe('todokanban-alpha.vercel.app');
		expect(normalizeRpID('TODOKANBAN-ALPHA.VERCEL.APP')).toBe('todokanban-alpha.vercel.app');
	});

	it('falls back to localhost for invalid host sources', () => {
		expect(getHostname('not-a-url')).toBe('localhost');
	});
});
