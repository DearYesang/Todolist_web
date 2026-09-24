import { describe, expect, it } from 'vitest';
import {
	createErrorResult,
	createFallbackResult,
	createHttpErrorResult,
	readErrorMessage,
	readJsonBody
} from './http.js';

describe('readJsonBody', () => {
	it('parses a JSON body', async () => {
		await expect(readJsonBody(new Response('{"tasks":[]}'))).resolves.toEqual({ tasks: [] });
		await expect(readJsonBody(new Response('[1,2]'))).resolves.toEqual([1, 2]);
	});

	it('returns null for an empty or non-JSON body', async () => {
		await expect(readJsonBody(new Response(''))).resolves.toBe(null);
		await expect(readJsonBody(new Response('<html>oops</html>'))).resolves.toBe(null);
		await expect(readJsonBody(new Response(null, { status: 204 }))).resolves.toBe(null);
	});
});

describe('readErrorMessage', () => {
	it('reads a non-blank message string by default', () => {
		expect(readErrorMessage({ message: 'Invalid task.' })).toBe('Invalid task.');
		expect(readErrorMessage({ message: '  padded  ' })).toBe('  padded  ');
	});

	it('ignores blank, non-string and missing messages and other fields', () => {
		expect(readErrorMessage({ message: '   ' })).toBe(null);
		expect(readErrorMessage({ message: '' })).toBe(null);
		expect(readErrorMessage({ message: 42 })).toBe(null);
		expect(readErrorMessage({ error: 'Bad request', code: 'BAD' })).toBe(null);
		expect(readErrorMessage([])).toBe(null);
	});

	it('returns null for non-object bodies', () => {
		expect(readErrorMessage(null)).toBe(null);
		expect(readErrorMessage(undefined)).toBe(null);
		expect(readErrorMessage('Invalid task.')).toBe(null);
		expect(readErrorMessage(0)).toBe(null);
	});

	it('tries the given fields in order and can accept blank strings', () => {
		const betterAuth = { fields: ['message', 'error', 'code'], allowBlank: true };

		expect(readErrorMessage({ message: 'm', error: 'e', code: 'c' }, betterAuth)).toBe('m');
		expect(readErrorMessage({ message: 1, error: 'e', code: 'c' }, betterAuth)).toBe('e');
		expect(readErrorMessage({ code: 'PASSKEY_NOT_FOUND' }, betterAuth)).toBe('PASSKEY_NOT_FOUND');
		expect(readErrorMessage({ message: '', error: 'e' }, betterAuth)).toBe('');
		expect(readErrorMessage({ status: false }, betterAuth)).toBe(null);
		// Without allowBlank a blank field is skipped for the next one.
		expect(readErrorMessage({ message: ' ', error: 'e' }, { fields: ['message', 'error'] })).toBe('e');
	});
});

describe('result builders', () => {
	it('builds a plain error result', () => {
		expect(createErrorResult(429, 'Too many requests.')).toEqual({ ok: false, status: 429, message: 'Too many requests.' });
		expect(createErrorResult(0, 'Offline.')).toEqual({ ok: false, status: 0, message: 'Offline.' });
	});

	it('marks only the given statuses as fallback and prefers the body message', () => {
		const retryable = new Set([401, 503]);

		expect(createHttpErrorResult(new Response(null, { status: 503 }), null, 'Category API request failed', retryable)).toEqual({
			ok: false,
			fallback: true,
			status: 503,
			message: 'Category API request failed with status 503.'
		});
		expect(createHttpErrorResult(new Response(null, { status: 409 }), { message: 'Version conflict.' }, 'Category API request failed', retryable)).toEqual({
			ok: false,
			fallback: false,
			status: 409,
			message: 'Version conflict.'
		});
		expect(createHttpErrorResult(new Response(null, { status: 409 }), { message: ' ' }, 'Task API request failed', new Set([409]))).toEqual({
			ok: false,
			fallback: true,
			status: 409,
			message: 'Task API request failed with status 409.'
		});
	});

	it('builds a status-0 fallback result', () => {
		expect(createFallbackResult('Task API is not available.')).toEqual({
			ok: false,
			fallback: true,
			status: 0,
			message: 'Task API is not available.'
		});
	});
});
