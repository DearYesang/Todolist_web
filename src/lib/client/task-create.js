import { createId, normalizeTask } from '../shared/task-domain.js';

const SERVER_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
	const hasLocalParent = Boolean(parent && !isServerTaskId(parent.id));

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

/**
 * @param {unknown} value
 */
export function isServerTaskId(value) {
	return typeof value === 'string' && SERVER_UUID_PATTERN.test(value);
}
