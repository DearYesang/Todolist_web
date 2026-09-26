import { describe, expect, it, vi } from 'vitest';
import { normalizeTask } from '../../shared/task-domain.js';
import { buildTaskCreateDraft, createLocalTaskFromDraft } from './task-create.js';

describe('client task creation', () => {
    it('builds strict server payloads and keeps server parent ids', () => {
        const parent = normalizeTask({
            id: '11111111-1111-4111-8111-111111111111',
            text: 'Parent',
            status: 'doing'
        });

        expect(buildTaskCreateDraft({
            text: '  Child task  ',
            priority: 'high',
            urgency: 'urgent',
            category: '  개발  ',
            startDate: '2026-05-03',
            endDate: '2026-05-04',
            parent
        })).toEqual({
            payload: {
                text: 'Child task',
                status: 'doing',
                startDate: '2026-05-03',
                endDate: '2026-05-04',
                priority: 'high',
                urgency: 'urgent',
                category: '개발',
                parentId: '11111111-1111-4111-8111-111111111111'
            },
            parent,
            hasLocalParent: false
        });
    });

    it('keeps local parent relationships out of server payloads', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 4, 3, 12));

        const parent = normalizeTask({
            id: 'local-parent',
            text: 'Local parent',
            status: 'todo'
        });
        const draft = buildTaskCreateDraft({
            text: 'Local child',
            priority: 'medium',
            urgency: 'normal',
            category: '',
            startDate: '2026-05-03',
            endDate: '2026-05-05',
            parent
        });

        expect(draft).not.toBeNull();
        if (!draft) throw new Error('Expected a task create draft.');

        expect(draft.hasLocalParent).toBe(true);
        expect(draft.payload.parentId).toBeNull();

        const localTask = createLocalTaskFromDraft(draft.payload, draft.parent);
        expect(localTask.parentId).toBe('local-parent');
        expect(localTask.status).toBe('todo');

        vi.useRealTimers();
    });
});
