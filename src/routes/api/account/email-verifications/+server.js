import { json } from '@sveltejs/kit';
import { authConfigurationError, authDatabaseConfigured } from '$lib/server/auth/index.js';
import {
	AccountSecurityConfigurationError,
	AccountSecurityPolicyError,
	assertAllowedAccountEmail,
	createPasskeyEmailVerification,
	isAccountEmail,
	normalizeAccountEmail
} from '$lib/server/auth/account-security.js';
import {
	assertRateLimit,
	createRateLimitHeaders,
	createRateLimitKey,
	RateLimitError
} from '$lib/server/security/rate-limit.js';

const MAX_BODY_BYTES = 10_000;
const EMAIL_VERIFICATION_TTL_MS = 15 * 60 * 1000;
const GENERIC_AUTH_UNAVAILABLE_MESSAGE = 'Auth service unavailable.';

/** @type {import('./$types').RequestHandler} */
export async function POST(event) {
	const { request } = event;
	if (!authDatabaseConfigured) {
		return json({ message: GENERIC_AUTH_UNAVAILABLE_MESSAGE }, { status: 503 });
	}

	if (authConfigurationError) {
		return json({ message: GENERIC_AUTH_UNAVAILABLE_MESSAGE }, { status: 500 });
	}

	let payload;
	try {
		const contentLength = Number(request.headers.get('content-length') ?? '0');
		if (contentLength > MAX_BODY_BYTES) {
			return json({ message: 'Request body is too large.' }, { status: 413 });
		}

		payload = await request.json();
	} catch {
		return json({ message: 'Request body must be valid JSON.' }, { status: 400 });
	}

	try {
		const email = normalizeAccountEmail(payload?.email);
		await assertRateLimit(createRateLimitKey(event, 'email-verification-ip'), {
			limit: 20,
			windowMs: 15 * 60 * 1000,
			message: 'Too many email verification requests.'
		});
		if (!isAccountEmail(email)) {
			return createGenericAcceptedResponse(email);
		}
		try {
			assertAllowedAccountEmail(email);
		} catch (error) {
			if (error instanceof AccountSecurityPolicyError) {
				return createGenericAcceptedResponse(email);
			}
			throw error;
		}
		await assertRateLimit(createRateLimitKey(event, 'email-verification-send', email), {
			limit: 5,
			windowMs: 15 * 60 * 1000,
			message: 'Too many email verification requests.'
		});
		const result = await createPasskeyEmailVerification({
			email,
			name: payload?.name
		});
		return json(result, {
			status: 201,
			headers: {
				'cache-control': 'private, no-store'
			}
		});
	} catch (error) {
		if (error instanceof RateLimitError) {
			return json({ message: error.message }, {
				status: error.status,
				headers: createRateLimitHeaders(error)
			});
		}

		if (error instanceof AccountSecurityConfigurationError) {
			return json({ message: GENERIC_AUTH_UNAVAILABLE_MESSAGE }, { status: error.status });
		}

		if (error instanceof AccountSecurityPolicyError) {
			return createGenericAcceptedResponse(typeof payload?.email === 'string' ? payload.email : '');
		}

		throw error;
	}
}

/** @param {string} email */
function createGenericAcceptedResponse(email) {
	return json({
		email: normalizeAccountEmail(email),
		expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS).toISOString()
	}, {
		status: 201,
		headers: {
			'cache-control': 'private, no-store'
		}
	});
}
