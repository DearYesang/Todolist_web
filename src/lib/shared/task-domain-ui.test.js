import { describe, expect, it } from 'vitest';
import { getDeleteTaskConfirmMessage } from './task-domain.js';

describe('delete confirmation', () => {
	it('asks a plain question for a task without children', () => {
		expect(getDeleteTaskConfirmMessage(0)).toBe('이 작업을 삭제하시겠습니까?');
	});

	it('names the number of child tasks that are deleted with it', () => {
		expect(getDeleteTaskConfirmMessage(1)).toBe('이 작업에는 1개의 하위 작업이 있습니다.\n모두 함께 삭제하시겠습니까?');
		expect(getDeleteTaskConfirmMessage(3)).toBe('이 작업에는 3개의 하위 작업이 있습니다.\n모두 함께 삭제하시겠습니까?');
	});
});
