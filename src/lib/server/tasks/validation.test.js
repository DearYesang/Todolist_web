import { describe, expect, it } from 'vitest';
import {
    assertValidTaskDateRange,
    parseCreateTaskInput,
    parseCreateChecklistItemInput,
    parseDeleteTaskInput,
    parseUpdateChecklistItemInput,
    parseTaskIdParam,
    parseUpdateTaskInput,
    TaskWriteError
} from './validation.js';

describe('server task validation', () => {
    it('accepts a strict create payload with safe defaults', () => {
        expect(parseCreateTaskInput({
            text: '  Server task  ',
            startDate: '2026-05-03',
            endDate: '2026-05-04',
            category: '  Sync  '
        })).toEqual({
            title: 'Server task',
            status: 'todo',
            priority: 'medium',
            urgency: 'normal',
            category: 'Sync',
            categoryId: null,
            startDate: '2026-05-03',
            endDate: '2026-05-04',
            parentId: null
        });
    });

    it('rejects invalid create payloads instead of silently repairing them', () => {
        expect(() => parseCreateTaskInput({
            text: '',
            startDate: '2026-05-03',
            endDate: '2026-05-04'
        })).toThrow(TaskWriteError);

        expect(() => parseCreateTaskInput({
            text: 'Bad status',
            status: 'blocked',
            startDate: '2026-05-03',
            endDate: '2026-05-04'
        })).toThrow('Invalid status.');

        expect(() => parseCreateTaskInput({
            text: 'Bad date',
            startDate: '2026-05-04',
            endDate: '2026-05-03'
        })).toThrow('Invalid task date range.');

        expect(() => parseCreateTaskInput({
            text: 'Bad parent',
            startDate: '2026-05-03',
            endDate: '2026-05-04',
            parentId: 'local-timestamp-id'
        })).toThrow('parentId must be a UUID.');
    });

    it('accepts strict update payloads and task ids', () => {
        expect(parseTaskIdParam('55555555-5555-4555-8555-555555555555')).toBe('55555555-5555-4555-8555-555555555555');
        expect(parseUpdateTaskInput({
            text: '  Updated task  ',
            status: 'doing',
            priority: 'high',
            urgency: 'urgent',
            category: '  Sync  ',
            startDate: '2026-05-03',
            endDate: '2026-05-04',
	            parentId: null
	        })).toEqual({
	            title: 'Updated task',
	            status: 'doing',
            priority: 'high',
            urgency: 'urgent',
            category: 'Sync',
            startDate: '2026-05-03',
            endDate: '2026-05-04',
	            parentId: null
	        });
	        expect(parseUpdateTaskInput({
	            text: 'Versioned update',
	            expectedVersion: 3
	        })).toEqual({
	            title: 'Versioned update',
	            expectedVersion: 3
	        });
	        expect(parseDeleteTaskInput({ expectedVersion: 4 })).toEqual({ expectedVersion: 4 });
	        expect(parseDeleteTaskInput(undefined)).toEqual({ expectedVersion: null });
	    });

    it('reads categoryByName as how to take a null categoryId, not as a task field', () => {
        expect(parseUpdateTaskInput({ category: '기획', categoryId: null, categoryByName: true })).toEqual({
            category: '기획',
            categoryId: null,
            categoryByName: true
        });
        expect(parseUpdateTaskInput({ category: '기획', categoryId: null, categoryByName: false })).toEqual({
            category: '기획',
            categoryId: null
        });
        expect(() => parseUpdateTaskInput({ categoryByName: true })).toThrow('At least one task field is required.');
        expect(() => parseUpdateTaskInput({ category: '기획', categoryByName: 'yes' })).toThrow('categoryByName must be a boolean.');
    });

    it('rejects invalid update payloads and date ranges', () => {
        expect(() => parseTaskIdParam('local-id')).toThrow('taskId must be a UUID.');
	        expect(() => parseUpdateTaskInput({})).toThrow('At least one task field is required.');
	        expect(() => parseUpdateTaskInput({ status: 'blocked' })).toThrow('Invalid status.');
	        expect(() => parseUpdateTaskInput({ parentId: 'local-parent' })).toThrow('parentId must be a UUID.');
	        expect(() => parseUpdateTaskInput({ text: 'Bad version', expectedVersion: 0 })).toThrow('expectedVersion must be a positive integer.');
	        expect(() => parseDeleteTaskInput({ expectedVersion: 0 })).toThrow('expectedVersion must be a positive integer.');
	        expect(() => assertValidTaskDateRange('2026-05-04', '2026-05-03')).toThrow('Invalid task date range.');
	    });

    it('validates checklist create and update payloads', () => {
        expect(parseCreateChecklistItemInput({ text: '  Read docs  ' })).toEqual({ text: 'Read docs' });
        expect(parseUpdateChecklistItemInput({ text: '  Review  ', done: true })).toEqual({
            text: 'Review',
            done: true
        });

        expect(() => parseCreateChecklistItemInput({ text: '' })).toThrow('Checklist text is required.');
        expect(() => parseUpdateChecklistItemInput({})).toThrow('At least one checklist field is required.');
        expect(() => parseUpdateChecklistItemInput({ done: 'yes' })).toThrow('done must be a boolean.');
    });

    it('caps titles, categories and checklist texts at the shared limits', () => {
        const dates = { startDate: '2026-05-03', endDate: '2026-05-04' };

        expect(parseCreateTaskInput({ text: 't'.repeat(300), category: 'c'.repeat(80), ...dates })).toMatchObject({
            title: 't'.repeat(300),
            category: 'c'.repeat(80)
        });
        expect(() => parseCreateTaskInput({ text: 't'.repeat(301), ...dates })).toThrow('Task title must be 300 characters or less.');
        expect(() => parseUpdateTaskInput({ category: 'c'.repeat(81) })).toThrow('category must be 80 characters or less.');
        expect(parseCreateChecklistItemInput({ text: 'x'.repeat(500) })).toEqual({ text: 'x'.repeat(500) });
        expect(() => parseUpdateChecklistItemInput({ text: 'x'.repeat(501) })).toThrow('Checklist text must be 500 characters or less.');
    });
});
