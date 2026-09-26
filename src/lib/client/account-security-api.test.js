import { describe, expect, it, vi } from 'vitest';
import {
	createRecoveryCodes as createRecoveryCodesRequest,
	requestEmailVerificationCode
} from './account-security-api.js';

describe('account security helpers', () => {
	it('calls account verification and recovery endpoints', async () => {
		const verificationFetcher = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						email: 'user@example.com',
						expiresAt: '2026-05-03T00:15:00.000Z',
						previewCode: '123456'
					}),
					{
						status: 201,
						headers: { 'content-type': 'application/json' }
					}
				)
		);

		await expect(
			requestEmailVerificationCode(
				{
					email: 'user@example.com',
					name: 'User'
				},
				verificationFetcher
			)
		).resolves.toEqual({
			ok: true,
			email: 'user@example.com',
			expiresAt: '2026-05-03T00:15:00.000Z',
			previewCode: '123456'
		});
		expect(verificationFetcher).toHaveBeenCalledWith(
			'/api/account/email-verifications',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({ email: 'user@example.com', name: 'User' })
			})
		);

		const recoveryFetcher = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						codes: ['td-AAAA-BBBB-CCCC'],
						summary: {
							total: 10,
							available: 10,
							lastCreatedAt: '2026-05-03T00:00:00.000Z'
						}
					}),
					{
						status: 201,
						headers: { 'content-type': 'application/json' }
					}
				)
		);

		await expect(createRecoveryCodesRequest(recoveryFetcher)).resolves.toEqual({
			ok: true,
			codes: ['td-AAAA-BBBB-CCCC'],
			summary: {
				total: 10,
				available: 10,
				lastCreatedAt: '2026-05-03T00:00:00.000Z'
			}
		});
		expect(recoveryFetcher).toHaveBeenCalledWith(
			'/api/account/recovery-codes',
			expect.objectContaining({
				method: 'POST'
			})
		);
	});
});
