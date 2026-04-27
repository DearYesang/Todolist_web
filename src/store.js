import { derived, writable } from 'svelte/store';

/**
 * @typedef {'todo' | 'doing' | 'done'} TaskStatus
 * @typedef {'high' | 'medium' | 'low'} TaskPriority
 * @typedef {'urgent' | 'normal'} TaskUrgency
 * @typedef {'all' | TaskPriority} PriorityFilter
 * @typedef {'all' | TaskUrgency} UrgencyFilter
 *
 * @typedef {{
 *   id: string;
 *   text: string;
 *   done: boolean;
 * }} Subtask
 *
 * @typedef {{
 *   id: string;
 *   text: string;
 *   status: TaskStatus;
 *   startDate: string;
 *   endDate: string;
 *   priority: TaskPriority;
 *   urgency: TaskUrgency;
 *   category: string;
 *   parentId: string | null;
 *   subtasks: Subtask[];
 *   collapsed: boolean;
 *   createdAt: number;
 * }} Task
 *
 * @typedef {{
 *   priority: PriorityFilter;
 *   urgency: UrgencyFilter;
 *   category: string;
 * }} TaskFilters
 */

const STORAGE_KEY = 'kanbanTasks';

export const DEFAULT_FILTERS = Object.freeze({
    priority: 'all',
    urgency: 'all',
    category: 'all'
});

export const STATUS_LABELS = {
    todo: '할 일',
    doing: '진행 중',
    done: '완료'
};

export const PRIORITY_LABELS = {
    high: '🔴 높음',
    medium: '🟡 보통',
    low: '🟢 낮음'
};

export const URGENCY_LABELS = {
    urgent: '🔥 시급',
    normal: '⏳ 여유'
};

export const CATEGORY_COLORS = [
    { bg: 'rgba(88, 166, 255, 0.15)', fg: '#58a6ff', border: '#58a6ff' },
    { bg: 'rgba(63, 185, 80, 0.15)', fg: '#3fb950', border: '#3fb950' },
    { bg: 'rgba(210, 153, 34, 0.15)', fg: '#d29922', border: '#d29922' },
    { bg: 'rgba(188, 76, 255, 0.15)', fg: '#bc4cff', border: '#bc4cff' },
    { bg: 'rgba(255, 123, 114, 0.15)', fg: '#ff7b72', border: '#ff7b72' },
    { bg: 'rgba(121, 192, 255, 0.15)', fg: '#79c0ff', border: '#79c0ff' },
    { bg: 'rgba(210, 106, 155, 0.15)', fg: '#d26a9b', border: '#d26a9b' },
    { bg: 'rgba(255, 166, 87, 0.15)', fg: '#ffa657', border: '#ffa657' }
];

/**
 * @returns {{ startDate: string; endDate: string }}
 */
export function getDefaultDateRange() {
    const start = new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + 2);

    return {
        startDate: start.toISOString().split('T')[0],
        endDate: end.toISOString().split('T')[0]
    };
}

/**
 * @returns {string}
 */
