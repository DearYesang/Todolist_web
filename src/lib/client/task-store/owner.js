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
 * - A default view still waiting to be sent is dropped when a signed-in
 *   user leaves: the next user's first sync would send it as theirs. When
 *   the app opens as the cached user (no user, then that user), it stays;
 *   it was set offline in an earlier visit, and the first sync once online
 *   sends it.
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
    if (previousOwner !== null) {
        clearPendingDefaultView();
    }
}
