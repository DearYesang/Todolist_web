import { clearCategoryCatalog } from './category-store.js';
import { resetFilters } from './filters.js';
import { getTaskStorageOwner, setTaskStorageOwner } from './task-cache.js';
import { clearPendingDefaultView } from './view-preference.js';

/**
 * Hands the board to `userId`, or to the signed-out (anonymous) cache for
 * null. The tasks store loads that user's cached tasks, and what the
 * previous user left in the other stores goes with them:
 *
 * - The category catalog is emptied. It lists the board it was loaded for
 *   until the next finished sync loads this one (a blocked queue skips
 *   that); kept, it would list the previous user's categories and give the
 *   task panel their ids.
 * - The filters show everything again; a category filter would name the
 *   previous user's category.
 * - A default view still waiting to be sent is dropped when one signed-in
 *   user hands the board straight to another: the new user's first sync
 *   would send it as theirs. Every other change keeps it:
 *   - No user, then a user: the app opening as the cached user. The view
 *     was set offline in an earlier visit; the first sync once online
 *     sends it.
 *   - A user, then no user: a sign-out, which drops the view itself
 *     (AuthAccountControls.svelte), or a session check that failed, as on
 *     a network that reports online but reaches nothing (App.svelte). No
 *     one signed out there, and the view is sent once that user's session
 *     is confirmed again. The cost: if another user signs in next instead,
 *     their first sync sends it as theirs.
 *
 * The same user again, as every session refetch applies it, changes
 * nothing.
 * @param {string | null | undefined} userId
 */
export function setTaskStoreOwner(userId) {
	const previousOwner = getTaskStorageOwner();
	setTaskStorageOwner(userId);
	if (getTaskStorageOwner() === previousOwner) {
		return;
	}

	clearCategoryCatalog();
	resetFilters();
	if (previousOwner !== null && getTaskStorageOwner() !== null) {
		clearPendingDefaultView();
	}
}
