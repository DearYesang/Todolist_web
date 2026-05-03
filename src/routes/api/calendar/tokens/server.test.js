import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAuthUser } from '$lib/server/auth/session.js';
import {
	createCalendarTokenForUser,
	listCalendarTokensForUser
} from '$lib/server/calendar/tokens.js';
import { resetRateLimitBuckets } from '$lib/server/security/rate-limit.js';
import { GET, POST } from './+server.js';

vi.mock('$lib/server/auth/session.js', () => ({
	requireAuthUser: vi.fn()
}));

vi.mock('$lib/server/calendar/tokens.js', async (importOriginal) => ({
	...(await importOriginal()),
	createCalendarTokenForUser: vi.fn(),
	listCalendarTokensForUser: vi.fn()
}));

describe('/api/calendar/tokens route', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		resetRateLimitBuckets();
		vi.mocked(requireAuthUser).mockResolvedValue({
			ok: true,
			user: { id: 'user-id' },
			session: { id: 'session-id' }
		});
	});

	it('lists tokens for the authenticated user with no-store headers', async () => {
		const tokenRecord = createTokenRecord();
		vi.mocked(listCalendarTokensForUser).mockResolvedValue([tokenRecord]);

		const response = await GET(/** @type {any} */ ({
			request: new Request('https://todo.example.com/api/calendar/tokens')
		}));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(body.tokens).toEqual([serializeTokenRecord(tokenRecord)]);
	});

	it('creates tokens and rate limits repeated creation attempts', async () => {
		vi.mocked(createCalendarTokenForUser).mockResolvedValue({
			token: 'cal_token',
			url: '/api/calendar/subscriptions/cal_token.ics',
			record: createTokenRecord()
		});

		for (let index = 0; index < 5; index += 1) {
			const response = await POST(/** @type {any} */ ({
				request: new Request('https://todo.example.com/api/calendar/tokens', {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						'x-forwarded-for': '203.0.113.5'
					},
					body: JSON.stringify({ name: 'Feed' })
				}),
				getClientAddress: () => '203.0.113.5'
			}));
			expect(response.status).toBe(201);
		}

		const blocked = await POST(/** @type {any} */ ({
			request: new Request('https://todo.example.com/api/calendar/tokens', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-forwarded-for': '203.0.113.5'
				},
				body: JSON.stringify({ name: 'Feed' })
			}),
			getClientAddress: () => '203.0.113.5'
		}));

		expect(blocked.status).toBe(429);
		expect(blocked.headers.get('retry-after')).toEqual(expect.any(String));
	});
});

function createTokenRecord() {
	return {
		id: 'token-id',
		name: 'Feed',
		tokenPrefix: 'cal_preview',
		createdAt: new Date('2026-05-04T00:00:00.000Z'),
		lastUsedAt: null,
		revokedAt: null,
		expiresAt: new Date('2026-08-02T00:00:00.000Z')
	};
}

/**
 * @param {ReturnType<typeof createTokenRecord>} record
 */
function serializeTokenRecord(record) {
	return {
		...record,
		createdAt: record.createdAt.toISOString(),
		expiresAt: record.expiresAt.toISOString()
	};
}
