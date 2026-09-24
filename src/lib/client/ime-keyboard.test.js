import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createImeCompositionGuard, shouldIgnoreImeSubmit } from './ime-keyboard.js';

describe('IME keyboard helpers', () => {
	it('ignores keydown events that are still composing', () => {
		expect(shouldIgnoreImeSubmit({ isComposing: true })).toBe(true);
		expect(shouldIgnoreImeSubmit({ isComposing: false }, { isComposing: true })).toBe(true);
	});

	it('ignores the Safari/Chrome IME sentinel key code', () => {
		expect(shouldIgnoreImeSubmit({ isComposing: false, keyCode: 229 })).toBe(true);
		expect(shouldIgnoreImeSubmit({ isComposing: false, which: 229 })).toBe(true);
	});

	it('ignores the immediate keydown after composition just ended', () => {
		expect(shouldIgnoreImeSubmit({ isComposing: false }, { justEnded: true })).toBe(true);
	});

	it('allows normal Enter submits', () => {
		expect(shouldIgnoreImeSubmit({ isComposing: false, keyCode: 13 })).toBe(false);
	});
});

describe('createImeCompositionGuard', () => {
	const enter = { isComposing: false, keyCode: 13 };

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('allows Enter when nothing is being composed', () => {
		const guard = createImeCompositionGuard();

		expect(guard.shouldIgnoreEnter(enter)).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('ignores Enter while composing', () => {
		const guard = createImeCompositionGuard();
		guard.start();

		expect(guard.shouldIgnoreEnter(enter)).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('keeps ignoring Enter until the next macrotask after the composition ends', () => {
		const guard = createImeCompositionGuard();
		guard.start();
		guard.end();

		// The confirming Enter's keydown, dispatched right after compositionend.
		expect(guard.shouldIgnoreEnter(enter)).toBe(true);
		expect(vi.getTimerCount()).toBe(1);

		vi.advanceTimersByTime(0);
		expect(guard.shouldIgnoreEnter(enter)).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('cancels the pending reset when a new composition starts', () => {
		const guard = createImeCompositionGuard();
		guard.start();
		guard.end();
		guard.start();

		expect(vi.getTimerCount()).toBe(0);
		vi.runAllTimers();
		expect(guard.shouldIgnoreEnter(enter)).toBe(true);
	});

	it('keeps a single pending reset across repeated composition ends', () => {
		const guard = createImeCompositionGuard();
		guard.end();
		guard.end();

		expect(vi.getTimerCount()).toBe(1);
		vi.runAllTimers();
		expect(guard.shouldIgnoreEnter(enter)).toBe(false);
	});

	it('reset() forgets the composition and clears the pending timer', () => {
		const guard = createImeCompositionGuard();
		guard.start();
		guard.reset();
		expect(guard.shouldIgnoreEnter(enter)).toBe(false);

		guard.end();
		expect(vi.getTimerCount()).toBe(1);
		guard.reset();
		expect(vi.getTimerCount()).toBe(0);
		expect(guard.shouldIgnoreEnter(enter)).toBe(false);
	});

	it('still honours the event-level IME signals', () => {
		const guard = createImeCompositionGuard();

		expect(guard.shouldIgnoreEnter({ isComposing: true })).toBe(true);
		expect(guard.shouldIgnoreEnter({ isComposing: false, keyCode: 229 })).toBe(true);
		expect(guard.shouldIgnoreEnter({ isComposing: false, which: 229 })).toBe(true);
	});

	it('keeps each input separate', () => {
		const taskTitle = createImeCompositionGuard();
		const checklist = createImeCompositionGuard();
		taskTitle.start();

		expect(taskTitle.shouldIgnoreEnter(enter)).toBe(true);
		expect(checklist.shouldIgnoreEnter(enter)).toBe(false);
	});
});
