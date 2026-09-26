import { describe, expect, it, vi } from 'vitest';
import { normalizeTask } from '../../shared/task-domain.js';
import { upsertProviderCalendarEvent } from './providers.js';

describe('calendar provider sync helpers', () => {
	it('keeps provider events as full inclusive all-day task ranges', async () => {
		const task = normalizeTask({
			text: 'Range task',
			startDate: '2026-05-03',
			endDate: '2026-05-05'
		});
		let requestBody = '';
		const fetcher = vi.fn(async (_url, init) => {
			requestBody = typeof init?.body === 'string' ? init.body : '';
			return new Response(
				JSON.stringify({
					id: 'provider-event-id',
					etag: 'provider-etag'
				}),
				{
					status: 200,
					headers: { 'content-type': 'application/json' }
				}
			);
		});
		vi.stubGlobal('fetch', fetcher);

		await expect(upsertProviderCalendarEvent('google', 'access-token', null, task)).resolves.toEqual({
			id: 'provider-event-id',
			etag: 'provider-etag'
		});
		const body = JSON.parse(requestBody);
		expect(body).toMatchObject({
			start: { date: '2026-05-03' },
			end: { date: '2026-05-06' }
		});
	});
});
