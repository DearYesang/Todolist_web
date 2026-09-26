import { describe, expect, it } from 'vitest';
import { planTaskImport } from './import-planner.js';

describe('server task import planning', () => {
	it('remaps legacy ids and preserves valid parent/checklist relationships', () => {
		const ids = [
			'00000000-0000-4000-8000-000000000001',
			'00000000-0000-4000-8000-000000000002',
			'00000000-0000-4000-8000-000000000003'
		];
		const { plans, summary } = planTaskImport(
			[
				{
					id: 'parent',
					text: 'Parent',
					status: 'doing',
					startDate: '2026-05-03',
					endDate: '2026-05-04',
					subtasks: [{ id: 'sub', text: '  Checklist  ', done: true }]
				},
				{
					id: 'child',
					text: 'Child',
					status: 'todo',
					parentId: 'parent',
					startDate: '2026-05-04',
					endDate: '2026-05-05'
				}
			],
			{
				idFactory: () => ids.shift() ?? '00000000-0000-4000-8000-000000000099'
			}
		);

		expect(
			plans.map((plan) => ({
				oldId: plan.oldId,
				id: plan.id,
				parentTaskId: plan.parentTaskId,
				checklistItems: plan.checklistItems
			}))
		).toEqual([
			{
				oldId: 'parent',
				id: '00000000-0000-4000-8000-000000000001',
				parentTaskId: null,
				checklistItems: [
					{
						oldId: 'sub',
						id: '00000000-0000-4000-8000-000000000003',
						text: 'Checklist',
						done: true
					}
				]
			},
			{
				oldId: 'child',
				id: '00000000-0000-4000-8000-000000000002',
				parentTaskId: '00000000-0000-4000-8000-000000000001',
				checklistItems: []
			}
		]);
		expect(summary).toEqual({
			receivedTasks: 2,
			importedTasks: 2,
			skippedTasks: 0,
			importedChecklistItems: 1,
			skippedChecklistItems: 0,
			repairedParentLinks: 0
		});
	});

	it('accepts wrapped legacy backups, remaps numeric ids, and fills missing dates', () => {
		const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
		const { plans, summary } = planTaskImport(
			{
				tasks: [
					{
						id: '1776348148045',
						text: '시험공부',
						status: 'doing',
						priority: 'high',
						urgency: 'urgent',
						category: '공부',
						parentId: null,
						subtasks: [],
						collapsed: false,
						createdAt: 1776348148046
					},
					{
						id: '1776348212462',
						text: '정리',
						status: 'todo',
						parentId: '1776348148045'
					}
				]
			},
			{
				idFactory: () => ids.shift() ?? '33333333-3333-4333-8333-333333333333'
			}
		);

		expect(plans).toHaveLength(2);
		expect(plans[0]).toMatchObject({
			oldId: '1776348148045',
			id: '11111111-1111-4111-8111-111111111111',
			parentTaskId: null
		});
		expect(plans[0].task.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(plans[1]).toMatchObject({
			oldId: '1776348212462',
			id: '22222222-2222-4222-8222-222222222222',
			parentTaskId: '11111111-1111-4111-8111-111111111111'
		});
		expect(summary.receivedTasks).toBe(2);
	});

	it('rejects unsupported imports and skips empty task titles', () => {
		expect(() => planTaskImport({ text: 'Not an array' })).toThrow(
			'Import payload must be an array of tasks or a backup object with a tasks array.'
		);

		const { plans, summary } = planTaskImport(
			[
				{ id: 'empty', text: '' },
				{ id: 'valid', text: 'Valid task', parentId: 'missing' }
			],
			{
				idFactory: () => '99999999-9999-4999-8999-999999999999'
			}
		);

		expect(plans).toHaveLength(1);
		expect(plans[0].oldId).toBe('valid');
		expect(plans[0].parentTaskId).toBeNull();
		expect(summary.skippedTasks).toBe(1);
		expect(summary.repairedParentLinks).toBe(0);
	});
});
