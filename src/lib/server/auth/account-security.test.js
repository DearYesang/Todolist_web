import { describe, expect, it } from 'vitest';
import {
	assertValidPasskeyEmailCode,
	assertValidRecoveryCodeForEmail,
	parsePasskeyRegistrationContext
} from './account-security.js';

describe('account security passkey errors', () => {
	it('returns a client-safe error for malformed registration context', () => {
		let error;
		try {
			parsePasskeyRegistrationContext('{');
		} catch (caught) {
			error = caught;
		}

		expect(error).toMatchObject({
			name: 'APIError',
			statusCode: 400,
			body: {
				code: 'INVALID_PASSKEY_REGISTRATION_CONTEXT'
			}
		});
	});

	it('returns a client-safe error for missing email verification codes', async () => {
		await expect(assertValidPasskeyEmailCode('scyea@naver.com', '')).rejects.toMatchObject({
			name: 'APIError',
			statusCode: 400,
			body: {
				code: 'INVALID_PASSKEY_EMAIL_CODE'
			}
		});
	});

	it('returns a client-safe error for missing recovery codes', async () => {
		await expect(assertValidRecoveryCodeForEmail('scyea@naver.com', '')).rejects.toMatchObject({
			name: 'APIError',
			statusCode: 400,
			body: {
				code: 'INVALID_PASSKEY_RECOVERY_CODE'
			}
		});
	});
});
