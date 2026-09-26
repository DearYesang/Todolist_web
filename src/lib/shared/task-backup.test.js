import { describe, expect, it } from 'vitest';
import { extractBackupTasks } from './task-backup.js';

describe('server task import planning', () => {
	it('extracts supported backup payload shapes', () => {
		const payload = [{ id: 'legacy-task', text: 'Imported task' }];

		expect(extractBackupTasks(payload)).toBe(payload);
		expect(extractBackupTasks({ tasks: payload })).toBe(payload);
		expect(extractBackupTasks({ kanbanTasks: payload })).toBe(payload);
		expect(extractBackupTasks({ data: { tasks: payload } })).toBe(payload);
		expect(extractBackupTasks({ text: 'Not a backup' })).toBeNull();
	});
});
