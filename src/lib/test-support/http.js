/**
 * A JSON response like the API routes send.
 * @param {unknown} body
 * @param {{ status?: number }} [init]
 */
export function jsonResponse(body, { status = 200 } = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

/**
 * A response the test hands to a fetch stub now and resolves later, to hold
 * a request in flight.
 */
export function createDeferred() {
	/** @type {(value: Response) => void} */
	let resolve = () => {};
	/** @type {Promise<Response>} */
	const promise = new Promise((res) => {
		resolve = res;
	});
	return { promise, resolve };
}
