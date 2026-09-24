import { describe, expect, it, vi } from 'vitest';
import {
    createCalendarToken as createCalendarTokenRequest,
    listCalendarTokens,
    revokeCalendarToken
} from './calendar-token-api.js';

describe('calendar subscription tokens', () => {
    it('calls calendar token management endpoints', async () => {
        const tokenRecord = {
            id: 'token-id',
            name: 'Calendar feed',
            tokenPrefix: 'cal_preview',
            createdAt: '2026-05-03T00:00:00.000Z',
            lastUsedAt: null,
            revokedAt: null,
            expiresAt: null
        };
        const listFetcher = vi.fn(async () => new Response(JSON.stringify({ tokens: [tokenRecord] }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }));

        await expect(listCalendarTokens(listFetcher)).resolves.toEqual({
            ok: true,
            tokens: [tokenRecord]
        });
        expect(listFetcher).toHaveBeenCalledWith('/api/calendar/tokens', expect.objectContaining({
            headers: { accept: 'application/json' }
        }));

        const createFetcher = vi.fn(async () => new Response(JSON.stringify({
            token: 'cal_raw',
            url: '/api/calendar/subscriptions/cal_raw.ics',
            record: tokenRecord
        }), {
            status: 201,
            headers: { 'content-type': 'application/json' }
        }));

        await expect(createCalendarTokenRequest('Calendar feed', createFetcher)).resolves.toEqual({
            ok: true,
            token: 'cal_raw',
            url: '/api/calendar/subscriptions/cal_raw.ics',
            record: tokenRecord
        });
        expect(createFetcher).toHaveBeenCalledWith('/api/calendar/tokens', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ name: 'Calendar feed' })
        }));

        const revokeFetcher = vi.fn(async () => new Response(JSON.stringify({ token: { ...tokenRecord, revokedAt: '2026-05-03T00:00:00.000Z' } }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }));
        await expect(revokeCalendarToken('token-id', revokeFetcher)).resolves.toMatchObject({
            ok: true,
            token: expect.objectContaining({ id: 'token-id' })
        });
        expect(revokeFetcher).toHaveBeenCalledWith('/api/calendar/tokens/token-id', expect.objectContaining({
            method: 'DELETE'
        }));
    });
});
