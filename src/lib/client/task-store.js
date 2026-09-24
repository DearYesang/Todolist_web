import { derived, writable } from 'svelte/store';
import {
    deleteServerCategory,
    mergeServerCategory,
    reorderServerCategories,
    updateServerCategory
} from './category-api.js';
import { isServerTaskId } from './task-create.js';
import {
    addSubtaskToList,
    assignParentInList,
    clearDoneTasksFromList,
    DEFAULT_FILTERS,
    deleteSubtaskFromList,
    deleteTaskCascadeFromList,
    moveTaskInList,
    normalizeTaskList,
    renameSubtaskInList,
    toggleSubtaskInList,
    updateTaskInList
} from '../shared/task-domain.js';
import { normalizeCategoryName } from '../shared/category-suggestions.js';
import { getTaskStorageKey, runWithoutPersisting, tasks } from './task-store/task-cache.js';
import {
    hasPendingTaskSync,
    syncChecklistCreate,
    syncChecklistDelete,
    syncChecklistPatch,
    syncClearDoneTasks,
    syncTaskDelete,
    syncTaskSnapshot
} from './task-store/sync-engine.js';

export {
    clearLocalTaskCache,
    mergeTasks,
    removeTasksByIds,
    replaceLocalTaskWithServerTask,
    replaceTasks,
    setTaskStorageOwner,
    tasks
} from './task-store/task-cache.js';

export {
    applyServerDefaultView,
    clearPendingDefaultView,
    currentView,
    isAppView,
    markPendingDefaultView,
    readPendingDefaultView,
    setCurrentView
} from './task-store/view-preference.js';

export {
    applyServerTaskResults,
    applyServerTaskSnapshot,
    drainPendingTaskSyncsToOfflineQueue,
    resetTaskSyncStateForTests,
    waitForPendingTaskSyncs
} from './task-store/sync-engine.js';

/**
 * Applies another tab's persisted task list so concurrent tabs converge on the
 * same cache instead of clobbering each other on their next write.
 * @param {{ key: string | null; newValue: string | null }} event
 */
export function handleExternalTaskStorageEvent(event) {
    if (!event || event.key !== getTaskStorageKey()) {
        return;
    }

    try {
        const parsed = event.newValue ? JSON.parse(event.newValue) : [];
        if (!Array.isArray(parsed)) {
            return;
        }

        const external = normalizeTaskList(parsed);
        runWithoutPersisting(() => {
            tasks.update((current) => {
                const currentById = new Map(current.map((task) => [task.id, task]));
                const externalIds = new Set(external.map((task) => task.id));
                // The other tab's cache may predate this tab's latest writes:
                // keep tasks with pending sync work and local-only tasks whose
                // creates still sit in this tab's offline queue.
                const merged = external.map((task) => {
                    const existing = currentById.get(task.id);
                    if (!existing) {
                        return task;
                    }
                    if (hasPendingTaskSync(task.id)) {
                        return existing;
                    }
                    return typeof existing.version === 'number'
                        && typeof task.version === 'number'
                        && task.version < existing.version
                        ? existing
                        : task;
                });
                const keptFromCurrent = current.filter((task) =>
                    !externalIds.has(task.id)
                    && (!isServerTaskId(task.id) || hasPendingTaskSync(task.id))
                );

                return normalizeTaskList([...merged, ...keptFromCurrent]);
            });
        });
    } catch (error) {
        console.error('Failed to apply cross-tab task update', error);
    }
}

/**
 * @param {{ addEventListener?: Function; removeEventListener?: Function }} [target]
 * @returns {() => void}
 */
export function setupCrossTabTaskSync(target = /** @type {any} */ (globalThis)) {
    const addEventListener = target?.addEventListener;
    const removeEventListener = target?.removeEventListener;
    if (typeof addEventListener !== 'function' || typeof removeEventListener !== 'function') {
        return () => {};
    }

    /** @param {StorageEvent} event */
    const listener = (event) => handleExternalTaskStorageEvent(event);
    addEventListener.call(target, 'storage', listener);
    return () => removeEventListener.call(target, 'storage', listener);
}

/** @type {import('svelte/store').Writable<import('../shared/task-domain.js').TaskFilters>} */
export const filters = writable({ ...DEFAULT_FILTERS });

/** @type {import('svelte/store').Writable<import('./category-api.js').ClientCategory[]>} */
export const categoryCatalog = writable([]);

