const PLATFORM_TRANSPORT = 'internal';

/**
 * Better Auth 1.6.9 assumes registration responses always include
 * `response.transports`, but some WebAuthn clients omit it.
 *
 * @param {Request} request
 */
export async function normalizePasskeyRegistrationRequest(request) {
	const url = new URL(request.url);
	if (request.method !== 'POST' || !url.pathname.endsWith('/api/auth/passkey/verify-registration')) {
		return request;
	}

	const contentType = request.headers.get('content-type') ?? '';
	if (!contentType.includes('application/json')) {
		return request;
	}

	const text = await request.text();
	if (!text) {
		return createJsonRequest(request, text);
	}

	try {
		const body = normalizePasskeyRegistrationBody(JSON.parse(text));
		return createJsonRequest(request, JSON.stringify(body));
	} catch {
		return createJsonRequest(request, text);
	}
}

/**
 * @param {unknown} body
 */
export function normalizePasskeyRegistrationBody(body) {
	if (!isObject(body) || !isObject(body.response) || !isObject(body.response.response)) {
		return body;
	}

	const transports = body.response.response.transports;
	if (Array.isArray(transports) && transports.length > 0) {
		return body;
	}

	return {
		...body,
		response: {
			...body.response,
			response: {
				...body.response.response,
				transports: [PLATFORM_TRANSPORT]
			}
		}
	};
}

/**
 * @param {Request} request
 * @param {BodyInit | null} body
 */
function createJsonRequest(request, body) {
	const headers = new Headers(request.headers);
	headers.set('content-type', 'application/json');
	headers.delete('content-length');

	return new Request(request.url, {
		method: request.method,
		headers,
		body,
		signal: request.signal
	});
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isObject(value) {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
