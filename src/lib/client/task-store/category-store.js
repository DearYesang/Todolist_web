import { derived, writable } from 'svelte/store';
import {
    deleteServerCategory,
    mergeServerCategory,
    reorderServerCategories,
    updateServerCategory
} from '../category-api.js';
import { normalizeTaskList } from '../../shared/task-domain.js';
import { normalizeCategoryName } from '../../shared/category-suggestions.js';
import { tasks } from './task-cache.js';
import { filters } from './filters.js';
import { syncTaskSnapshot } from './sync-engine.js';

/** @type {import('svelte/store').Writable<import('../category-api.js').ClientCategory[]>} */
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
 * @param {import('../category-api.js').ClientCategory[]} nextCategories
 */
export function applyServerCategoryCatalog(nextCategories) {
    categoryCatalog.set(normalizeCategoryCatalog(nextCategories));
}

/**
 * @param {import('../category-api.js').ClientCategory[]} nextCategories
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

    /** @type {import('../../shared/task-domain.js').Task[]} */
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
 * @param {import('../category-api.js').ClientCategory} category
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
 * @param {import('../category-api.js').ClientCategory} category
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