export const categories = derived([tasks, categoryCatalog], ([$tasks, $categoryCatalog]) => {
    const hiddenCategoryIds = new Set($categoryCatalog
        .filter((category) => category.hiddenAt || category.archivedAt)
        .map((category) => category.id));
    const hiddenCategoryNames = new Set($categoryCatalog
        .filter((category) => category.hiddenAt || category.archivedAt)
        .map((category) => normalizeCategoryName(category.name).toLocaleLowerCase('ko'))
        .filter(Boolean));
    const names = new Set($categoryCatalog
        .filter((category) => !category.archivedAt && !category.hiddenAt)
        .map((category) => normalizeCategoryName(category.name))
        .filter(Boolean));
    for (const task of $tasks) {
        const name = normalizeCategoryName(task.category);
        const key = name.toLocaleLowerCase('ko');
        if (
            task.categoryMeta?.hiddenAt
            || task.categoryMeta?.archivedAt
            || (task.categoryId && hiddenCategoryIds.has(task.categoryId))
            || hiddenCategoryNames.has(key)
        ) {
            continue;
        }
        if (name) names.add(name);
    }

    return [...names].sort((a, b) => a.localeCompare(b, 'ko'));
});

export const categorySummaries = derived([tasks, categoryCatalog], ([$tasks, $categoryCatalog]) => {
    /** @type {Map<string, { id: string | null; name: string; color: string | null; sortOrder: number; hiddenAt: string | null; archivedAt: string | null; total: number; active: number; done: number }>} */
    const summaryByKey = new Map();
    for (const category of $categoryCatalog) {
        if (category.archivedAt) continue;
        summaryByKey.set(`id:${category.id}`, {
            id: category.id,
            name: category.name,
            color: category.color,
            sortOrder: category.sortOrder,
            hiddenAt: category.hiddenAt,
            archivedAt: category.archivedAt,
            total: 0,
            active: 0,
            done: 0
        });
    }

    for (const task of $tasks) {
        const name = normalizeCategoryName(task.category);
        if (!name) continue;
        const key = task.categoryId ? `id:${task.categoryId}` : `name:${normalizeCategoryName(name).toLocaleLowerCase('ko')}`;
        const summary = summaryByKey.get(key) ?? {
            id: task.categoryId ?? null,
            name,
            color: task.categoryMeta?.color ?? null,
            sortOrder: task.categoryMeta?.sortOrder ?? 1000,
            hiddenAt: task.categoryMeta?.hiddenAt ?? null,
            archivedAt: task.categoryMeta?.archivedAt ?? null,
            total: 0,
            active: 0,
            done: 0
        };
        summary.total += 1;
        if (task.status === 'done') {
            summary.done += 1;
        } else {
            summary.active += 1;
        }
        summaryByKey.set(key, summary);
    }

    return [...summaryByKey.values()]
        .filter((category) => !category.archivedAt)
        .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'ko'));
});

export const visibleCategorySummaries = derived(categorySummaries, ($categorySummaries) =>
    $categorySummaries.filter((category) => !category.hiddenAt && !category.archivedAt)
);

/**
 * @param {import('./category-api.js').ClientCategory[]} nextCategories
 */
export function applyServerCategoryCatalog(nextCategories) {
    categoryCatalog.set(normalizeCategoryCatalog(nextCategories));
}

/**
 * @param {import('../shared/task-domain.js').PriorityFilter} value
 */
export function setPriorityFilter(value) {
    filters.update((current) => ({ ...current, priority: value }));
}

/**
 * @param {import('../shared/task-domain.js').UrgencyFilter} value
 */
export function setUrgencyFilter(value) {
    filters.update((current) => ({ ...current, urgency: value }));
}

/**
 * @param {string} value
 */
export function setSearchFilter(value) {
    filters.update((current) => ({ ...current, search: value }));
}

/**
 * @param {string} value
 * @param {string | null} [name]
 */
export function setCategoryFilter(value, name = null) {
    if (value === 'all') {
        filters.update((current) => ({ ...current, category: 'all', categoryId: 'all' }));
        return;
    }

    filters.update((current) => ({
        ...current,
        category: name ?? value,
        categoryId: isServerTaskId(value) ? value : 'all'
    }));
}

export function resetFilters() {
    filters.set({ ...DEFAULT_FILTERS });
}

/**
 * @param {import('./category-api.js').ClientCategory[]} nextCategories
 */
