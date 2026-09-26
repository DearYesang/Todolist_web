import { describe, expect, it } from 'vitest';
import { normalizeTask } from '../shared/task-domain.js';
import {
	canApplyLocalConflict,
	createOfflineConflictReport,
	describeServerSyncResult,
	resolveLocalConflict,
	summarizeOfflineConflict
} from './offline-conflicts.js';

describe('offline conflict summaries', () => {
	it('summarizes stale task patches with task names and field labels', () => {
		const task = normalizeTask({
			id: '11111111-1111-4111-8111-111111111111',
			text: 'Server title'
		});
		const summary = summarizeOfflineConflict(
			{
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
			},
			[task]
		);

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

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const serverTask = normalizeTask({ id: TASK_ID, text: 'Server title' });
const base = { createdAt: Date.parse('2026-05-03T00:00:00.000Z'), attempts: 1 };

/** @type {import('./offline-write-queue.js').OfflineMutation} */
const patchMutation = {
	...base,
	id: 'patch-id',
	type: 'task.patch',
	taskId: TASK_ID,
	patch: { text: 'Local title', priority: 'high', expectedVersion: 3 }
};
/** @type {import('./offline-write-queue.js').OfflineMutation} */
const deleteMutation = { ...base, id: 'delete-id', type: 'task.delete', taskId: TASK_ID, expectedVersion: 3 };
/** @type {import('./offline-write-queue.js').OfflineMutation[]} */
const reportOnlyMutations = [
	{ ...base, id: 'create-id', type: 'task.create', localTaskId: 'local-1', payload: { text: 'New' } },
	{ ...base, id: 'import-id', type: 'import.tasks', mode: 'replace', payload: [] },
	{ ...base, id: 'checklist-create-id', type: 'checklist.create', taskId: TASK_ID, text: 'Item' },
	{
		...base,
		id: 'checklist-patch-id',
		type: 'checklist.patch',
		taskId: TASK_ID,
		itemId: 'item-1',
		patch: { done: true }
	},
	{ ...base, id: 'checklist-delete-id', type: 'checklist.delete', taskId: TASK_ID, itemId: 'item-1' }
];

describe('re-applying an offline change over the server state', () => {
	it('re-applies a task edit without its stale expected version', () => {
		const conflict = summarizeOfflineConflict(patchMutation, [serverTask]);

		expect(canApplyLocalConflict(conflict)).toBe(true);
		expect(resolveLocalConflict(conflict, [serverTask])).toEqual({
			action: 'patch',
			taskId: TASK_ID,
			patch: { text: 'Local title', priority: 'high' },
			dismiss: true,
			notice: '내 변경을 최신 서버 상태 위에 다시 적용했습니다.'
		});
		// The queued mutation itself is left as it was.
		expect(patchMutation.type === 'task.patch' && patchMutation.patch.expectedVersion).toBe(3);
	});

	it('keeps a task-edit conflict listed when the task is gone', () => {
		const conflict = summarizeOfflineConflict(patchMutation, []);

		expect(resolveLocalConflict(conflict, [])).toEqual({
			action: 'none',
			dismiss: false,
			notice: '대상 작업을 찾지 못했습니다. 최신 상태를 확인해 주세요.'
		});
	});

	it('re-applies a delete, or just drops the conflict when the task is already gone', () => {
		const conflict = summarizeOfflineConflict(deleteMutation, [serverTask]);

		expect(canApplyLocalConflict(conflict)).toBe(true);
		expect(resolveLocalConflict(conflict, [serverTask])).toEqual({
			action: 'delete',
			taskId: TASK_ID,
			dismiss: true,
			notice: '삭제 변경을 최신 서버 상태 위에 다시 적용했습니다.'
		});
		expect(resolveLocalConflict(conflict, [])).toEqual({
			action: 'none',
			dismiss: true,
			notice: '대상 작업이 이미 없습니다. 서버 상태를 유지합니다.'
		});
	});

	it('leaves creates, imports and checklist changes to the saved report', () => {
		for (const mutation of reportOnlyMutations) {
			const conflict = summarizeOfflineConflict(mutation, [serverTask]);

			expect(canApplyLocalConflict(conflict)).toBe(false);
			expect(resolveLocalConflict(conflict, [serverTask])).toEqual({
				action: 'none',
				dismiss: false,
				notice: '이 충돌은 자동 적용보다 내역 저장 후 수동 확인이 안전합니다.'
			});
		}
	});
});

describe('the sync banner after a server sync', () => {
	it('lists new conflicts against the synced tasks and clears the notice', () => {
		const update = describeServerSyncResult(
			{ ok: true, tasks: [serverTask], offlineConflicts: [patchMutation, deleteMutation] },
			[serverTask],
			{ showSuccess: true }
		);

		expect(update.notice).toBeNull();
		expect(update.conflicts?.map((conflict) => [conflict.id, conflict.title, conflict.target])).toEqual([
			['patch-id', '작업 수정', 'Server title'],
			['delete-id', '작업 삭제', 'Server title']
		]);
	});

	it('lists conflicts even when the snapshot was skipped', () => {
		const update = describeServerSyncResult(
			{
				ok: false,
				fallback: true,
				status: 0,
				message: 'Offline mutations are still pending, so the server snapshot was skipped.',
				offlineConflicts: [deleteMutation]
			},
			[],
			{ showSuccess: true }
		);

		expect(update).toEqual({ conflicts: [expect.objectContaining({ id: 'delete-id' })], notice: null });
	});

	it('clears conflicts after a clean sync and confirms only a manual refresh', () => {
		const result = { ok: /** @type {const} */ (true), tasks: [], offlineConflicts: [] };

		expect(describeServerSyncResult(result, [])).toEqual({ conflicts: [], notice: null });
		expect(describeServerSyncResult(result, [], { showSuccess: true })).toEqual({
			conflicts: [],
			notice: '최신 작업 목록으로 새로고침했습니다.'
		});
	});

	it('explains a failed manual refresh and keeps the listed conflicts', () => {
		/** @param {boolean} fallback */
		const failed = (fallback) => ({
			ok: /** @type {const} */ (false),
			fallback,
			status: fallback ? 503 : 400,
			message: 'Task API request failed.',
			offlineConflicts: []
		});

		expect(describeServerSyncResult(failed(true), [], { showSuccess: true })).toEqual({
			notice: '지금은 서버에 연결할 수 없어 이 기기의 작업 목록을 유지합니다.'
		});
		expect(describeServerSyncResult(failed(false), [], { showSuccess: true })).toEqual({
			notice: 'Task API request failed.'
		});
		// A background sync that fails changes nothing on the banner.
		expect(describeServerSyncResult(failed(true), [])).toEqual({});
	});
});
