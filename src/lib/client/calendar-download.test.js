import { describe, expect, it } from 'vitest';
import { createTaskCalendarFilename } from './calendar-download.js';

describe('calendar export', () => {
    it('creates safe filenames for individual task calendar downloads', () => {
        const filename = createTaskCalendarFilename(
            { text: 'Review / ship: celebrate?' },
            new Date('2026-05-03T00:00:00.000Z')
        );

        expect(filename).toBe('todolist_Review_-_ship-_celebrate_2026-05-03.ics');
    });
});
