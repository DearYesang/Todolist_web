import { describe, expect, it } from 'vitest';
import { mapTaskRowsToClientTasks } from './task-mapper.js';

describe('server task mapping', () => {
	it('maps database task rows to the current client backup shape', () => {
		const tasks = mapTaskRowsToClientTasks(
			[
				{
					id: 'task-db-id',
					boardId: 'board-id',
					parentTaskId: null,
					title: 'Server task',
					status: 'todo',
					priority: 'medium',
					urgency: 'normal',
					category: 'Sync',
					categoryId: null,
					startDate: '2026-05-03',
					endDate: '2026-05-04',
					position: '0',
					version: 1,
					createdBy: 'user-id',
					createdAt: new Date('2026-05-03T00:00:00.000Z'),
					updatedAt: new Date('2026-05-03T00:00:00.000Z'),
					completedAt: null,
					deletedAt: null
				}
			],
			[
				{
					id: 'check-1',
					taskId: 'task-db-id',
					text: 'Mapped checklist',
					done: false,
					position: '0',
					createdAt: new Date('2026-05-03T00:00:00.000Z'),
					updatedAt: new Date('2026-05-03T00:00:00.000Z')
				}
			]
		);

		expect(tasks).toEqual([
			{
				id: 'task-db-id',
				text: 'Server task',
				status: 'todo',
				startDate: '2026-05-03',
				endDate: '2026-05-04',
				priority: 'medium',
				urgency: 'normal',
				category: 'Sync',
				categoryId: null,
				categoryMeta: null,
				parentId: null,
				subtasks: [{ id: 'check-1', text: 'Mapped checklist', done: false }],
				collapsed: false,
				createdAt: new Date('2026-05-03T00:00:00.000Z').getTime(),
				version: 1
			}
		]);
	});
});