export function createId() {
    return `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * @param {unknown} raw
 * @param {number} index
 * @returns {Subtask}
 */
function normalizeSubtask(raw, index) {
    const source = /** @type {Record<string, unknown> | null | undefined} */ (raw);

    return {
        id: typeof source?.id === 'string' && source.id ? source.id : `${createId()}-${index}`,
        text: typeof source?.text === 'string' ? source.text : '',
        done: Boolean(source?.done)
    };
}

/**
 * @param {unknown} raw
 * @returns {Task}
 */
export function normalizeTask(raw) {
    const source = /** @type {Record<string, unknown> | null | undefined} */ (raw);
    const { startDate, endDate } = getDefaultDateRange();
    const subtasksRaw = Array.isArray(source?.subtasks) ? source.subtasks : [];
    const priority = source?.priority === 'high' || source?.priority === 'medium' || source?.priority === 'low'
        ? source.priority
        : 'medium';
    const urgency = source?.urgency === 'urgent' || source?.urgency === 'normal'
        ? source.urgency
        : 'normal';
    const status = source?.status === 'todo' || source?.status === 'doing' || source?.status === 'done'
        ? source.status
        : 'todo';

    return {
        id: typeof source?.id === 'string' && source.id ? source.id : createId(),
        text: typeof source?.text === 'string' ? source.text : '',
        status,
        startDate: typeof source?.startDate === 'string' && source.startDate ? source.startDate : startDate,
        endDate: typeof source?.endDate === 'string' && source.endDate ? source.endDate : endDate,
        priority,
        urgency,
        category: typeof source?.category === 'string' ? source.category.trim() : '',
        parentId: typeof source?.parentId === 'string' && source.parentId ? source.parentId : null,
        subtasks: subtasksRaw.map((item, index) => normalizeSubtask(item, index)),
        collapsed: Boolean(source?.collapsed),
        createdAt: typeof source?.createdAt === 'number' ? source.createdAt : Date.now()
    };
}

/**
 * @returns {Task[]}
 */
function loadInitialTasks() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];

        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map(normalizeTask) : [];
    } catch (error) {
        console.error('Failed to load kanban tasks', error);
        return [];
    }
}

/** @type {import('svelte/store').Writable<Task[]>} */
export const tasks = writable(loadInitialTasks());

tasks.subscribe((value) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch (error) {
        console.error('Failed to persist kanban tasks', error);
    }
});

/** @type {import('svelte/store').Writable<'kanban' | 'gantt'>} */
export const currentView = writable('kanban');

/** @type {import('svelte/store').Writable<TaskFilters>} */
export const filters = writable({ ...DEFAULT_FILTERS });

export const categories = derived(tasks, ($tasks) =>
    [...new Set($tasks.map((task) => task.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'))
);

/**
 * @param {TaskPriority | 'all'} value
 */
export function setPriorityFilter(value) {
    filters.update((current) => ({ ...current, priority: value }));
}

/**
 * @param {TaskUrgency | 'all'} value
 */
export function setUrgencyFilter(value) {
    filters.update((current) => ({ ...current, urgency: value }));
}

/**
 * @param {string} value
 */
export function setCategoryFilter(value) {
    filters.update((current) => ({ ...current, category: value }));
}

export function resetFilters() {
    filters.set({ ...DEFAULT_FILTERS });
}

/**
 * @param {Task[]} nextTasks
 */
export function replaceTasks(nextTasks) {
    tasks.set(nextTasks.map(normalizeTask));
}

/**
 * @param {string} category
 */
export function getCategoryColor(category) {
    if (!category) {
        return { bg: 'rgba(110, 118, 129, 0.1)', fg: '#8b949e', border: '#30363d' };
    }

    let hash = 0;
    for (let i = 0; i < category.length; i += 1) {
        hash = category.charCodeAt(i) + ((hash << 5) - hash);
    }

    return CATEGORY_COLORS[Math.abs(hash) % CATEGORY_COLORS.length];
}

/**
 * @param {Task} task
 * @param {TaskFilters} activeFilters
 */
export function matchesFilters(task, activeFilters) {
    if (activeFilters.priority !== 'all' && task.priority !== activeFilters.priority) return false;
    if (activeFilters.urgency !== 'all' && task.urgency !== activeFilters.urgency) return false;
    if (activeFilters.category !== 'all' && task.category !== activeFilters.category) return false;
    return true;
}

/**
 * @param {Task[]} taskList
 * @param {TaskFilters} activeFilters
 * @returns {Task[]}
 */
export function getFilteredTasks(taskList, activeFilters) {
    return taskList.filter((task) => matchesFilters(task, activeFilters));
}

/**
 * @param {Task[]} taskList
 * @returns {{ roots: Task[]; childrenByParent: Record<string, Task[]> }}
 */
export function buildHierarchy(taskList) {
    const visibleIds = new Set(taskList.map((task) => task.id));
    /** @type {Record<string, Task[]>} */
    const childrenByParent = {};
    /** @type {Task[]} */
    const roots = [];

    taskList.forEach((task) => {
        if (task.parentId && visibleIds.has(task.parentId)) {
            childrenByParent[task.parentId] = [...(childrenByParent[task.parentId] || []), task];
        } else {
            roots.push(task);
        }
    });

    return { roots, childrenByParent };
}

/**
 * @param {Task[]} taskList
 * @param {TaskStatus} status
 * @param {TaskFilters} activeFilters
 * @returns {{ columnTasks: Task[]; roots: Task[]; childrenByParent: Record<string, Task[]> }}
 */
export function buildColumnHierarchy(taskList, status, activeFilters) {
    const columnTasks = taskList.filter((task) => task.status === status && matchesFilters(task, activeFilters));
    const { roots, childrenByParent } = buildHierarchy(columnTasks);

    return { columnTasks, roots, childrenByParent };
}

/**
 * @param {Task[]} taskList
 * @param {string} taskId
 */
export function getDirectChildren(taskList, taskId) {
    return taskList.filter((task) => task.parentId === taskId);
}

/**
 * @param {Task[]} taskList
 * @param {string} taskId
 */
export function canAssignParent(taskList, taskId, taskIdToBecomeParent) {
    if (taskId === taskIdToBecomeParent) return false;

    let current = taskList.find((task) => task.id === taskIdToBecomeParent) || null;
    while (current) {
        if (current.parentId === taskId) return false;
        current = current.parentId ? taskList.find((task) => task.id === current.parentId) || null : null;
    }

    return true;
}

/**
 * @param {string} taskId
 * @param {string} nextStatus
 */
export function moveTask(taskId, nextStatus) {
    tasks.update((current) =>
        current.map((task) => {
            if (task.id !== taskId) return task;

            const parent = task.parentId ? current.find((candidate) => candidate.id === task.parentId) : null;
            const parentId = parent && parent.status === nextStatus ? task.parentId : null;

            return { ...task, status: /** @type {TaskStatus} */ (nextStatus), parentId };
        })
    );
}

/**
 * @param {string} taskId
 * @param {string | null} nextParentId
 */
export function assignParent(taskId, nextParentId) {
    tasks.update((current) => {
        if (!nextParentId) {
            return current.map((task) => task.id === taskId ? { ...task, parentId: null } : task);
        }

        const task = current.find((candidate) => candidate.id === taskId);
        const parent = current.find((candidate) => candidate.id === nextParentId);
        if (!task || !parent || !canAssignParent(current, taskId, nextParentId)) {
            return current;
        }

        return current.map((candidate) =>
            candidate.id === taskId
                ? { ...candidate, parentId: nextParentId, status: parent.status }
                : candidate
        );
    });
}

/**
 * @param {string} taskId
 * @param {Partial<Task>} patch
 */
export function updateTask(taskId, patch) {
    tasks.update((current) =>
        current.map((task) => {
            if (task.id !== taskId) return task;

            const nextTask = { ...task, ...patch };
            if (nextTask.parentId) {
                const parent = current.find((candidate) => candidate.id === nextTask.parentId);
                if (!parent || !canAssignParent(current, taskId, nextTask.parentId)) {
                    nextTask.parentId = null;
                } else if (
                    Object.prototype.hasOwnProperty.call(patch, 'status')
                    && patch.status
                    && patch.status !== parent.status
                ) {
                    // Changing a child's status moves it out of the parent's lane,
                    // so detach it instead of silently snapping the value back.
                    nextTask.parentId = null;
                } else {
                    nextTask.status = parent.status;
                }
            }

            return normalizeTask(nextTask);
        })
    );
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
 * @param {Task[]} taskList
 * @param {string} taskId
 */
function collectDescendantIds(taskList, taskId) {
    const ids = new Set([taskId]);
    let foundNewChild = true;

    while (foundNewChild) {
        foundNewChild = false;
        taskList.forEach((task) => {
            if (task.parentId && ids.has(task.parentId) && !ids.has(task.id)) {
                ids.add(task.id);
                foundNewChild = true;
            }
        });
    }

    return ids;
}

/**
 * @param {string} taskId
 */
export function deleteTaskCascade(taskId) {
    tasks.update((current) => {
        const idsToDelete = collectDescendantIds(current, taskId);
        return current.filter((task) => !idsToDelete.has(task.id));
    });
}

export function clearDoneTasks() {
    tasks.update((current) => {
        const doneIds = new Set(current.filter((task) => task.status === 'done').map((task) => task.id));
        if (doneIds.size === 0) return current;

        return current
            .filter((task) => !doneIds.has(task.id))
            .map((task) => doneIds.has(task.parentId || '') ? { ...task, parentId: null } : task);
    });
}

/**
 * @param {string} taskId
 * @param {string} text
 */
export function addSubtask(taskId, text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    tasks.update((current) =>
        current.map((task) =>
            task.id === taskId
                ? {
                    ...task,
                    subtasks: [...task.subtasks, { id: createId(), text: trimmed, done: false }]
                }
                : task
        )
    );
}

/**
 * @param {string} taskId
 * @param {string} subtaskId
 */
export function toggleSubtask(taskId, subtaskId) {
    tasks.update((current) =>
        current.map((task) =>
            task.id === taskId
                ? {
                    ...task,
                    subtasks: task.subtasks.map((subtask) =>
                        subtask.id === subtaskId ? { ...subtask, done: !subtask.done } : subtask
                    )
                }
                : task
        )
    );
}

/**
 * @param {string} taskId
 * @param {string} subtaskId
 * @param {string} text
 */
export function renameSubtask(taskId, subtaskId, text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    tasks.update((current) =>
        current.map((task) =>
            task.id === taskId
                ? {
                    ...task,
                    subtasks: task.subtasks.map((subtask) =>
                        subtask.id === subtaskId ? { ...subtask, text: trimmed } : subtask
                    )
                }
                : task
        )
    );
}

/**
 * @param {string} taskId
 * @param {string} subtaskId
 */
export function deleteSubtask(taskId, subtaskId) {
    tasks.update((current) =>
        current.map((task) =>
            task.id === taskId
                ? { ...task, subtasks: task.subtasks.filter((subtask) => subtask.id !== subtaskId) }
                : task
        )
    );
}