function normalizeCategoryCatalog(nextCategories) {
    return [...nextCategories]
        .filter((category) => category.id && category.name)
        .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'ko'));
}

/**
 * @param {{ id?: string | null; name: string } | string} sourceCategory
 * @param {string} targetCategory
 */
export async function renameCategory(sourceCategory, targetCategory) {
    const source = normalizeCategoryInput(sourceCategory);
    const target = normalizeCategoryName(targetCategory);
    if (!source.name || !target || source.name === target) {
        return { ok: true, changed: 0, message: '변경할 카테고리가 없습니다.' };
    }

    if (source.id && typeof window !== 'undefined' && navigator.onLine) {
        const result = await updateServerCategory(source.id, { name: target });
        if (result.ok) {
            upsertCategoryCatalog(result.category);
            const changed = rewriteLocalCategory(source, result.category, { sync: false });
            return { ok: true, changed, message: `${changed}개 작업의 카테고리를 수정했습니다.` };
        }
        if (!result.fallback) {
            return { ok: false, changed: 0, message: result.message };
        }
    }

    const changed = rewriteLocalCategory(source, { id: source.id ?? null, name: target, color: null, sortOrder: 0, hiddenAt: null, archivedAt: null }, { sync: true });
    return { ok: true, changed, message: `${changed}개 작업의 카테고리를 이 기기에서 수정했습니다. 온라인 동기화는 작업 변경으로 재시도됩니다.` };
}

/**
 * @param {{ id?: string | null; name: string } | string} sourceCategory
 * @param {{ id?: string | null; name: string } | string} targetCategory
 */
export async function mergeCategory(sourceCategory, targetCategory) {
    const source = normalizeCategoryInput(sourceCategory);
    const target = normalizeCategoryInput(targetCategory);
    if (!source.name || !target.name || source.name === target.name || Boolean(source.id && target.id && source.id === target.id)) {
        return { ok: true, changed: 0, message: '병합할 카테고리가 없습니다.' };
    }

    if (source.id && target.id && typeof window !== 'undefined' && navigator.onLine) {
        const result = await mergeServerCategory(source.id, target.id);
        if (result.ok) {
            upsertCategoryCatalog(result.target);
            archiveCategoryInCatalog(result.source.id);
            const changed = rewriteLocalCategory(source, result.target, { sync: false });
            return { ok: true, changed, message: `${changed}개 작업을 "${result.target.name}" 카테고리로 병합했습니다.` };
        }
        if (!result.fallback) {
            return { ok: false, changed: 0, message: result.message };
        }
    }

    const changed = rewriteLocalCategory(source, {
        id: target.id ?? null,
        name: target.name,
        color: null,
        sortOrder: 0,
        hiddenAt: null,
        archivedAt: null
    }, { sync: true });
    return { ok: true, changed, message: `${changed}개 작업을 이 기기에서 병합했습니다. 온라인 동기화는 작업 변경으로 재시도됩니다.` };
}

/** @param {{ id?: string | null; name: string } | string} category */
export async function clearCategory(category) {
    const source = normalizeCategoryInput(category);
    if (!source.name) {
        return { ok: true, changed: 0, message: '삭제할 카테고리가 없습니다.' };
    }

    if (source.id && typeof window !== 'undefined' && navigator.onLine) {
        const result = await deleteServerCategory(source.id);
        if (result.ok) {
            archiveCategoryInCatalog(result.category.id);
            const changed = rewriteLocalCategory(source, null, { sync: false });
            return { ok: true, changed, message: `${changed}개 작업을 미분류로 옮겼습니다.` };
        }
        if (!result.fallback) {
            return { ok: false, changed: 0, message: result.message };
        }
    }

    const changed = rewriteLocalCategory(source, null, { sync: true });
    return { ok: true, changed, message: `${changed}개 작업을 이 기기에서 미분류로 옮겼습니다.` };
}

/**
 * @param {{ id?: string | null; name: string } | string} category
 * @param {string | null} color
 */
export async function updateCategoryColor(category, color) {
    const source = normalizeCategoryInput(category);
    if (!source.id || typeof window === 'undefined' || !navigator.onLine) {
        return { ok: false, message: '카테고리 색상 변경은 온라인 상태에서 가능합니다.' };
    }

    const result = await updateServerCategory(source.id, { color });
    if (!result.ok) {
        return { ok: false, message: result.message };
    }

    upsertCategoryCatalog(result.category);
    updateLocalCategoryMeta(result.category);
    return { ok: true, message: '카테고리 색상을 저장했습니다.' };
}

