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
