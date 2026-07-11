/**
 * Shared pointer-based drag and drop for the board views.
 *
 * HTML5 drag events never fire for touch input on iOS/Android, which left
 * card movement dead on the app's primary devices. This controller drives the
 * whole gesture from pointer events instead (the same primitive the Gantt
 * resize already uses): mice activate after a small movement threshold so
 * plain clicks keep working, touches activate after a long-press so vertical
 * panning keeps scrolling the page.
 *
 * The state machine is DOM-free and takes injected adapters for hit testing,
 * ghost presentation, and auto-scroll, so it can be unit-tested in Node.
 */

const DEFAULT_ACTIVATION = Object.freeze({
	mouseDistancePx: 4,
	touchDelayMs: 280,
	touchTolerancePx: 8
});

/** Marks an element as a drop target, e.g. data-dnd-zone="column:todo". */
export const DND_ZONE_ATTRIBUTE = 'data-dnd-zone';

/**
 * @typedef {{
 *   draggedId: string | null;
 *   hoveredZone: string | null;
 * }} DndSnapshot
 *
 * @typedef {{
 *   clientX: number;
 *   clientY: number;
 *   pointerType?: string;
 *   button?: number;
 *   preventDefault?: () => void;
 * }} PointerLike
 */

/**
 * @param {{
 *   onDrop: (draggedId: string, zone: string) => void;
 *   onStateChange?: (snapshot: DndSnapshot) => void;
 *   resolveZone?: (clientX: number, clientY: number) => string | null;
 *   presentation?: { start: (node: unknown, event: PointerLike) => void; move: (event: PointerLike) => void; end: () => void };
 *   autoScroll?: { update: (event: PointerLike) => void; stop: () => void };
 *   listen?: (type: string, handler: (event: any) => void, options?: AddEventListenerOptions) => () => void;
 *   setTimer?: (handler: () => void, delayMs: number) => () => void;
 *   activation?: Partial<typeof DEFAULT_ACTIVATION>;
 * }} options
 */
