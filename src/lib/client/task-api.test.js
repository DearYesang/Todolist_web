import { describe, expect, it, vi } from 'vitest';
import { normalizeTask } from '../shared/task-domain.js';
import {
	createServerChecklistItem,
	createServerTask,
	deleteServerChecklistItem,
	deleteServerTask,
	exportServerTasks,
	importServerTasks,
	listServerTasks,
	updateServerChecklistItem,
	updateServerTask
} from './task-api.js';

describe('client task creation', () => {
	it('classifies task API responses for server create and fallback', async () => {
		const serverTask = normalizeTask({
			id: '22222222-2222-4222-8222-222222222222',
			text: 'Server task'
		});
		const fetcher = vi.fn(
			async () =>
				new Response(JSON.stringify({ task: serverTask }), {
					status: 201,
					headers: { 'content-type': 'application/json' }
				})
		);

		await expect(createServerTask({ text: 'Server task' }, fetcher)).resolves.toEqual({
			ok: true,
			task: serverTask
		});
		expect(fetcher).toHaveBeenCalledWith(
			'/api/tasks',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({ text: 'Server task' })
			})
		);

		await expect(
			createServerTask(
				{},
				async () =>
					new Response(JSON.stringify({ message: 'Auth required.' }), {
						status: 401,
						headers: { 'content-type': 'application/json' }
					})
			)
		).resolves.toMatchObject({
			ok: false,
			fallback: true,
			status: 401
		});

		await expect(
			createServerTask(
				{},
				async () =>
					new Response(JSON.stringify({ message: 'Invalid task.' }), {
						status: 400,
						headers: { 'content-type': 'application/json' }
					})
			)
		).resolves.toMatchObject({
			ok: false,
			fallback: false,
			status: 400,
			message: 'Invalid task.'
		});
	});

	it('loads and normalizes server task lists', async () => {
		const fetcher = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						tasks: [
							{
								id: '33333333-3333-4333-8333-333333333333',
								text: '  Server list task  ',
								status: 'done',
								startDate: '2026-05-03',
								endDate: '2026-05-03'
							}
						]
					}),
					{
						status: 200,
						headers: { 'content-type': 'application/json' }
					}
				)
		);

		const result = await listServerTasks(fetcher);
		expect(result).toMatchObject({ ok: true });
		if (!result.ok) throw new Error('Expected server task list result.');
		expect(result.tasks).toEqual([
			expect.objectContaining({
				id: '33333333-3333-4333-8333-333333333333',
				text: '  Server list task  ',
				status: 'done'
			})
		]);
		expect(fetcher).toHaveBeenCalledWith(
			'/api/tasks',
			expect.objectContaining({
				headers: { accept: 'application/json' }
			})
		);
	});

	it('calls task mutation endpoints', async () => {
		const serverTask = normalizeTask({
			id: '44444444-4444-4444-8444-444444444444',
			text: 'Updated server task'
		});
		const updateFetcher = vi.fn(
			async () =>
				new Response(JSON.stringify({ task: serverTask }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
		);

		await expect(
			updateServerTask(
				'44444444-4444-4444-8444-444444444444',
				{
					text: 'Updated server task'
				},
				updateFetcher
			)
		).resolves.toEqual({
			ok: true,
			task: serverTask
		});
		expect(updateFetcher).toHaveBeenCalledWith(
			'/api/tasks/44444444-4444-4444-8444-444444444444',
			expect.objectContaining({
				method: 'PATCH',
				body: JSON.stringify({ text: 'Updated server task' })
			})
		);

		const deleteFetcher = vi.fn(
			async () =>
				new Response(JSON.stringify({ deleted: 3 }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
		);
		await expect(deleteServerTask('44444444-4444-4444-8444-444444444444', deleteFetcher)).resolves.toEqual({
			ok: true,
			deleted: 3
		});
		expect(deleteFetcher).toHaveBeenCalledWith(
			'/api/tasks/44444444-4444-4444-8444-444444444444',
			expect.objectContaining({ method: 'DELETE' })
		);

		const versionedDeleteFetcher = vi.fn(
			async () =>
				new Response(JSON.stringify({ deleted: 1 }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
		);
		await expect(
			deleteServerTask(
				'55555555-5555-4555-8555-555555555555',
				{
					expectedVersion: 7
				},
				versionedDeleteFetcher
			)
		).resolves.toEqual({
			ok: true,
			deleted: 1
		});
		expect(versionedDeleteFetcher).toHaveBeenCalledWith(
			'/api/tasks/55555555-5555-4555-8555-555555555555',
			expect.objectContaining({
				method: 'DELETE',
				body: JSON.stringify({ expectedVersion: 7 })
			})
		);
	});

	it('calls checklist mutation endpoints', async () => {
		const serverTask = normalizeTask({
			id: '66666666-6666-4666-8666-666666666666',
			text: 'Task with checklist',
			subtasks: [{ id: '77777777-7777-4777-8777-777777777777', text: 'Check item', done: false }]
		});
		const fetcher = vi.fn(
			async () =>
				new Response(JSON.stringify({ task: serverTask }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
		);

		await expect(createServerChecklistItem(serverTask.id, 'Check item', fetcher)).resolves.toEqual({
			ok: true,
			task: serverTask
		});
		expect(fetcher).toHaveBeenLastCalledWith(
			`/api/tasks/${serverTask.id}/checklist`,
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({ text: 'Check item' })
			})
		);

		await expect(
			updateServerChecklistItem(
				serverTask.id,
				'77777777-7777-4777-8777-777777777777',
				{
					done: true
				},
				fetcher
			)
		).resolves.toEqual({
			ok: true,
			task: serverTask
		});
		expect(fetcher).toHaveBeenLastCalledWith(
			`/api/tasks/${serverTask.id}/checklist/77777777-7777-4777-8777-777777777777`,
			expect.objectContaining({
				method: 'PATCH',
				body: JSON.stringify({ done: true })
			})
		);

		await expect(
			deleteServerChecklistItem(serverTask.id, '77777777-7777-4777-8777-777777777777', fetcher)
		).resolves.toEqual({
			ok: true,
			task: serverTask
		});
		expect(fetcher).toHaveBeenLastCalledWith(
			`/api/tasks/${serverTask.id}/checklist/77777777-7777-4777-8777-777777777777`,
			expect.objectContaining({ method: 'DELETE' })
		);
	});

	it('calls server import and export endpoints', async () => {
		const serverTask = normalizeTask({
			id: '88888888-8888-4888-8888-888888888888',
			text: 'Imported task'
		});
		const exportFetcher = vi.fn(
			async () =>
				new Response(JSON.stringify([serverTask]), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
		);

		await expect(exportServerTasks(exportFetcher)).resolves.toEqual({
			ok: true,
			tasks: [serverTask]
		});
		expect(exportFetcher).toHaveBeenCalledWith(
			'/api/export',
			expect.objectContaining({
				headers: { accept: 'application/json' }
			})
		);

		const summary = {
			receivedTasks: 1,
			importedTasks: 1,
			skippedTasks: 0,
			importedChecklistItems: 0,
			skippedChecklistItems: 0,
			repairedParentLinks: 0
		};
		const importFetcher = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						tasks: [serverTask],
						summary
					}),
					{
						status: 201,
						headers: { 'content-type': 'application/json' }
					}
				)
		);
		const payload = [{ id: 'legacy-task', text: 'Imported task' }];

		await expect(importServerTasks(payload, importFetcher)).resolves.toEqual({
			ok: true,
			tasks: [serverTask],
			summary
		});
		expect(importFetcher).toHaveBeenCalledWith(
			'/api/import',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify(payload)
			})
		);

		const wrappedPayload = { version: 1, tasks: payload };
		const wrappedFetcher = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						tasks: [serverTask],
						summary
					}),
					{
						status: 201,
						headers: { 'content-type': 'application/json' }
					}
				)
		);
		await expect(importServerTasks(wrappedPayload, wrappedFetcher)).resolves.toMatchObject({
			ok: true,
			tasks: [serverTask]
		});
		expect(wrappedFetcher).toHaveBeenCalledWith(
			'/api/import',
			expect.objectContaining({
				body: JSON.stringify(payload)
			})
		);

		const replaceFetcher = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						tasks: [serverTask],
						summary: { ...summary, replacedTasks: 3 }
					}),
					{
						status: 201,
						headers: { 'content-type': 'application/json' }
					}
				)
		);

		await expect(importServerTasks(payload, { mode: 'replace' }, replaceFetcher)).resolves.toEqual({
			ok: true,
			tasks: [serverTask],
			summary: { ...summary, replacedTasks: 3 }
		});
		expect(replaceFetcher).toHaveBeenCalledWith(
			'/api/import?mode=replace',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify(payload)
			})
		);
	});
});
