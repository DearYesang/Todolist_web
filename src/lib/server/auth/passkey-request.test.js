import { describe, expect, it } from 'vitest';
import {
	normalizePasskeyRegistrationBody,
	normalizePasskeyRegistrationRequest
} from './passkey-request.js';

describe('passkey registration request normalization', () => {
	it('adds a platform transport when the browser omits transports', () => {
		const body = /** @type {any} */ (normalizePasskeyRegistrationBody({
			response: {
				id: 'credential-id',
				response: {
					clientDataJSON: 'client-data',
					attestationObject: 'attestation'
				}
			}
		}));

		expect(body.response.response.transports).toEqual(['internal']);
	});

	it('preserves browser-provided transports', () => {
		const body = /** @type {any} */ (normalizePasskeyRegistrationBody({
			response: {
				response: {
					transports: ['hybrid']
				}
			}
		}));

		expect(body.response.response.transports).toEqual(['hybrid']);
	});

	it('normalizes verify-registration JSON requests', async () => {
		const request = new Request('https://todo.example.com/api/auth/passkey/verify-registration', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				cookie: 'better-auth-passkey=token'
			},
			body: JSON.stringify({
				response: {
					response: {
						clientDataJSON: 'client-data'
					}
				}
			})
		});

		const normalized = await normalizePasskeyRegistrationRequest(request);
		const body = await normalized.json();

		expect(normalized.headers.get('cookie')).toBe('better-auth-passkey=token');
		expect(body.response.response.transports).toEqual(['internal']);
	});
});
