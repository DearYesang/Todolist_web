import { describe, expect, it } from 'vitest';
import { createPositionValue } from './task-rows.js';

describe('server task import planning', () => {
    it('creates sortable positions that fit numeric(20,10)', () => {
        const position = createPositionValue(new Date('2026-05-04T00:00:00.000Z'), 12);
        const [integerPart, decimalPart = ''] = position.split('.');

        expect(integerPart.length).toBeLessThanOrEqual(10);
        expect(decimalPart.length).toBeLessThanOrEqual(10);
        expect(Number(position)).toBeGreaterThan(Number(createPositionValue(new Date('2026-05-04T00:00:00.000Z'), 11)));
    });
});
