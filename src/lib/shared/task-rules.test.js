import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	APP_VIEWS,
	isAppView,
	isServerId,
	TASK_PRIORITIES,
	TASK_STATUSES,
	TASK_URGENCIES
} from './task-rules.js';

// The schema is read as text: importing it would load drizzle-orm's
// Postgres column builders into a shared test.
const SCHEMA_SOURCE = readFileSync(new URL('../server/db/schema.js', import.meta.url), 'utf8');

/**
 * The values a `check('<name>', sql`${table.column} in (...)`)` constraint
 * in schema.js allows, in order.
 * @param {string} name
 */
function readCheckValues(name) {
	const match = SCHEMA_SOURCE.match(new RegExp(`check\\('${name}', sql\`\\$\\{table\\.\\w+\\} in \\(([^)]*)\\)\`\\)`));
	if (!match) {
		throw new Error(`No "${name}" IN-list CHECK constraint in schema.js.`);
	}
	return match[1].split(',').map((value) => value.trim().replace(/^'(.*)'$/, '$1'));
}

describe('task rules', () => {
	it.each([
		{ constraint: 'tasks_status_check', values: TASK_STATUSES },
		{ constraint: 'tasks_priority_check', values: TASK_PRIORITIES },
		{ constraint: 'tasks_urgency_check', values: TASK_URGENCIES },
		{ constraint: 'boards_default_view_check', values: APP_VIEWS }
	])('allows the values of the database constraint $constraint', ({ constraint, values }) => {
		expect(readCheckValues(constraint)).toEqual([...values]);
	});

	it('tells ids the server issued from ids made on this device', () => {
		expect(isServerId('11111111-1111-4111-8111-111111111111')).toBe(true);
		expect(isServerId('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA')).toBe(true);
		expect(isServerId('1790424370489ab1cd')).toBe(false);
		expect(isServerId('11111111-1111-4111-8111-11111111111')).toBe(false);
		expect(isServerId(null)).toBe(false);
	});

	it('accepts only the three board views', () => {
		expect(APP_VIEWS.filter(isAppView)).toEqual(['kanban', 'gantt', 'matrix']);
		expect(isAppView('list')).toBe(false);
		expect(isAppView(undefined)).toBe(false);
	});
});
