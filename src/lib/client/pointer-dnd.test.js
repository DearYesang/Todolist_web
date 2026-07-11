import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPointerDndController, edgeDelta } from './pointer-dnd.js';

/**
 * DOM-free harness: window listeners, timers, presentation, and hit testing
 * are all injected so the gesture state machine runs in Node.
 * @param {{ zones?: Record<string, string> }} [options]
 */
function createHarness({ zones = {} } = {}) {
	/** @type {Map<string, Set<(event: any) => void>>} */
	const listeners = new Map();
	/** @type {Map<string, AddEventListenerOptions | undefined>} */
	const listenerOptions = new Map();
	/** @type {{ handler: () => void; delayMs: number; cancelled: boolean }[]} */
	const timers = [];

	const presentation = { start: vi.fn(), move: vi.fn(), end: vi.fn() };
	const autoScroll = { update: vi.fn(), stop: vi.fn() };
	const onDrop = vi.fn();
	/** @type {Array<{ draggedId: string | null; hoveredZone: string | null }>} */
	const snapshots = [];

	const controller = createPointerDndController({
		onDrop,
		onStateChange: (snapshot) => snapshots.push(snapshot),
		resolveZone: (x, y) => zones[`${x},${y}`] ?? null,
		presentation,
		autoScroll,
		listen(type, handler, options) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type)?.add(handler);
			listenerOptions.set(type, options);
			return () => listeners.get(type)?.delete(handler);
		},
		setTimer(handler, delayMs) {
			const timer = { handler, delayMs, cancelled: false };
			timers.push(timer);
			return () => {
				timer.cancelled = true;
			};
		}
	});

	/** @type {Map<string, Set<(event: any) => void>>} */
	const nodeListeners = new Map();
	const node = {
		addEventListener: (/** @type {string} */ type, /** @type {any} */ handler) => {
			if (!nodeListeners.has(type)) nodeListeners.set(type, new Set());
			nodeListeners.get(type)?.add(handler);
		},
		removeEventListener: (/** @type {string} */ type, /** @type {any} */ handler) => {
			nodeListeners.get(type)?.delete(handler);
		}
	};

	return {
		controller,
		presentation,
		autoScroll,
		onDrop,
		snapshots,
		node,
		listenerOptions,
		/** @param {string} id */
		attach(id) {
			return controller.draggable(/** @type {any} */ (node), id);
		},
		/** @param {any} event */
		pressOnNode(event) {
			nodeListeners.get('pointerdown')?.forEach((handler) => handler(event));
		},
		/**
		 * @param {string} type
		 * @param {any} event
		 */
		fire(type, event) {
			listeners.get(type)?.forEach((handler) => handler(event));
		},
		/** @param {string} type */
		hasWindowListener(type) {
			return (listeners.get(type)?.size ?? 0) > 0;
		},
		fireLongPress() {
			const timer = timers.find((candidate) => candidate.delayMs > 0 && !candidate.cancelled);
			timer?.handler();
		},
		fireExpiryTimers() {
			timers
				.filter((candidate) => candidate.delayMs === 0 && !candidate.cancelled)
				.forEach((candidate) => candidate.handler());
		}
	};
}

/** @param {Partial<{ clientX: number; clientY: number; pointerType: string; pointerId: number; button: number; key: string; cancelable: boolean; target: unknown }>} overrides */
function pointer(overrides = {}) {
	return {
		clientX: 0,
		clientY: 0,
		pointerType: 'mouse',
		pointerId: 1,
		button: 0,
		preventDefault: vi.fn(),
		stopPropagation: vi.fn(),
		...overrides
	};
}

