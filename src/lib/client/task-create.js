import { createId, normalizeTask } from '../shared/task-domain.js';
import { isServerId } from '../shared/task-rules.js';

/**
 * @typedef {{
 *   text: string;
 *   priority: import('../shared/task-domain.js').TaskPriority;
 *   urgency: import('../shared/task-domain.js').TaskUrgency;
 *   category: string;
 *   startDate: string;
 *   endDate: string;
 *   parent: import('../shared/task-domain.js').Task | null;
 * }} BuildTaskCreatePayloadInput
 *
 * @typedef {{
 *   payload: {
 *     text: string;
 *     status: import('../shared/task-domain.js').TaskStatus;
 *     startDate: string;
 *     endDate: string;
 *     priority: import('../shared/task-domain.js').TaskPriority;
 *     urgency: import('../shared/task-domain.js').TaskUrgency;
 *     category: string;
 *     parentId: string | null;
 *   };
 *   parent: import('../shared/task-domain.js').Task | null;
 *   hasLocalParent: boolean;
 * }} TaskCreateDraft
 */

/**
 * @param {BuildTaskCreatePayloadInput} input
 * @returns {TaskCreateDraft | null}
 */
export function buildTaskCreateDraft(input) {
	const text = input.text.trim();
	if (!text) {
		return null;
	}

	const parent = input.parent;
	const hasLocalParent = Boolean(parent && !isServerId(parent.id));

	return {
		payload: {
			text,
			status: parent?.status ?? 'todo',
			startDate: input.startDate,
			endDate: input.endDate,
			priority: input.priority,
			urgency: input.urgency,
			category: input.category.trim(),
			parentId: parent && !hasLocalParent ? parent.id : null
		},
		parent,
		hasLocalParent
	};
}

/**
 * @param {TaskCreateDraft['payload']} payload
 * @param {import('../shared/task-domain.js').Task | null} parent
 */
export function createLocalTaskFromDraft(payload, parent) {
	return normalizeTask({
		id: createId(),
		text: payload.text,
		status: parent?.status ?? payload.status,
		startDate: payload.startDate,
		endDate: payload.endDate,
		priority: payload.priority,
		urgency: payload.urgency,
		category: payload.category,
		parentId: parent?.id ?? null,
		subtasks: [],
		collapsed: false,
		createdAt: Date.now()
	});
}