/**
 * @param {{ id?: string | null; name: string } | string} category
 * @param {boolean} hidden
 */
export async function setCategoryHidden(category, hidden) {
    const source = normalizeCategoryInput(category);
    if (!source.id || typeof window === 'undefined' || !navigator.onLine) {
        return { ok: false, message: '카테고리 숨김 설정은 온라인 상태에서 가능합니다.' };
    }

    const result = await updateServerCategory(source.id, { hidden });
    if (!result.ok) {
        return { ok: false, message: result.message };
    }

    upsertCategoryCatalog(result.category);
    updateLocalCategoryMeta(result.category);
    return { ok: true, message: hidden ? '필터에서 숨겼습니다.' : '필터에 다시 표시했습니다.' };
}

/**
 * @param {string[]} categoryIds
 */
export async function reorderCategories(categoryIds) {
    if (categoryIds.length === 0 || typeof window === 'undefined' || !navigator.onLine) {
        return { ok: false, message: '카테고리 정렬은 온라인 상태에서 가능합니다.' };
    }

    const result = await reorderServerCategories(categoryIds);
    if (!result.ok) {
        return { ok: false, message: result.message };
    }

    applyServerCategoryCatalog(result.categories);
    return { ok: true, message: '카테고리 순서를 저장했습니다.' };
}

/**
 * @param {{ id?: string | null; name: string }} source
 * @param {{ id?: string | null; name: string; color: string | null; sortOrder: number; hiddenAt: string | null; archivedAt: string | null } | null} target
 * @param {{ sync: boolean }} options
 */
function rewriteLocalCategory(source, target, options) {
    const sourceName = normalizeCategoryName(source.name);
    const targetName = normalizeCategoryName(target?.name ?? '');
    const isSameServerCategory = Boolean(source.id && target?.id && source.id === target.id);
    if (
        !sourceName
        || (isSameServerCategory && sourceName === targetName)
        || (!source.id && !target?.id && sourceName === targetName)
    ) {
        return 0;
    }

    /** @type {import('../shared/task-domain.js').Task[]} */
    let changedTasks = [];
    tasks.update((current) => {
        const next = current.map((task) => {
            const isMatch = source.id
                ? task.categoryId === source.id
                : normalizeCategoryName(task.category) === sourceName;
            if (!isMatch) {
                return task;
            }

            const nextTask = {
                ...task,
                category: targetName,
                categoryId: target?.id || null,
                categoryMeta: target?.id
                    ? {
                        id: target.id,
                        name: target.name,
                        color: target.color,
                        sortOrder: target.sortOrder,
                        hiddenAt: target.hiddenAt,
                        archivedAt: target.archivedAt
                    }
                    : null
            };
            changedTasks.push(nextTask);
            return nextTask;
        });

        return normalizeTaskList(next);
    });

    filters.update((current) => {
        const categoryMatches = current.category === sourceName || (source.id && current.categoryId === source.id);
        return categoryMatches
            ? { ...current, category: targetName || 'all', categoryId: target?.id ?? 'all' }
            : current;
    });
    if (options.sync) {
        changedTasks.forEach((task) => syncTaskSnapshot(task));
    }
    return changedTasks.length;
}

/**
 * @param {{ id?: string | null; name: string } | string} category
 * @returns {{ id: string | null; name: string }}
 */
function normalizeCategoryInput(category) {
    if (typeof category === 'string') {
        return { id: null, name: normalizeCategoryName(category) };
    }

    return {
        id: category.id ?? null,
        name: normalizeCategoryName(category.name)
    };
}

/**
 * @param {import('./category-api.js').ClientCategory} category
 */
function upsertCategoryCatalog(category) {
    categoryCatalog.update((current) => normalizeCategoryCatalog([
        ...current.filter((item) => item.id !== category.id),
        category
    ]));
}

/**
 * @param {string} categoryId
 */
function archiveCategoryInCatalog(categoryId) {
    categoryCatalog.update((current) => current.filter((category) => category.id !== categoryId));
}

/**
 * @param {import('./category-api.js').ClientCategory} category
 */
