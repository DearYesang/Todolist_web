import { describe, expect, it } from 'vitest';
import { normalizeTask } from '../../shared/task-domain.js';
import { shouldSyncTaskToProvider } from './provider-sync.js';

describe('calendar provider sync helpers', () => {
	it('excludes completed tasks from provider calendar sync', () => {
		expect(shouldSyncTaskToProvider(normalizeTask({ status: 'todo' }))).toBe(true);
		expect(shouldSyncTaskToProvider(normalizeTask({ status: 'doing' }))).toBe(true);
		expect(shouldSyncTaskToProvider(normalizeTask({ status: 'done' }))).toBe(false);
	});
});
