import { describe, expect, it, vi } from 'vitest';
import {
	listCalendarProviders as listCalendarProvidersRequest,
	syncCalendarProviders as syncCalendarProvidersRequest
} from './calendar-provider-api.js';

describe('calendar provider sync helpers', () => {
	it('calls calendar provider list and sync endpoints', async () => {
		const providerBody = {
			providers: [{ id: 'google', name: 'Google Calendar', configured: true }],
			connections: [
				{
					id: 'connection-id',
					provider: 'google',
					providerAccountId: 'account-id',
					createdAt: '2026-05-03T00:00:00.000Z',
					updatedAt: '2026-05-03T00:00:00.000Z',
					expiresAt: null
				}
			]
		};
		const listFetcher = vi.fn(
			async () =>
				new Response(JSON.stringify(providerBody), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
		);

		await expect(listCalendarProvidersRequest(listFetcher)).resolves.toEqual({
			ok: true,
			...providerBody,
			syncRuns: []
		});
		expect(listFetcher).toHaveBeenCalledWith(
			'/api/calendar/providers',
			expect.objectContaining({
				headers: { accept: 'application/json' }
			})
		);

		const syncBody = {
			connections: 1,
			tasks: 2,
			summaries: [{ connectionId: 'connection-id', provider: 'google', upserted: 2, deleted: 0, failed: 0 }]
		};
		const syncFetcher = vi.fn(
			async () =>
				new Response(JSON.stringify(syncBody), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
		);

		await expect(syncCalendarProvidersRequest(syncFetcher)).resolves.toEqual({
			ok: true,
			...syncBody
		});
		expect(syncFetcher).toHaveBeenCalledWith(
			'/api/calendar/sync',
			expect.objectContaining({
				method: 'POST'
			})
		);
	});
});
