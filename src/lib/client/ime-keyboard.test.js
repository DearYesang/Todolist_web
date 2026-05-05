import { describe, expect, it } from 'vitest';
import { shouldIgnoreImeSubmit } from './ime-keyboard.js';

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
