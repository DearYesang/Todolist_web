import { describe, expect, it } from 'vitest';
import {
	getDeleteTaskConfirmMessage,
	PRIORITY_LABELS,
	STATUS_LABELS,
	URGENCY_LABELS
} from './task-domain.js';

describe('delete confirmation', () => {
	it('asks a plain question for a task without children', () => {
		expect(getDeleteTaskConfirmMessage(0)).toBe('이 작업을 삭제하시겠습니까?');
	});

	it('names the number of child tasks that are deleted with it', () => {
		expect(getDeleteTaskConfirmMessage(1)).toBe('이 작업에는 1개의 하위 작업이 있습니다.\n모두 함께 삭제하시겠습니까?');
		expect(getDeleteTaskConfirmMessage(3)).toBe('이 작업에는 3개의 하위 작업이 있습니다.\n모두 함께 삭제하시겠습니까?');
	});
});

describe('display labels', () => {
	// The cards, the task form and the detail panel all render these, in this order.
	it('keeps the status, priority and urgency wording', () => {
		expect(Object.entries(STATUS_LABELS)).toEqual([['todo', '할 일'], ['doing', '진행 중'], ['done', '완료']]);
		expect(Object.entries(PRIORITY_LABELS)).toEqual([['high', '🔴 높음'], ['medium', '🟡 보통'], ['low', '🟢 낮음']]);
		expect(Object.entries(URGENCY_LABELS)).toEqual([['urgent', '🔥 시급'], ['normal', '⏳ 여유']]);
	});
});
