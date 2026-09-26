import { createContext } from 'svelte';

/**
 * What a board (KanbanBoard, EisenhowerMatrix) gives every TaskTreeCard
 * under it, at any depth, without each card passing it on to its children:
 * the board's drag and drop, and the callback that opens the detail panel.
 * dnd.cardDrops says whether cards are drop targets too (re-parenting),
 * which they are on the Kanban board only.
 *
 * @typedef {{
 *   dnd: {
 *     controller: ReturnType<typeof import('$lib/client/pointer-dnd.js').createPointerDndController>;
 *     state: { draggedId: string | null; hoveredZone: string | null };
 *     cardDrops: boolean;
 *   };
 *   openTask: (id: string) => void;
 * }} BoardContext
 */

/** @type {[() => BoardContext, (context: BoardContext) => BoardContext, () => boolean]} */
const [getBoardContext, setBoardContext] = createContext();

export { getBoardContext, setBoardContext };
