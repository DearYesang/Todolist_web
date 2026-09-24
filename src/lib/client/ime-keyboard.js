/**
 * IME composition keys can reuse Enter to confirm the current Korean/Japanese/Chinese
 * composition. Treating that same keydown as submit can duplicate the final syllable.
 *
 * @param {Pick<KeyboardEvent, 'isComposing'> & { keyCode?: number; which?: number }} event
 * @param {{ isComposing?: boolean; justEnded?: boolean }} [composition]
 */
export function shouldIgnoreImeSubmit(event, composition = {}) {
	return Boolean(
		composition.isComposing
		|| composition.justEnded
		|| event.isComposing
		|| event.keyCode === 229
		|| event.which === 229
	);
}

/**
 * Composition state for one text input, so the Enter that confirms a
 * composition (a Korean syllable, say) is not also taken as a submit. The
 * keydown for that Enter can arrive right after compositionend, so Enter
 * stays ignored until the next macrotask after end().
 *
 * Wire start() to compositionstart, end() to compositionend and ask
 * shouldIgnoreEnter(event) on an Enter keydown. reset() forgets the state and
 * cancels the pending timer: call it when the form resets and when the
 * component is destroyed.
 */
export function createImeCompositionGuard() {
	let isComposing = false;
	let justEnded = false;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let resetTimer = null;

	function clearResetTimer() {
		if (!resetTimer) return;
		clearTimeout(resetTimer);
		resetTimer = null;
	}

	return {
		start() {
			isComposing = true;
			justEnded = false;
			clearResetTimer();
		},

		end() {
			isComposing = false;
			justEnded = true;
			clearResetTimer();
			resetTimer = setTimeout(() => {
				justEnded = false;
				resetTimer = null;
			}, 0);
		},

		/**
		 * @param {Pick<KeyboardEvent, 'isComposing'> & { keyCode?: number; which?: number }} event
		 */
		shouldIgnoreEnter(event) {
			return shouldIgnoreImeSubmit(event, { isComposing, justEnded });
		},

		reset() {
			justEnded = false;
			isComposing = false;
			clearResetTimer();
		}
	};
}
