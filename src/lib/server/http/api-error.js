import { json } from '@sveltejs/kit';

const INVALID_JSON_MESSAGE = 'Request body must be valid JSON.';

/**
 * An error the API answers with its own status and message, as
 * `{ message }`. The server's domain errors (TaskWriteError, RateLimitError,
 * the calendar and account security errors) extend it and keep their names,
 * so code that tells them apart still can.
 */
export class ApiError extends Error {
	/**
	 * @param {string} message sent to the client as is
	 * @param {number} [status]
	 * @param {Record<string, string>} [headers] sent with the answer, like Retry-After on a 429
	 */
	constructor(message, status = 400, headers = undefined) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.headers = headers;
		/**
		 * Whether a route that names no classes answers this error. The
		 * configuration errors set it to false, because their messages name
		 * environment variables: only a route that names their class
		 * describes them to the client.
		 */
		this.answeredByDefault = true;
	}
}

/**
 * The answer to an error a route caught. An ApiError becomes `{ message }`
 * with its status and headers; anything else is thrown again, so SvelteKit
 * logs it and answers 500. A configuration error (answeredByDefault false)
 * is thrown again too unless the route names its class, so a route whose
 * data code comes to call calendar or account code still does not describe
 * the server's configuration to the client.
 *
 * A route that answers only some ApiErrors names their classes, and the
 * others are thrown again too. The account and calendar routes do this so
 * they answer exactly the errors they answered before: a missing recovery
 * secret, for one, stays a logged 500 instead of being described to the
 * client, while the calendar token routes name
 * CalendarTokenConfigurationError and answer it with its 503.
 *
 * @param {unknown} error
 * @param {...(new (...args: any[]) => ApiError)} types the ApiError classes to answer; when none is named, every ApiError but the configuration errors
 * @returns {Response}
 */
export function apiErrorResponse(error, ...types) {
	if (!(error instanceof ApiError)) {
		throw error;
	}
	const answered = types.length > 0 ? types.some((type) => error instanceof type) : error.answeredByDefault;
	if (!answered) {
		throw error;
	}

	return json({ message: error.message }, { status: error.status, headers: error.headers });
}

/**
 * A request's JSON body. A body that is not JSON, or cannot be read, is a
 * 400 ApiError unless `lenient` is set.
 *
 * @param {Request} request
 * @param {{
 *   optional?: boolean;
 *   lenient?: boolean;
 *   maxLength?: number;
 *   tooLargeMessage?: string;
 * }} [options]
 *   - optional: an empty or blank body is no payload (undefined).
 *   - lenient: a body that is not JSON, or none, is `{}`.
 *   - maxLength: a longer body is a 413 ApiError with `tooLargeMessage`.
 *     It is checked twice: on the declared content-length, in bytes,
 *     before reading, and on the text's `length`, in UTF-16 code units,
 *     after. The second check is not a byte limit: a body sent without a
 *     content-length whose text has multi-byte characters passes it with
 *     more bytes than maxLength. The import route has always counted its
 *     limit this way, and its limits stay as they are.
 * @returns {Promise<unknown>}
 */
export async function readJsonBody(request, options = {}) {
	const { optional = false, lenient = false, maxLength, tooLargeMessage = 'Request body is too large.' } = options;
	if (maxLength !== undefined && Number(request.headers.get('content-length') ?? '0') > maxLength) {
		throw new ApiError(tooLargeMessage, 413);
	}

	let text;
	try {
		text = await request.text();
	} catch {
		return invalidBody(lenient);
	}

	if (maxLength !== undefined && text.length > maxLength) {
		throw new ApiError(tooLargeMessage, 413);
	}
	if (optional && !text.trim()) {
		return undefined;
	}

	try {
		return JSON.parse(text);
	} catch {
		return invalidBody(lenient);
	}
}

/**
 * @param {boolean} lenient
 */
function invalidBody(lenient) {
	if (lenient) {
		return {};
	}
	throw new ApiError(INVALID_JSON_MESSAGE, 400);
}
