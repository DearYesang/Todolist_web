import { describe, expect, it } from 'vitest';
import { parseCategoryName } from './category-service.js';

describe('parseCategoryName', () => {
	it('takes up to 80 characters after trimming and refuses more', () => {
		expect(parseCategoryName(`  ${'c'.repeat(80)}  `)).toBe('c'.repeat(80));
		expect(() => parseCategoryName('c'.repeat(81))).toThrow('Category name must be 80 characters or less.');
		expect(() => parseCategoryName('c'.repeat(81))).toThrow(expect.objectContaining({ status: 400 }));
	});

	it('reads a missing name as empty and refuses a name that is not a string', () => {
		expect(parseCategoryName(undefined)).toBe('');
		expect(parseCategoryName(null)).toBe('');
		expect(() => parseCategoryName(7)).toThrow('Category name must be a string.');
	});
});