export function createPointerDndController(options) {
	const activation = { ...DEFAULT_ACTIVATION, ...options.activation };
	const resolveZone = options.resolveZone ?? defaultResolveZone;
	const presentation = options.presentation ?? createGhostPresentation();
	const autoScroll = options.autoScroll ?? createAutoScroller();
	const listen = options.listen ?? defaultListen;
	const setTimer = options.setTimer ?? defaultSetTimer;
	const notify = options.onStateChange ?? (() => {});

	/**
	 * @type {{
	 *   phase: 'idle';
	 * } | {
	 *   phase: 'pending';
	 *   id: string;
	 *   node: unknown;
	 *   isTouch: boolean;
	 *   originX: number;
	 *   originY: number;
	 *   cancelTimer: () => void;
	 *   teardown: (() => void)[];
	 * } | {
	 *   phase: 'active';
	 *   id: string;
	 *   node: unknown;
	 *   isTouch: boolean;
	 *   hoveredZone: string | null;
	 *   lastEvent: PointerLike;
	 *   teardown: (() => void)[];
	 * }}
	 */
	let state = { phase: 'idle' };
	let suppressNextClick = false;

	function emit() {
		notify({
			draggedId: state.phase === 'active' ? state.id : null,
			hoveredZone: state.phase === 'active' ? state.hoveredZone : null
		});
	}

	/**
	 * @param {unknown} node
	 * @param {string} id
	 * @param {PointerLike} event
	 */
	function beginPending(node, id, event) {
		if (state.phase !== 'idle' || (event.button ?? 0) !== 0) {
			return;
		}

		const isTouch = event.pointerType === 'touch';
		/** @type {(() => void)[]} */
		const teardown = [];
		const pending = {
			phase: /** @type {const} */ ('pending'),
			id,
			node,
			isTouch,
			originX: event.clientX,
			originY: event.clientY,
			cancelTimer: () => {},
			teardown
		};
		state = pending;

		teardown.push(listen('pointermove', handlePointerMove));
		teardown.push(listen('pointerup', handleRelease));
		teardown.push(listen('pointercancel', handleCancel));

		if (isTouch) {
			// Long-press: give native panning the first claim on the gesture.
			pending.cancelTimer = setTimer(() => {
				if (state.phase === 'pending' && state === pending) {
					activate(event);
				}
			}, activation.touchDelayMs);
		}
	}

	/** @param {PointerLike} event */
	function activate(event) {
		if (state.phase !== 'pending') {
			return;
		}

		const { id, node, isTouch, teardown } = state;
		state = {
			phase: 'active',
			id,
			node,
			isTouch,
			hoveredZone: null,
			lastEvent: event,
			teardown
		};

		// Once the drag owns the gesture, stop native scrolling and the iOS
		// long-press callout. touchmove must be non-passive to preventDefault.
		teardown.push(listen('touchmove', preventDefaultHandler, { passive: false }));
		teardown.push(listen('contextmenu', preventDefaultHandler));
		teardown.push(listen('keydown', handleKeyDown));

		presentation.start(node, event);
		emit();
		handleActiveMove(event);
	}

	/** @param {PointerLike} event */
	function handlePointerMove(event) {
		if (state.phase === 'pending') {
			const distance = Math.hypot(event.clientX - state.originX, event.clientY - state.originY);
			if (state.isTouch) {
				// Movement before the long-press fires means the user is
				// scrolling; hand the gesture back to the browser.
				if (distance > activation.touchTolerancePx) {
					reset();
				}
				return;
			}

			if (distance > activation.mouseDistancePx) {
				activate(event);
			}
			return;
		}

		if (state.phase === 'active') {
			event.preventDefault?.();
			handleActiveMove(event);
		}
	}

	/** @param {PointerLike} event */
	function handleActiveMove(event) {
		if (state.phase !== 'active') {
			return;
		}

		state.lastEvent = event;
		presentation.move(event);
		autoScroll.update(event);

		const zone = resolveZone(event.clientX, event.clientY);
		if (zone !== state.hoveredZone) {
			state.hoveredZone = zone;
			emit();
		}
	}

	/** @param {PointerLike} event */
	function handleRelease(event) {
		if (state.phase === 'pending') {
			reset();
			return;
		}

		if (state.phase !== 'active') {
			return;
		}

		const { id } = state;
		const zone = resolveZone(event.clientX, event.clientY) ?? state.hoveredZone;
		suppressNextClick = true;
		reset();
		if (zone) {
			options.onDrop(id, zone);
		}
	}

	function handleCancel() {
		reset();
	}

	/** @param {{ key?: string }} event */
	function handleKeyDown(event) {
		if (event.key === 'Escape') {
			reset();
		}
	}

	function reset() {
		if (state.phase === 'idle') {
			return;
		}

		if (state.phase === 'pending') {
			state.cancelTimer();
		}

		const wasActive = state.phase === 'active';
		state.teardown.forEach((remove) => remove());
		state = { phase: 'idle' };
		if (wasActive) {
			presentation.end();
			autoScroll.stop();
			emit();
		}
	}

	/**
	 * Svelte-action-compatible: makes a node draggable under this controller.
	 * @param {HTMLElement} node
	 * @param {string} id
	 */
	function draggable(node, id) {
		let currentId = id;
		/** @param {PointerEvent} event */
		const onPointerDown = (event) => beginPending(node, currentId, event);
		/** @param {MouseEvent} event */
		const onClick = (event) => {
			// The click fired at the end of a completed drag must not open the
			// task modal underneath the drop point.
			if (suppressNextClick) {
				suppressNextClick = false;
				event.preventDefault();
				event.stopPropagation();
			}
		};
		node.addEventListener('pointerdown', onPointerDown);
		node.addEventListener('click', onClick, true);

		return {
			/** @param {string} nextId */
			update(nextId) {
				currentId = nextId;
			},
			destroy() {
				node.removeEventListener('pointerdown', onPointerDown);
				node.removeEventListener('click', onClick, true);
				if (state.phase !== 'idle' && state.node === node) {
					reset();
				}
			}
		};
	}

	return {
		draggable,
		cancel: reset,
		isDragging: () => state.phase === 'active'
	};
}

/** @param {{ preventDefault?: () => void }} event */
function preventDefaultHandler(event) {
	event.preventDefault?.();
}

/**
 * @param {string} type
 * @param {(event: any) => void} handler
 * @param {AddEventListenerOptions} [eventOptions]
 */
function defaultListen(type, handler, eventOptions) {
	window.addEventListener(type, handler, eventOptions);
	return () => window.removeEventListener(type, handler, eventOptions);
}

/**
 * @param {() => void} handler
 * @param {number} delayMs
 */
function defaultSetTimer(handler, delayMs) {
	const timer = setTimeout(handler, delayMs);
	return () => clearTimeout(timer);
}