function updateLocalCategoryMeta(category) {
    tasks.update((current) => normalizeTaskList(current.map((task) =>
        task.categoryId === category.id
            ? {
                ...task,
                category: category.name,
                categoryMeta: {
                    id: category.id,
                    name: category.name,
                    color: category.color,
                    sortOrder: category.sortOrder,
                    hiddenAt: category.hiddenAt,
                    archivedAt: category.archivedAt
                }
            }
            : task
    )));
}

/**
 * @param {string} taskId
 * @param {string} nextStatus
 */
export function moveTask(taskId, nextStatus) {
    /** @type {import('../shared/task-domain.js').Task | null} */
    let syncedTask = null;
    tasks.update((current) => {
        const next = moveTaskInList(current, taskId, nextStatus);
        syncedTask = next.find((task) => task.id === taskId) ?? null;
        return next;
    });
    syncTaskSnapshot(syncedTask);
}

/**
 * @param {string} taskId
 * @param {string | null} nextParentId
 */
export function assignParent(taskId, nextParentId) {
    /** @type {import('../shared/task-domain.js').Task | null} */
    let syncedTask = null;
    tasks.update((current) => {
        const next = assignParentInList(current, taskId, nextParentId);
        syncedTask = next.find((task) => task.id === taskId) ?? null;
        return next;
    });
    syncTaskSnapshot(syncedTask);
}

/**
 * @param {string} taskId
 * @param {Partial<import('../shared/task-domain.js').Task>} patch
 */
export function updateTask(taskId, patch) {
    /** @type {import('../shared/task-domain.js').Task | null} */
    let syncedTask = null;
    tasks.update((current) => {
        const next = updateTaskInList(current, taskId, patch);
        syncedTask = next.find((task) => task.id === taskId) ?? null;
        return next;
    });
    syncTaskSnapshot(syncedTask);
}

/**
 * @param {string} taskId
 */
export function toggleCollapse(taskId) {
    tasks.update((current) =>
        current.map((task) => task.id === taskId ? { ...task, collapsed: !task.collapsed } : task)
    );
}

/**
 * @param {string} taskId
 */
export function deleteTaskCascade(taskId) {
    /** @type {import('../shared/task-domain.js').Task | null} */
    let deletedTask = null;
    tasks.update((current) => {
        deletedTask = current.find((task) => task.id === taskId) ?? null;
        return deleteTaskCascadeFromList(current, taskId);
    });
    syncTaskDelete(taskId, deletedTask);
}

export function clearDoneTasks() {
    /** @type {import('../shared/task-domain.js').Task[]} */
    let previousTasks = [];
    tasks.update((current) => {
        previousTasks = current;
        return clearDoneTasksFromList(current);
    });
    void syncClearDoneTasks(previousTasks);
}

/**
 * @param {string} taskId
 * @param {string} text
 */
export function addSubtask(taskId, text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    /** @type {string | null} */
    let subtaskId = null;
    tasks.update((current) => {
        const previousIds = new Set(current.find((task) => task.id === taskId)?.subtasks.map((subtask) => subtask.id) ?? []);
        const next = addSubtaskToList(current, taskId, text);
        subtaskId = next.find((task) => task.id === taskId)?.subtasks.find((subtask) => !previousIds.has(subtask.id))?.id ?? null;
        return next;
    });

    if (subtaskId) {
        syncChecklistCreate(taskId, subtaskId, trimmed);
    }
}

/**
 * @param {string} taskId
 * @param {string} subtaskId
 */
export function toggleSubtask(taskId, subtaskId) {
    /** @type {boolean | null} */
    let done = null;
    tasks.update((current) => {
        const next = toggleSubtaskInList(current, taskId, subtaskId);
        done = next.find((task) => task.id === taskId)?.subtasks.find((subtask) => subtask.id === subtaskId)?.done ?? null;
        return next;
    });

    if (done !== null) {
        syncChecklistPatch(taskId, subtaskId, { done });
    }
}

/**
 * @param {string} taskId
 * @param {string} subtaskId
 * @param {string} text
 */
export function renameSubtask(taskId, subtaskId, text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    tasks.update((current) => renameSubtaskInList(current, taskId, subtaskId, text));
    syncChecklistPatch(taskId, subtaskId, { text: trimmed });
}

/**
 * @param {string} taskId
 * @param {string} subtaskId
 */
export function deleteSubtask(taskId, subtaskId) {
    tasks.update((current) => deleteSubtaskFromList(current, taskId, subtaskId));
    syncChecklistDelete(taskId, subtaskId);
}
