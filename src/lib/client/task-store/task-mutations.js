import { get } from 'svelte/store';
import {
    addSubtaskToList,
    assignParentInList,
    clearDoneTasksFromList,
    deleteSubtaskFromList,
    deleteTaskCascadeFromList,
    moveTaskInList,
    normalizeTaskList,
    renameSubtaskInList,
    toggleSubtaskInList,
    updateTaskInList
} from '../../shared/task-domain.js';
import { createServerTask, importServerTasks } from '../task-api.js';
import { enqueueOfflineMutation } from '../offline-write-queue.js';
import { insertTask, replaceTasks, tasks } from './task-cache.js';
import { resetFilters } from './filters.js';
import { buildTaskCreateDraft, createLocalTaskFromDraft } from './task-create.js';
import {
    syncChecklistCreate,
    syncChecklistDelete,
    syncChecklistPatch,
    syncClearDoneTasks,
    syncTaskDelete,
    syncTaskSnapshot
} from './sync-engine.js';

/**
 * @param {string} taskId
 * @param {string} nextStatus
 */
export function moveTask(taskId, nextStatus) {
    /** @type {import('../../shared/task-domain.js').Task | null} */
    let syncedTask = null;
    /** @type {import('../../shared/task-domain.js').Task | null} */
    let previousTask = null;
    tasks.update((current) => {
        previousTask = current.find((task) => task.id === taskId) ?? null;
        const next = moveTaskInList(current, taskId, nextStatus);
        syncedTask = next.find((task) => task.id === taskId) ?? null;
        return next;
    });
    syncTaskSnapshot(syncedTask, previousTask);
}

/**
 * @param {string} taskId
 * @param {string | null} nextParentId
 */
export function assignParent(taskId, nextParentId) {
    /** @type {import('../../shared/task-domain.js').Task | null} */
    let syncedTask = null;
    /** @type {import('../../shared/task-domain.js').Task | null} */
    let previousTask = null;
    tasks.update((current) => {
        previousTask = current.find((task) => task.id === taskId) ?? null;
        const next = assignParentInList(current, taskId, nextParentId);
        syncedTask = next.find((task) => task.id === taskId) ?? null;
        return next;
    });
    syncTaskSnapshot(syncedTask, previousTask);
}

/**
 * @param {string} taskId
 * @param {Partial<import('../../shared/task-domain.js').Task>} patch
 */
export function updateTask(taskId, patch) {
    /** @type {import('../../shared/task-domain.js').Task | null} */
    let syncedTask = null;
    /** @type {import('../../shared/task-domain.js').Task | null} */
    let previousTask = null;
    tasks.update((current) => {
        previousTask = current.find((task) => task.id === taskId) ?? null;
        const next = updateTaskInList(current, taskId, patch);
        syncedTask = next.find((task) => task.id === taskId) ?? null;
        return next;
    });
    syncTaskSnapshot(syncedTask, previousTask);
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
    /** @type {import('../../shared/task-domain.js').Task | null} */
    let deletedTask = null;
    tasks.update((current) => {
        deletedTask = current.find((task) => task.id === taskId) ?? null;
        return deleteTaskCascadeFromList(current, taskId);
    });
    syncTaskDelete(taskId, deletedTask);
}

export function clearDoneTasks() {
    /** @type {import('../../shared/task-domain.js').Task[]} */
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

const CREATE_FAILED_MESSAGE = '작업을 추가하지 못했습니다. 입력값을 확인해 주세요.';

/**
 * The fields of the add-task form. parentId is null for a top-level task.
 * @typedef {{
 *   text: string;
 *   priority: import('../../shared/task-domain.js').TaskPriority;
 *   urgency: import('../../shared/task-domain.js').TaskUrgency;
 *   category: string;
 *   startDate: string;
 *   endDate: string;
 *   parentId: string | null;
 * }} TaskFormValues
 *
 * @typedef {{ ok: true; task: import('../../shared/task-domain.js').Task } | { ok: false; message: string }} CreateTaskResult
 *
 * @typedef {{ ok: true; queued: false; summary: import('../task-api.js').TaskImportSummary }
 *   | { ok: true; queued: true }
 *   | { ok: false; message: string }} ImportTasksResult
 */

/**
 * Adds a task from the add-task form. Unless its parent exists only on this
 * device, the server creates the task first and the board adds the task the
 * server returns. When the server cannot be reached (no answer, or a status
 * task-api treats as a fallback), or the parent is local, the task is made on
 * this device and its create is queued for the next sync. Any other refusal
 * adds nothing. A blank title adds nothing either.
 * @param {TaskFormValues} values
 * @returns {Promise<CreateTaskResult>}
 */
export async function createTask(values) {
    const parent = values.parentId ? get(tasks).find((task) => task.id === values.parentId) ?? null : null;
    const draft = buildTaskCreateDraft({
        text: values.text,
        priority: values.priority,
        urgency: values.urgency,
        category: values.category,
        startDate: values.startDate,
        endDate: values.endDate,
        parent
    });

    if (!draft) {
        return { ok: false, message: CREATE_FAILED_MESSAGE };
    }

    if (!draft.hasLocalParent) {
        const result = await createServerTask(draft.payload);
        if (result.ok) {
            insertTask(result.task);
            return { ok: true, task: result.task };
        }

        if (!result.fallback) {
            return { ok: false, message: CREATE_FAILED_MESSAGE };
        }
    }

    const localTask = createLocalTaskFromDraft(draft.payload, draft.parent);
    insertTask(localTask);
    enqueueOfflineMutation({
        type: 'task.create',
        localTaskId: localTask.id,
        localParentId: draft.hasLocalParent ? draft.parent?.id ?? null : null,
        payload: draft.payload
    });
    return { ok: true, task: localTask };
}

/**
 * Imports the task list of a backup file. `replace` swaps the board for the
 * imported tasks and `append` adds them after the tasks already there. The
 * server imports first and the board takes the tasks it returns. When the
 * server cannot be reached, the file's tasks land on this device and the
 * import is queued for the next sync. Both reset the filters, so every
 * imported task shows. Any other refusal leaves the board alone.
 * @param {unknown[]} parsedTasks
 * @param {'append' | 'replace'} mode
 * @returns {Promise<ImportTasksResult>}
 */
export async function importTasks(parsedTasks, mode) {
    const result = await importServerTasks(parsedTasks, { mode });
    if (result.ok) {
        replaceTasks(mode === 'replace' ? result.tasks : [...get(tasks), ...result.tasks]);
        resetFilters();
        return { ok: true, queued: false, summary: result.summary };
    }

    if (result.fallback) {
        const fallbackTasks = normalizeTaskList(parsedTasks);
        enqueueOfflineMutation({
            type: 'import.tasks',
            mode,
            payload: parsedTasks,
            localTaskIds: fallbackTasks.map((task) => task.id)
        });
        replaceTasks(mode === 'replace' ? fallbackTasks : [...get(tasks), ...fallbackTasks]);
        resetFilters();
        return { ok: true, queued: true };
    }

    return { ok: false, message: result.message };
}
