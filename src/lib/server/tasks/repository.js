/**
 * The server task repository. The API routes, categories/repository.js and
 * the calendar modules import from this file, and the route tests replace it
 * with vi.mock factories, so code outside src/lib/server/tasks keeps using
 * this path. The code lives in the sibling modules:
 *
 * - task-repository.js: task reads, create, partial update and cascade delete.
 * - checklist-repository.js: checklist item writes, each batched with a task
 *   version bump.
 * - import-repository.js: backup import and replace.
 * - board-provisioning.js: the Personal workspace and Inbox board, created on
 *   first use, and the board's default view.
 * - task-rows.js: the authorization read, the checklist read, the position
 *   values and the client task a write answers with, which the writers share.
 *
 * Tests import the module they test directly, so this file exports only what
 * code outside src/lib/server/tasks uses.
 */

export {
	createTaskForUser,
	deleteTaskCascadeForUser,
	listTasksForBoard,
	listTasksForUser,
	updateTaskForUser
} from './task-repository.js';
export {
	createChecklistItemForUser,
	deleteChecklistItemForUser,
	updateChecklistItemForUser
} from './checklist-repository.js';
export { importTasksForUser, replaceTasksForUser } from './import-repository.js';
export {
	ensurePersonalBoardForUser,
	getBoardPreferencesForUser,
	updateBoardPreferencesForUser
} from './board-provisioning.js';
