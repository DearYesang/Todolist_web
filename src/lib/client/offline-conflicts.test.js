import { describe, expect, it } from 'vitest';
import { normalizeTask } from '../shared/task-domain.js';
import {
	createOfflineConflictReport,
	summarizeOfflineConflict
} from './offline-conflicts.js';

describe('offline conflict summaries', () => {
	it('summarizes stale task patches with task names and field labels', () => {
		const task = normalizeTask({
			id: '11111111-1111-4111-8111-111111111111',
			text: 'Server title'
		});
		const summary = summarizeOfflineConflict({
			id: 'mutation-id',
			type: 'task.patch',
			taskId: task.id,
			patch: {
				text: 'Local title',
				startDate: '2026-05-04',
				expectedVersion: 1
			},
			createdAt: Date.parse('2026-05-03T00:00:00.000Z'),
			attempts: 1
		}, [task]);

		expect(summary).toMatchObject({
			id: 'mutation-id',
			title: '작업 수정',
			target: 'Server title',
			fields: ['작업명', '시작일'],
			detail: '충돌 필드: 작업명, 시작일'
		});
	});

	it('keeps raw mutation details in downloadable reports', () => {
		const summary = summarizeOfflineConflict({
			id: 'delete-id',
			type: 'task.delete',
			taskId: '22222222-2222-4222-8222-222222222222',
			expectedVersion: 2,
			createdAt: Date.parse('2026-05-03T00:00:00.000Z'),
			attempts: 1
		});
		const report = createOfflineConflictReport([summary]);

		expect(report.conflicts).toHaveLength(1);
		expect(report.conflicts[0]).toMatchObject({
			type: 'task.delete',
			title: '작업 삭제',
			mutation: {
				expectedVersion: 2
			}
		});
	});
});
