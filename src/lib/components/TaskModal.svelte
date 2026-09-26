<script>
    import { assignTaskCategory, categories, deleteTaskCascade, taskIndex, updateTask } from '$lib/client/task-store.js';
    import { downloadTaskCalendar } from '$lib/client/calendar-download.js';
    import {
        getDeleteTaskConfirmMessage,
        PRIORITY_LABELS,
        STATUS_LABELS,
        URGENCY_LABELS
    } from '$lib/shared/task-domain.js';
    import { fade, fly } from 'svelte/transition';
    import CategoryInput from './CategoryInput.svelte';
    import DateRangePicker from './DateRangePicker.svelte';
    import TaskBadges from './task/TaskBadges.svelte';
    import TaskLinkActions from './task/TaskLinkActions.svelte';

    /** @type {{ taskId: string; onclose: () => void }} */
    let { taskId, onclose } = $props();

    const task = $derived($taskIndex.byId.get(taskId) ?? null);
    const parentTask = $derived(task?.parentId ? $taskIndex.byId.get(task.parentId) ?? null : null);
    const childCount = $derived(task ? $taskIndex.childrenByParentId.get(task.id)?.length ?? 0 : 0);

    /**
     * The category is not one of these fields: it goes through
     * assignTaskCategory, which also moves categoryId and categoryMeta.
     * @param {'text' | 'startDate' | 'endDate' | 'priority' | 'urgency' | 'status'} field
     * @param {string} value
     */
    function updateField(field, value) {
        updateTask(taskId, { [field]: value });
    }

    function deleteTask() {
        if (confirm(getDeleteTaskConfirmMessage(childCount))) {
            deleteTaskCascade(taskId);
            onclose();
        }
    }

    function downloadCalendar() {
        if (!task) return;
        downloadTaskCalendar(task);
    }

    /**
     * @param {{ startDate: string; endDate: string }} range
     */
    function updateDateRange(range) {
        updateTask(taskId, range);
    }

    /**
     * @param {string} name
     */
    function commitCategory(name) {
        assignTaskCategory(taskId, name);
    }

    /**
     * Leaves the focused field before closing. The category saves on its
     * native change event, which fires on blur; unmounting a focused field
     * (Escape closes the panel with the focus still in it) fires none, and
     * the typed name would be lost.
     */
    function closePanel() {
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }
        onclose();
    }

    /**
     * @param {KeyboardEvent} event
     */
    function handleDialogKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            closePanel();
            return;
        }

        event.stopPropagation();
    }
</script>

{#if task}
    <div
        class="modal-backdrop"
        role="button"
        tabindex="-1"
        onclick={closePanel}
        onkeydown={(event) => event.key === 'Escape' && closePanel()}
        transition:fade={{ duration: 180 }}>
        <div
            class="side-panel"
            role="dialog"
            aria-modal="true"
            tabindex="0"
            onclick={(event) => event.stopPropagation()}
            onkeydown={handleDialogKeydown}
            transition:fly={{ x: 320, duration: 260 }}>
            <div class="panel-header">
                <div>
                    <p class="panel-eyebrow">작업 상세 정보</p>
                    <h2>{task.text || '새 작업'}</h2>
                </div>
                <button class="close-btn" onclick={closePanel}>✕</button>
            </div>

            <div class="panel-body">
                <div class="summary-row">
                    <span class="summary-chip status-chip {task.status}">{STATUS_LABELS[task.status]}</span>
                    <TaskBadges task={task} variant="summary" />
                </div>

                {#if parentTask || childCount > 0}
                    <div class="meta-panel">
                        {#if parentTask}
                            <div class="meta-line">
                                <span class="meta-label">상위 작업</span>
                                <span class="meta-value">{parentTask.text}</span>
                            </div>
                        {/if}
                        {#if childCount > 0}
                            <div class="meta-line">
                                <span class="meta-label">하위 작업</span>
                                <span class="meta-value">{childCount}개</span>
                            </div>
                        {/if}
                    </div>
                {/if}

                <!-- In the body, not the footer: the footer has no room on the
                     440px side panel and stacks every button on phones. -->
                <TaskLinkActions task={task} show="both" />

                <div class="form-section">
                    <label for="modal-task-text">작업명</label>
                    <input
                        id="modal-task-text"
                        type="text"
                        value={task.text}
                        oninput={(event) => updateField('text', /** @type {HTMLInputElement} */ (event.currentTarget).value)} />
                </div>

                <div class="form-section">
                    <label for="modal-date-start-date">일정</label>
                    <DateRangePicker
                        idPrefix="modal-date"
                        startDate={task.startDate}
                        endDate={task.endDate}
                        onchange={updateDateRange} />
                </div>

                <div class="form-grid">
                    <div class="form-section">
                        <label for="modal-priority">중요도</label>
                        <select
                            id="modal-priority"
                            value={task.priority}
                            onchange={(event) => updateField('priority', /** @type {HTMLSelectElement} */ (event.currentTarget).value)}>
                            <option value="high">{PRIORITY_LABELS.high}</option>
                            <option value="medium">{PRIORITY_LABELS.medium}</option>
                            <option value="low">{PRIORITY_LABELS.low}</option>
                        </select>
                    </div>

                    <div class="form-section">
                        <label for="modal-urgency">시급성</label>
                        <select
                            id="modal-urgency"
                            value={task.urgency}
                            onchange={(event) => updateField('urgency', /** @type {HTMLSelectElement} */ (event.currentTarget).value)}>
                            <option value="urgent">{URGENCY_LABELS.urgent}</option>
                            <option value="normal">{URGENCY_LABELS.normal}</option>
                        </select>
                    </div>
                </div>

                <div class="form-grid">
                    <div class="form-section">
                        <label for="modal-category">카테고리</label>
                        <!-- One-way value: the field keeps what is typed and saves it on
                             commit. The key resets it when the panel shows another task. -->
                        {#key taskId}
                            <CategoryInput
                                id="modal-category"
                                value={task.category}
                                categories={$categories}
                                parentCategory={parentTask?.category ?? ''}
                                taskText={task.text}
                                placeholder="예: 개발, 기획"
                                oncommit={commitCategory} />
                        {/key}
                    </div>

                    <div class="form-section">
                        <label for="modal-status">상태</label>
                        <select
                            id="modal-status"
                            value={task.status}
                            onchange={(event) => updateField('status', /** @type {HTMLSelectElement} */ (event.currentTarget).value)}>
                            <option value="todo">{STATUS_LABELS.todo}</option>
                            <option value="doing">{STATUS_LABELS.doing}</option>
                            <option value="done">{STATUS_LABELS.done}</option>
                        </select>
                        {#if parentTask}
                            <small class="field-hint">상태를 바꾸면 상위 작업에서 분리됩니다.</small>
                        {/if}
                    </div>
                </div>
            </div>

            <div class="panel-footer">
                <button class="btn btn-danger" onclick={deleteTask}>🗑️ 작업 삭제</button>
                <div class="panel-footer-actions">
                    <button class="btn btn-calendar" onclick={downloadCalendar}>📅 일정 추가(.ics)</button>
                    <button class="btn btn-primary" onclick={closePanel}>완료</button>
                </div>
            </div>
        </div>
    </div>
{/if}
