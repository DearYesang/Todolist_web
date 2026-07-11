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
 *   name: string;
 *   color: string | null;
 *   sortOrder: number;
 *   hiddenAt: string | null;
 *   archivedAt: string | null;
 * }} TaskCategoryMeta
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
 *   categoryId?: string | null;
 *   categoryMeta?: TaskCategoryMeta | null;
 *   parentId: string | null;
 *   subtasks: Subtask[];
 *   collapsed: boolean;
 *   createdAt: number;
 *   version?: number;
 * }} Task
 *
 * @typedef {{
 *   priority: PriorityFilter;
 *   urgency: UrgencyFilter;
 *   category: string;
 *   categoryId: string;
 *   search?: string;
 * }} TaskFilters
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const MAX_TASK_SPAN_DAYS = 3650;

export const DEFAULT_FILTERS = Object.freeze({
    priority: 'all',
    urgency: 'all',
    category: 'all',
    categoryId: 'all',
    search: ''
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
 * @param {number} value
 */
function padDatePart(value) {
    return `${value}`.padStart(2, '0');
}

/**
 * @param {Date} date
 */
function formatLocalDate(date) {
    return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

/**
 * @returns {{ startDate: string; endDate: string }}
 */
export function getDefaultDateRange() {
    const start = new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + 2);

    return {
        startDate: formatLocalDate(start),
        endDate: formatLocalDate(end)
    };
}

/**
 * @returns {string}
 */
export function createId() {
    return `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * @param {unknown} value
 * @returns {value is TaskStatus}
 */
export function isTaskStatus(value) {
    return value === 'todo' || value === 'doing' || value === 'done';
}

/**
 * @param {unknown} value
 * @returns {value is TaskPriority}
 */
function isTaskPriority(value) {
    return value === 'high' || value === 'medium' || value === 'low';
}

/**
 * @param {unknown} value
 * @returns {value is TaskUrgency}
 */
function isTaskUrgency(value) {
    return value === 'urgent' || value === 'normal';
}

/**
 * @param {string} value
 * @returns {Date | null}
 */
function parseDateString(value) {
    if (!DATE_PATTERN.test(value)) return null;

    const [year, month, day] = value.split('-').map(Number);
    if (year < MIN_YEAR || year > MAX_YEAR) return null;

    const date = new Date(year, month - 1, day);
    if (
        date.getFullYear() !== year
        || date.getMonth() !== month - 1
        || date.getDate() !== day
    ) {
        return null;
    }

    return date;
}

/**
 * @param {string} dateString
 * @param {number} offset
 */
function addDaysToDateString(dateString, offset) {
    const date = parseDateString(dateString);
    if (!date) return dateString;

    date.setDate(date.getDate() + offset);
    return formatLocalDate(date);
}

/**
 * @param {unknown} rawStartDate
 * @param {unknown} rawEndDate
 * @returns {{ startDate: string; endDate: string }}
 */
export function normalizeDateRange(rawStartDate, rawEndDate) {
    const defaults = getDefaultDateRange();
    const startDate = typeof rawStartDate === 'string' && parseDateString(rawStartDate)
        ? rawStartDate
        : defaults.startDate;
    let endDate = typeof rawEndDate === 'string' && parseDateString(rawEndDate)
        ? rawEndDate
        : defaults.endDate;

    const start = parseDateString(startDate);
    let end = parseDateString(endDate);
    if (!start || !end) return defaults;

    if (end.getTime() < start.getTime()) {
        endDate = startDate;
        end = start;
    }

    const spanDays = Math.round((end.getTime() - start.getTime()) / 86400000);
    if (spanDays > MAX_TASK_SPAN_DAYS) {
        endDate = addDaysToDateString(startDate, MAX_TASK_SPAN_DAYS);
    }

    return { startDate, endDate };
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
 * @param {unknown[]} subtasksRaw
 * @returns {Subtask[]}
 */
function normalizeSubtasks(subtasksRaw) {
    const usedIds = new Set();

    return subtasksRaw.map((item, index) => {
        const subtask = normalizeSubtask(item, index);
        let id = subtask.id;
        while (usedIds.has(id)) {
            id = `${createId()}-${index}`;
        }
        usedIds.add(id);

        return id === subtask.id ? subtask : { ...subtask, id };
    });
}

/**
 * @param {unknown} raw
 * @returns {Task}
 */
export function normalizeTask(raw) {
    const source = /** @type {Record<string, unknown> | null | undefined} */ (raw);
    const subtasksRaw = Array.isArray(source?.subtasks) ? source.subtasks : [];
    const { startDate, endDate } = normalizeDateRange(source?.startDate, source?.endDate);
    const categoryMeta = normalizeCategoryMeta(source?.categoryMeta);
    const rawCategory = typeof source?.category === 'string' ? source.category.trim() : '';
    const category = categoryMeta?.name ?? rawCategory;
    const version = parseTaskVersion(source?.version);
    const priority = isTaskPriority(source?.priority)
        ? source.priority
        : 'medium';
    const urgency = isTaskUrgency(source?.urgency)
        ? source.urgency
        : 'normal';
    const status = isTaskStatus(source?.status)
        ? source.status
        : 'todo';

    return {
        id: typeof source?.id === 'string' && source.id ? source.id : createId(),
        text: typeof source?.text === 'string' ? source.text : '',
        status,
        startDate,
        endDate,
        priority,
        urgency,
        category,
        categoryId: parseNullableId(source?.categoryId) ?? categoryMeta?.id ?? null,
        categoryMeta,
        parentId: typeof source?.parentId === 'string' && source.parentId ? source.parentId : null,
        subtasks: normalizeSubtasks(subtasksRaw),
        collapsed: Boolean(source?.collapsed),
        createdAt: typeof source?.createdAt === 'number' && Number.isFinite(source.createdAt) ? source.createdAt : Date.now(),
        ...(version === null ? {} : { version })
    };
}

/**
 * @param {unknown} raw
 * @returns {TaskCategoryMeta | null}
 */
function normalizeCategoryMeta(raw) {
    const source = /** @type {Record<string, unknown> | null | undefined} */ (raw);
    const id = parseNullableId(source?.id);
    const name = typeof source?.name === 'string' ? source.name.trim() : '';
    if (!id || !name) {
        return null;
    }

    return {
        id,
        name,
        color: typeof source?.color === 'string' && source.color.trim() ? source.color.trim() : null,
        sortOrder: typeof source?.sortOrder === 'number' && Number.isFinite(source.sortOrder) ? source.sortOrder : 0,
        hiddenAt: typeof source?.hiddenAt === 'string' && source.hiddenAt ? source.hiddenAt : null,
        archivedAt: typeof source?.archivedAt === 'string' && source.archivedAt ? source.archivedAt : null
    };
}

/**
 * @param {unknown} value
 */
function parseNullableId(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 */
function parseTaskVersion(value) {
	return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * @param {Task[]} taskList
 * @param {Task} task
 */
function hasParentCycle(taskList, task) {
    if (!task.parentId) return false;

    const byId = new Map(taskList.map((item) => [item.id, item]));
    const visited = new Set([task.id]);
    /** @type {string | null} */
    let parentId = task.parentId;

    while (parentId) {
        if (visited.has(parentId)) return true;
        visited.add(parentId);

        const parent = byId.get(parentId);
        if (!parent) return false;
        parentId = parent.parentId;
    }

    return false;
}

/**
 * @param {unknown[]} rawTasks
 * @returns {Task[]}
 */
export function normalizeTaskList(rawTasks) {
    const usedIds = new Set();
    const normalized = rawTasks.map((item, index) => {
        const task = normalizeTask(item);
        let id = task.id;
        while (usedIds.has(id)) {
            id = `${createId()}-${index}`;
        }
        usedIds.add(id);

        return id === task.id ? task : { ...task, id };
    });

    const ids = new Set(normalized.map((task) => task.id));
    const existingParentsOnly = normalized.map((task) =>
        task.parentId && ids.has(task.parentId) && task.parentId !== task.id
            ? task
            : { ...task, parentId: null }
    );

    const acyclic = existingParentsOnly.map((task) =>
        hasParentCycle(existingParentsOnly, task)
            ? { ...task, parentId: null }
            : task
    );

    const byId = new Map(acyclic.map((task) => [task.id, task]));
    /** @type {Map<string, TaskStatus>} */
    const statusCache = new Map();
    /**
     * @param {Task} task
     * @returns {TaskStatus}
     */
    function getEffectiveStatus(task) {
        const cached = statusCache.get(task.id);
        if (cached) return cached;

        const parent = task.parentId ? byId.get(task.parentId) : null;
        const status = parent ? getEffectiveStatus(parent) : task.status;
        statusCache.set(task.id, status);
        return status;
    }

    return acyclic.map((task) => {
        const status = getEffectiveStatus(task);
        return task.status !== status
            ? { ...task, status }
            : task;
    });
}

/**
 * @param {string} category
 * @param {string | null | undefined} [customColor]
 */
export function getCategoryColor(category, customColor = null) {
    if (isHexColor(customColor)) {
        return {
            bg: hexToRgba(customColor, 0.15),
            fg: customColor,
            border: customColor
        };
    }

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
 * @param {unknown} value
 * @returns {value is string}
 */
function isHexColor(value) {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

/**
 * @param {string} hex
 * @param {number} alpha
 */
function hexToRgba(hex, alpha) {
    const value = hex.replace('#', '');
    const red = Number.parseInt(value.slice(0, 2), 16);
    const green = Number.parseInt(value.slice(2, 4), 16);
    const blue = Number.parseInt(value.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/**
 * @param {Task} task
 * @param {TaskFilters} activeFilters
 */
export function matchesFilters(task, activeFilters) {
    if (activeFilters.priority !== 'all' && task.priority !== activeFilters.priority) return false;
    if (activeFilters.urgency !== 'all' && task.urgency !== activeFilters.urgency) return false;
    // The search check must run before the categoryId branch below, which
    // returns early and would otherwise bypass it.
    if (!matchesSearch(task, activeFilters.search)) return false;
    if (activeFilters.categoryId && activeFilters.categoryId !== 'all') return task.categoryId === activeFilters.categoryId;
    if (activeFilters.category !== 'all' && task.category !== activeFilters.category) return false;
    return true;
}

/**
 * @param {Task} task
 * @param {string | undefined} search
 */
function matchesSearch(task, search) {
    const query = (search ?? '').trim().toLocaleLowerCase('ko');
    if (!query) return true;

    const haystacks = [task.text, task.category, ...task.subtasks.map((subtask) => subtask.text)];
    return haystacks.some((value) => value && value.toLocaleLowerCase('ko').includes(query));
}

/**
 * Classifies a task's schedule urgency for display. Done tasks never count.
 * @param {Task} task
 * @param {string} [today] YYYY-MM-DD; defaults to the local calendar date
 * @returns {'overdue' | 'due-today' | null}
 */
export function getTaskDueStatus(task, today = getLocalDateString()) {
    if (task.status === 'done' || !DATE_PATTERN.test(task.endDate)) {
        return null;
    }

    if (task.endDate < today) return 'overdue';
    if (task.endDate === today) return 'due-today';
    return null;
}

function getLocalDateString() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * @typedef {{ importance: 'important' | 'less-important'; urgency: TaskUrgency }} EisenhowerQuadrantSpec
 */

/**
 * @param {Task} task
 * @param {EisenhowerQuadrantSpec} quadrant
 */
export function isTaskInEisenhowerQuadrant(task, quadrant) {
    const isImportant = task.priority === 'high';
    const matchesImportance = quadrant.importance === 'important' ? isImportant : !isImportant;
    return matchesImportance && task.urgency === quadrant.urgency;
}

/**
 * Patch for dropping a task into an Eisenhower quadrant, or null when the
 * drop is a no-op. Moving into the task's own quadrant must not rewrite
 * fields (spurious version bumps become fake sync conflicts), and demotion
 * out of the important half only lowers 'high' — medium/low survive a round
 * trip through an important quadrant unchanged on that axis.
 * @param {Task} task
 * @param {EisenhowerQuadrantSpec} quadrant
 * @returns {{ priority: TaskPriority; urgency: TaskUrgency } | null}
 */
export function resolveEisenhowerMove(task, quadrant) {
    if (isTaskInEisenhowerQuadrant(task, quadrant)) {
        return null;
    }

    return {
        priority: quadrant.importance === 'important'
            ? 'high'
            : task.priority === 'high'
                ? 'medium'
                : task.priority,
        urgency: quadrant.urgency
    };
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
 * @param {string} taskIdToBecomeParent
 */
export function canAssignParent(taskList, taskId, taskIdToBecomeParent) {
    if (taskId === taskIdToBecomeParent) return false;

    let current = taskList.find((task) => task.id === taskIdToBecomeParent) || null;
    const visited = new Set();
    while (current) {
        if (visited.has(current.id)) return false;
        visited.add(current.id);

        if (current.parentId === taskId) return false;

        const nextParentId = current.parentId;
        current = nextParentId ? taskList.find((task) => task.id === nextParentId) || null : null;
    }

    return true;
}

/**
 * @param {Task[]} taskList
 * @param {string} taskId
 * @param {string} nextStatus
 */
export function moveTaskInList(taskList, taskId, nextStatus) {
    if (!isTaskStatus(nextStatus)) return taskList;

    return taskList.map((task) => {
        if (task.id !== taskId) return task;

        const parent = task.parentId ? taskList.find((candidate) => candidate.id === task.parentId) : null;
        const parentId = parent && parent.status === nextStatus ? task.parentId : null;

        return { ...task, status: nextStatus, parentId };
    });
}

/**
 * @param {Task[]} taskList
 * @param {string} taskId
 * @param {string | null} nextParentId
 */
export function assignParentInList(taskList, taskId, nextParentId) {
    if (!nextParentId) {
        return taskList.map((task) => task.id === taskId ? { ...task, parentId: null } : task);
    }

    const task = taskList.find((candidate) => candidate.id === taskId);
    const parent = taskList.find((candidate) => candidate.id === nextParentId);
    if (!task || !parent || !canAssignParent(taskList, taskId, nextParentId)) {
        return taskList;
    }

    return taskList.map((candidate) =>
        candidate.id === taskId
            ? { ...candidate, parentId: nextParentId, status: parent.status }
            : candidate
    );
}

/**
 * @param {Task[]} taskList
 * @param {string} taskId
 * @param {Partial<Task>} patch
 */
export function updateTaskInList(taskList, taskId, patch) {
    return taskList.map((task) => {
        if (task.id !== taskId) return task;

        const nextTask = { ...task, ...patch };
        if (nextTask.parentId) {
            const parent = taskList.find((candidate) => candidate.id === nextTask.parentId);
            if (!parent || !canAssignParent(taskList, taskId, nextTask.parentId)) {
                nextTask.parentId = null;
            } else if (
                Object.prototype.hasOwnProperty.call(patch, 'status')
                && patch.status
                && patch.status !== parent.status
            ) {
                nextTask.parentId = null;
            } else {
                nextTask.status = parent.status;
            }
        }

        return normalizeTask(nextTask);
    });
}

/**
 * @param {Task[]} taskList
 * @param {string} taskId
 */
export function collectDescendantIds(taskList, taskId) {
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
 * @param {Task[]} taskList
 * @param {string} taskId
 */
export function deleteTaskCascadeFromList(taskList, taskId) {
    const idsToDelete = collectDescendantIds(taskList, taskId);
    return taskList.filter((task) => !idsToDelete.has(task.id));
}

/**
 * @param {Task[]} taskList
 */
export function clearDoneTasksFromList(taskList) {
    const doneIds = new Set(taskList.filter((task) => task.status === 'done').map((task) => task.id));
    if (doneIds.size === 0) return taskList;

    return taskList
        .filter((task) => !doneIds.has(task.id))
        .map((task) => doneIds.has(task.parentId || '') ? { ...task, parentId: null } : task);
}

/**
 * @param {Task[]} taskList
 * @param {string} taskId
 * @param {string} text
 */
export function addSubtaskToList(taskList, taskId, text) {
    const trimmed = text.trim();
    if (!trimmed) return taskList;

    return taskList.map((task) =>
        task.id === taskId
            ? { ...task, subtasks: [...task.subtasks, { id: createId(), text: trimmed, done: false }] }
            : task
    );
}

/**
 * @param {Task[]} taskList
 * @param {string} taskId
 * @param {string} subtaskId
 */
export function toggleSubtaskInList(taskList, taskId, subtaskId) {
    return taskList.map((task) =>
        task.id === taskId
            ? {
                ...task,
                subtasks: task.subtasks.map((subtask) =>
                    subtask.id === subtaskId ? { ...subtask, done: !subtask.done } : subtask
                )
            }
            : task
    );
}

/**
 * @param {Task[]} taskList
 * @param {string} taskId
 * @param {string} subtaskId
 * @param {string} text
 */
export function renameSubtaskInList(taskList, taskId, subtaskId, text) {
    const trimmed = text.trim();
    if (!trimmed) return taskList;

    return taskList.map((task) =>
        task.id === taskId
            ? {
                ...task,
                subtasks: task.subtasks.map((subtask) =>
                    subtask.id === subtaskId ? { ...subtask, text: trimmed } : subtask
                )
            }
            : task
    );
}

/**
 * @param {Task[]} taskList
 * @param {string} taskId
 * @param {string} subtaskId
 */
export function deleteSubtaskFromList(taskList, taskId, subtaskId) {
    return taskList.map((task) =>
        task.id === taskId
            ? { ...task, subtasks: task.subtasks.filter((subtask) => subtask.id !== subtaskId) }
            : task
    );
}
