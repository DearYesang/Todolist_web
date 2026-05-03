import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	cacheAuthScope,
	clearCachedAuthScope,
	readCachedAuthScope
} from './auth-session-scope.js';

describe('auth session scope cache', () => {
	/** @type {Map<string, string>} */
	let storage;

	beforeEach(() => {
		storage = new Map();
		Object.defineProperty(globalThis, 'localStorage', {
			configurable: true,
			value: {
				getItem: vi.fn((key) => storage.get(key) ?? null),
				setItem: vi.fn((key, value) => {
					storage.set(key, String(value));
				}),
				removeItem: vi.fn((key) => {
					storage.delete(key);
				})
			}
		});
	});

	afterEach(() => {
		Reflect.deleteProperty(globalThis, 'localStorage');
	});

	it('stores the last authenticated user for offline unlock', () => {
		const scope = cacheAuthScope({
			id: 'user-id',
			email: 'scyea@naver.com',
			name: 'Yesang'
		});

		expect(scope).toMatchObject({
			id: 'user-id',
			email: 'scyea@naver.com',
			name: 'Yesang'
		});
		expect(readCachedAuthScope()).toMatchObject({
			id: 'user-id',
			email: 'scyea@naver.com',
			name: 'Yesang'
		});

		clearCachedAuthScope();
		expect(readCachedAuthScope()).toBeNull();
	});

	it('ignores invalid cached records', () => {
		storage.set('todokanbanAuthScope', JSON.stringify({ email: 'scyea@naver.com' }));
		expect(readCachedAuthScope()).toBeNull();
	});
});
