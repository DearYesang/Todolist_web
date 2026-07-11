import { describe, expect, it, vi } from 'vitest';
import { createPointerDndController } from './pointer-dnd.js';

/**
 * DOM-free harness: window listeners, the long-press timer, presentation, and
 * hit testing are all injected so the gesture state machine runs in Node.
 */
/** @param {{ zones?: Record<string, string> }} [options] */
function createHarness({ zones = {} } = {}) {
	/** @type {Map<string, Set<(event: any) => void>>} */
	const listeners = new Map();
	/** @type {{ handler: () => void; cancelled: boolean } | null} */
	let timer = null;

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
		listen(type, handler) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type)?.add(handler);
			return () => listeners.get(type)?.delete(handler);
		},
		setTimer(handler) {
			timer = { handler, cancelled: false };
			return () => {
				if (timer) timer.cancelled = true;
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
		/** @param {string} id */
		attach(id) {
			return controller.draggable(/** @type {any} */ (node), id);
		},
		/** @param {any} event */
		pressOnNode(event) {
			nodeListeners.get('pointerdown')?.forEach((handler) => handler(event));
		},
		/** @param {any} event */
		clickOnNode(event) {
			nodeListeners.get('click')?.forEach((handler) => handler(event));
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
			if (timer && !timer.cancelled) timer.handler();
		}
	};
}

/** @param {Partial<{ clientX: number; clientY: number; pointerType: string; button: number; key: string }>} overrides */
function pointer(overrides = {}) {
	return { clientX: 0, clientY: 0, pointerType: 'mouse', button: 0, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...overrides };
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

	it('activates a touch drag on long-press and blocks native scrolling from then on', () => {
		const harness = createHarness({ zones: { '40,300': 'quadrant:do' } });
		harness.attach('task-1');

		harness.pressOnNode(pointer({ pointerType: 'touch', clientX: 40, clientY: 40 }));
		harness.fire('pointermove', pointer({ pointerType: 'touch', clientX: 43, clientY: 43 }));
		harness.fireLongPress();

		expect(harness.presentation.start).toHaveBeenCalledTimes(1);
		expect(harness.hasWindowListener('touchmove')).toBe(true);

		harness.fire('pointermove', pointer({ pointerType: 'touch', clientX: 40, clientY: 300 }));
		harness.fire('pointerup', pointer({ pointerType: 'touch', clientX: 40, clientY: 300 }));
		expect(harness.onDrop).toHaveBeenCalledWith('task-1', 'quadrant:do');
	});
});

describe('drag lifecycle', () => {
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

	it('suppresses exactly one click after a completed drag', () => {
		const harness = createHarness({ zones: { '50,50': 'column:doing' } });
		harness.attach('task-1');

		harness.pressOnNode(pointer());
		harness.fire('pointermove', pointer({ clientX: 50, clientY: 50 }));
		harness.fire('pointerup', pointer({ clientX: 50, clientY: 50 }));

		const swallowed = pointer();
		harness.clickOnNode(swallowed);
		expect(swallowed.preventDefault).toHaveBeenCalled();

		const passedThrough = pointer();
		harness.clickOnNode(passedThrough);
		expect(passedThrough.preventDefault).not.toHaveBeenCalled();
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