/**
 * @param {number} clientX
 * @param {number} clientY
 */
function defaultResolveZone(clientX, clientY) {
	const element = document.elementFromPoint(clientX, clientY);
	const zoneElement = element?.closest(`[${DND_ZONE_ATTRIBUTE}]`);
	return zoneElement?.getAttribute(DND_ZONE_ATTRIBUTE) ?? null;
}

/**
 * Floating clone of the dragged card that follows the pointer. The clone is
 * pointer-events:none so hit testing sees the elements underneath it.
 */
function createGhostPresentation() {
	/** @type {HTMLElement | null} */
	let ghost = null;
	/** @type {HTMLElement | null} */
	let source = null;
	let offsetX = 0;
	let offsetY = 0;

	return {
		/**
		 * @param {unknown} node
		 * @param {PointerLike} event
		 */
		start(node, event) {
			source = /** @type {HTMLElement} */ (node);
			const rect = source.getBoundingClientRect();
			offsetX = Math.min(event.clientX - rect.left, rect.width - 12);
			offsetY = event.clientY - rect.top;

			ghost = /** @type {HTMLElement} */ (source.cloneNode(true));
			ghost.classList.add('dnd-ghost');
			ghost.style.width = `${rect.width}px`;
			ghost.style.left = `${event.clientX - offsetX}px`;
			ghost.style.top = `${event.clientY - offsetY}px`;
			document.body.appendChild(ghost);
			source.classList.add('dnd-source');
		},
		/** @param {PointerLike} event */
		move(event) {
			if (!ghost) return;
			ghost.style.left = `${event.clientX - offsetX}px`;
			ghost.style.top = `${event.clientY - offsetY}px`;
		},
		end() {
			ghost?.remove();
			ghost = null;
			source?.classList.remove('dnd-source');
			source = null;
		}
	};
}

/**
 * Scrolls the window and the scrollable container under the pointer when the
 * drag approaches an edge — without this, moving a card between stacked
 * columns on a phone is impossible.
 */
function createAutoScroller({ edgePx = 72, maxStepPx = 14 } = {}) {
	let pointerX = 0;
	let pointerY = 0;
	/** @type {number | null} */
	let frame = null;

	function step() {
		frame = null;
		const viewportHeight = window.innerHeight;
		let scrolled = false;

		const container = findScrollableAncestor(document.elementFromPoint(pointerX, pointerY));
		if (container) {
			const rect = container.getBoundingClientRect();
			const delta = edgeDelta(pointerY, Math.max(rect.top, 0), Math.min(rect.bottom, viewportHeight), edgePx, maxStepPx);
			if (delta !== 0) {
				const before = container.scrollTop;
				container.scrollTop += delta;
				scrolled = container.scrollTop !== before;
			}
		}

		if (!scrolled) {
			const delta = edgeDelta(pointerY, 0, viewportHeight, edgePx, maxStepPx);
			if (delta !== 0) {
				window.scrollBy(0, delta);
				scrolled = true;
			}
		}

		if (scrolled) {
			frame = requestAnimationFrame(step);
		}
	}

	return {
		/** @param {PointerLike} event */
		update(event) {
			pointerX = event.clientX;
			pointerY = event.clientY;
			frame ??= requestAnimationFrame(step);
		},
		stop() {
			if (frame !== null) {
				cancelAnimationFrame(frame);
				frame = null;
			}
		}
	};
}

/**
 * @param {number} position
 * @param {number} start
 * @param {number} end
 * @param {number} edgePx
 * @param {number} maxStepPx
 */
function edgeDelta(position, start, end, edgePx, maxStepPx) {
	if (position < start + edgePx) {
		return -Math.ceil(((start + edgePx - position) / edgePx) * maxStepPx);
	}
	if (position > end - edgePx) {
		return Math.ceil(((position - (end - edgePx)) / edgePx) * maxStepPx);
	}
	return 0;
}

/**
 * @param {Element | null} element
 * @returns {HTMLElement | null}
 */
function findScrollableAncestor(element) {
	let current = element instanceof HTMLElement ? element : null;
	while (current && current !== document.body) {
		const style = getComputedStyle(current);
		const scrollsY = (style.overflowY === 'auto' || style.overflowY === 'scroll')
			&& current.scrollHeight > current.clientHeight;
		if (scrollsY) {
			return current;
		}
		current = current.parentElement;
	}
	return null;
}
