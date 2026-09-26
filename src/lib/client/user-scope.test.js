import { beforeEach, describe, expect, it } from 'vitest';
import { installMemoryStorage } from '$lib/test-support/browser-globals.js';
import {
	cacheAuthScope,
	clearCachedAuthScope,
	readCachedAuthScope
} from './user-scope.js';

describe('auth session scope cache', () => {
	/** @type {Map<string, string>} */
	let storage;

	beforeEach(() => {
		storage = installMemoryStorage();
	});

	it('stores the last authenticated user for offline unlock', () => {
		const scope = cacheAuthScope({
			id: 'user-id',
			email: 'primary@example.com',
			name: 'Yesang'
		});

		expect(scope).toMatchObject({
			id: 'user-id',
			email: 'primary@example.com',
			name: 'Yesang'
		});
		expect(readCachedAuthScope()).toMatchObject({
			id: 'user-id',
			email: 'primary@example.com',
			name: 'Yesang'
		});

		clearCachedAuthScope();
		expect(readCachedAuthScope()).toBeNull();
	});

	it('ignores invalid cached records', () => {
		storage.set('todokanbanAuthScope', JSON.stringify({ email: 'primary@example.com' }));
		expect(readCachedAuthScope()).toBeNull();
	});
});
