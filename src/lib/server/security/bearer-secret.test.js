import { describe, expect, it } from 'vitest';
import { readBearerToken, secretsMatch } from './bearer-secret.js';

const SECRET = 'cron-secret-with-enough-length';

describe('readBearerToken', () => {
	it('reads the token of a Bearer Authorization header, in any case, trimmed', () => {
		/** @param {Record<string, string>} headers */
		const read = (headers) => readBearerToken(new Request('https://todo.example.com/api/health', { headers }));

		expect(read({ authorization: `Bearer ${SECRET}` })).toBe(SECRET);
		expect(read({ authorization: `bearer   ${SECRET}  ` })).toBe(SECRET);
		expect(read({ authorization: SECRET })).toBe(SECRET);
		expect(read({})).toBeUndefined();
	});
});

describe('secretsMatch', () => {
	it('matches only the same secret', () => {
		expect(secretsMatch(SECRET, SECRET)).toBe(true);
		expect(secretsMatch('cron-secret-with-enough-lengtH', SECRET)).toBe(false);
		expect(secretsMatch('cron-secret', SECRET)).toBe(false);
		expect(secretsMatch(`${SECRET}!`, SECRET)).toBe(false);
	});

	it('does not match a missing or empty candidate', () => {
		expect(secretsMatch(undefined, SECRET)).toBe(false);
		expect(secretsMatch('', SECRET)).toBe(false);
	});
});