describe('pointer drag activation', () => {
	it('keeps a plain mouse click a click: press and release without movement never drags', () => {
		const harness = createHarness();
		harness.attach('task-1');

		harness.pressOnNode(pointer());
		harness.fire('pointermove', pointer({ clientX: 2, clientY: 2 }));
		harness.fire('pointerup', pointer({ clientX: 2, clientY: 2 }));

		expect(harness.onDrop).not.toHaveBeenCalled();
		expect(harness.presentation.start).not.toHaveBeenCalled();
		expect(harness.hasWindowListener('pointermove')).toBe(false);
	});

	it('activates a mouse drag past the movement threshold and drops on the resolved zone', () => {
		const harness = createHarness({ zones: { '50,50': 'column:doing' } });
		harness.attach('task-1');

		harness.pressOnNode(pointer());
		harness.fire('pointermove', pointer({ clientX: 10, clientY: 0 }));
		expect(harness.presentation.start).toHaveBeenCalledTimes(1);
		expect(harness.snapshots.at(-1)?.draggedId).toBe('task-1');

		harness.fire('pointermove', pointer({ clientX: 50, clientY: 50 }));
		expect(harness.snapshots.at(-1)?.hoveredZone).toBe('column:doing');
		expect(harness.autoScroll.update).toHaveBeenCalled();

		harness.fire('pointerup', pointer({ clientX: 50, clientY: 50 }));
		expect(harness.onDrop).toHaveBeenCalledWith('task-1', 'column:doing');
		expect(harness.presentation.end).toHaveBeenCalledTimes(1);
		expect(harness.autoScroll.stop).toHaveBeenCalledTimes(1);
		expect(harness.snapshots.at(-1)).toEqual({ draggedId: null, hoveredZone: null });
	});

	it('lets touch scrolling win: movement before the long-press cancels the pending drag', () => {
		const harness = createHarness();
		harness.attach('task-1');

		harness.pressOnNode(pointer({ pointerType: 'touch' }));
		harness.fire('pointermove', pointer({ pointerType: 'touch', clientX: 0, clientY: 30 }));

		// The long-press timer firing afterwards must not resurrect the drag.
		harness.fireLongPress();
		expect(harness.presentation.start).not.toHaveBeenCalled();
		expect(harness.hasWindowListener('pointermove')).toBe(false);
	});

	it('registers the scroll blocker non-passively at touch start but keeps it inert until activation', () => {
		const harness = createHarness({ zones: { '40,300': 'quadrant:do' } });
		harness.attach('task-1');

		harness.pressOnNode(pointer({ pointerType: 'touch', clientX: 40, clientY: 40 }));
		// iOS Safari decides scroll-vs-listener from the FIRST touchmove, so
		// the non-passive listener must exist before activation…
		expect(harness.hasWindowListener('touchmove')).toBe(true);
		expect(harness.listenerOptions.get('touchmove')).toEqual({ passive: false });

		// …but native panning still works during the long-press window.
		const preActivation = pointer({ cancelable: true });
		harness.fire('touchmove', preActivation);
		expect(preActivation.preventDefault).not.toHaveBeenCalled();

		harness.fireLongPress();
		const postActivation = pointer({ cancelable: true });
		harness.fire('touchmove', postActivation);
		expect(postActivation.preventDefault).toHaveBeenCalled();

		harness.fire('pointermove', pointer({ pointerType: 'touch', clientX: 40, clientY: 300 }));
		harness.fire('pointerup', pointer({ pointerType: 'touch', clientX: 40, clientY: 300 }));
		expect(harness.onDrop).toHaveBeenCalledWith('task-1', 'quadrant:do');
	});

	it('never starts a drag from interactive controls inside the card', () => {
		const harness = createHarness();
		harness.attach('task-1');

		class FakeElement {
			/** @param {string} selector */
			closest(selector) {
				return selector.includes('input') ? this : null;
			}
		}
		vi.stubGlobal('Element', FakeElement);
		try {
			harness.pressOnNode(pointer({ target: new FakeElement() }));
			expect(harness.hasWindowListener('pointermove')).toBe(false);

			// A press on a non-interactive target still arms the gesture.
			const inert = new FakeElement();
			inert.closest = () => null;
			harness.pressOnNode(pointer({ target: inert }));
			expect(harness.hasWindowListener('pointermove')).toBe(true);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe('multi-pointer isolation', () => {
	it('ignores a second pointer\'s movement and release during an active drag', () => {
		const harness = createHarness({ zones: { '50,50': 'column:doing', '200,200': 'column:done' } });
		harness.attach('task-1');

		harness.pressOnNode(pointer({ pointerId: 1 }));
		harness.fire('pointermove', pointer({ pointerId: 1, clientX: 50, clientY: 50 }));
		expect(harness.snapshots.at(-1)?.hoveredZone).toBe('column:doing');

		// A second finger moves and lifts over a different column.
		harness.fire('pointermove', pointer({ pointerId: 2, clientX: 200, clientY: 200 }));
		expect(harness.snapshots.at(-1)?.hoveredZone).toBe('column:doing');
		harness.fire('pointerup', pointer({ pointerId: 2, clientX: 200, clientY: 200 }));
		expect(harness.onDrop).not.toHaveBeenCalled();
		expect(harness.presentation.end).not.toHaveBeenCalled();

		// The owning pointer still completes its own drop.
		harness.fire('pointerup', pointer({ pointerId: 1, clientX: 50, clientY: 50 }));
		expect(harness.onDrop).toHaveBeenCalledWith('task-1', 'column:doing');
	});

	it('keeps the long-press pending when a second finger moves elsewhere', () => {
		const harness = createHarness({ zones: { '10,10': 'quadrant:do' } });
		harness.attach('task-1');

		harness.pressOnNode(pointer({ pointerType: 'touch', pointerId: 7, clientX: 10, clientY: 10 }));
		harness.fire('pointermove', pointer({ pointerType: 'touch', pointerId: 8, clientX: 300, clientY: 300 }));

		harness.fireLongPress();
		expect(harness.presentation.start).toHaveBeenCalledTimes(1);
	});
});

describe('drag lifecycle', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('cancels on Escape without dropping', () => {
		const harness = createHarness({ zones: { '50,50': 'column:done' } });
		harness.attach('task-1');

		harness.pressOnNode(pointer());
		harness.fire('pointermove', pointer({ clientX: 50, clientY: 50 }));
		harness.fire('keydown', { key: 'Escape' });

		expect(harness.presentation.end).toHaveBeenCalledTimes(1);
		harness.fire('pointerup', pointer({ clientX: 50, clientY: 50 }));
		expect(harness.onDrop).not.toHaveBeenCalled();
	});

	it('cancels on pointercancel (browser reclaimed the gesture)', () => {
		const harness = createHarness();
		harness.attach('task-1');

		harness.pressOnNode(pointer({ pointerType: 'touch' }));
		harness.fireLongPress();
		harness.fire('pointercancel', pointer());

		expect(harness.presentation.end).toHaveBeenCalledTimes(1);
		expect(harness.onDrop).not.toHaveBeenCalled();
	});

	it('drops nowhere when released outside every zone', () => {
		const harness = createHarness();
		harness.attach('task-1');

		harness.pressOnNode(pointer());
		harness.fire('pointermove', pointer({ clientX: 20, clientY: 20 }));
		harness.fire('pointerup', pointer({ clientX: 999, clientY: 999 }));

		expect(harness.onDrop).not.toHaveBeenCalled();
		expect(harness.presentation.end).toHaveBeenCalledTimes(1);
	});

	it('swallows exactly the post-drag click, wherever it lands', () => {
		const harness = createHarness({ zones: { '50,50': 'column:doing' } });
		harness.attach('task-1');

		harness.pressOnNode(pointer());
		harness.fire('pointermove', pointer({ clientX: 50, clientY: 50 }));
		harness.fire('pointerup', pointer({ clientX: 50, clientY: 50 }));

		// The browser targets the post-drag click at whatever sits under the
		// drop point — often not the source card — so the trap is global.
		const swallowed = pointer();
		harness.fire('click', swallowed);
		expect(swallowed.preventDefault).toHaveBeenCalled();

		const passedThrough = pointer();
		harness.fire('click', passedThrough);
		expect(passedThrough.preventDefault).not.toHaveBeenCalled();
	});

	it('expires the click trap immediately when no post-drag click ever fires', () => {
		const harness = createHarness({ zones: { '50,50': 'column:doing' } });
		harness.attach('task-1');

		harness.pressOnNode(pointer());
		harness.fire('pointermove', pointer({ clientX: 50, clientY: 50 }));
		harness.fire('pointerup', pointer({ clientX: 50, clientY: 50 }));

		// Touch drags usually emit no click at all; the zero-delay expiry
		// must disarm the trap before the user's next real click.
		harness.fireExpiryTimers();
		const laterClick = pointer();
		harness.fire('click', laterClick);
		expect(laterClick.preventDefault).not.toHaveBeenCalled();
	});

	it('updates the dragged id when the action parameter changes', () => {
		const harness = createHarness({ zones: { '50,50': 'column:doing' } });
		const action = harness.attach('task-1');
		action?.update?.('task-2');

		harness.pressOnNode(pointer());
		harness.fire('pointermove', pointer({ clientX: 50, clientY: 50 }));
		harness.fire('pointerup', pointer({ clientX: 50, clientY: 50 }));

		expect(harness.onDrop).toHaveBeenCalledWith('task-2', 'column:doing');
	});
});

describe('auto-scroll edge math', () => {
	it('scrolls toward the nearest edge with magnitude scaled by proximity', () => {
		// Inside the safe zone: no scrolling.
		expect(edgeDelta(400, 0, 800, 72, 14)).toBe(0);
		// Near the top edge: negative delta, stronger when closer.
		expect(edgeDelta(60, 0, 800, 72, 14)).toBeLessThan(0);
		expect(edgeDelta(10, 0, 800, 72, 14)).toBeLessThan(edgeDelta(60, 0, 800, 72, 14));
		// Near the bottom edge: positive delta.
		expect(edgeDelta(770, 0, 800, 72, 14)).toBeGreaterThan(0);
		// Magnitude never exceeds the configured step.
		expect(Math.abs(edgeDelta(0, 0, 800, 72, 14))).toBeLessThanOrEqual(14);
		expect(Math.abs(edgeDelta(800, 0, 800, 72, 14))).toBeLessThanOrEqual(14);
	});
});
