import { describe, expect, it, vi } from 'vitest';
import { deleteUserPasskey, listUserPasskeys, updateUserPasskeyName } from './passkey-management-api.js';

describe('account security helpers', () => {
	it('calls passkey management endpoints', async () => {
		const passkey = {
			id: 'passkey-id',
			name: 'iPad 패스키 - 2026-05-04',
			userId: 'user-id',
			credentialID: 'credential-id',
			deviceType: 'singleDevice',
			backedUp: true,
			transports: 'internal',
			createdAt: '2026-05-04T00:00:00.000Z'
		};
		const listFetcher = vi.fn(
			async () =>
				new Response(JSON.stringify([passkey]), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
		);

		await expect(listUserPasskeys(listFetcher)).resolves.toEqual({
			ok: true,
			passkeys: [passkey]
		});
		expect(listFetcher).toHaveBeenCalledWith(
			'/api/auth/passkey/list-user-passkeys',
			expect.objectContaining({
				headers: { accept: 'application/json' }
			})
		);

		const updateFetcher = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						passkey: { ...passkey, name: 'Mac 패스키 - 2026-05-04' }
					}),
					{
						status: 200,
						headers: { 'content-type': 'application/json' }
					}
				)
		);

		await expect(updateUserPasskeyName('passkey-id', 'Mac 패스키 - 2026-05-04', updateFetcher)).resolves.toEqual({
			ok: true,
			passkey: { ...passkey, name: 'Mac 패스키 - 2026-05-04' }
		});
		expect(updateFetcher).toHaveBeenCalledWith(
			'/api/auth/passkey/update-passkey',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({ id: 'passkey-id', name: 'Mac 패스키 - 2026-05-04' })
			})
		);

		const deleteFetcher = vi.fn(
			async () =>
				new Response(JSON.stringify({ status: true }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
		);

		await expect(deleteUserPasskey('passkey-id', deleteFetcher)).resolves.toEqual({ ok: true });
		expect(deleteFetcher).toHaveBeenCalledWith(
			'/api/auth/passkey/delete-passkey',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({ id: 'passkey-id' })
			})
		);
	});
});
