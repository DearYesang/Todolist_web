<script>
    import { deleteTaskCascade, getCategoryColor, tasks, updateTask } from './store.js';
    import { fade, fly } from 'svelte/transition';

    let { taskId, onclose } = $props();

    const task = $derived($tasks.find((candidate) => candidate.id === taskId) || null);
    const parentTask = $derived(task?.parentId ? $tasks.find((candidate) => candidate.id === task.parentId) || null : null);
    const childCount = $derived(task ? $tasks.filter((candidate) => candidate.parentId === task.id).length : 0);
    const categoryColor = $derived(task ? getCategoryColor(task.category) : null);

    /**
     * @param {'text' | 'startDate' | 'endDate' | 'priority' | 'urgency' | 'category' | 'status'} field
     * @param {string} value
     */
    function updateField(field, value) {
        updateTask(taskId, { [field]: value });
    }

    function deleteTask() {
        const message = childCount > 0
            ? `이 작업에는 ${childCount}개의 하위 작업이 있습니다.\n모두 함께 삭제하시겠습니까?`
            : '이 작업을 삭제하시겠습니까?';

        if (confirm(message)) {
            deleteTaskCascade(taskId);
            onclose();
        }
    }

    /**
     * @param {KeyboardEvent} event
     */
    function handleDialogKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            onclose();
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
        onclick={onclose}
        onkeydown={(event) => event.key === 'Escape' && onclose()}
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
                <button class="close-btn" onclick={onclose}>✕</button>
            </div>

            <div class="panel-body">
                <div class="summary-row">
                    <span class="summary-chip status-chip {task.status}">{task.status === 'todo' ? '할 일' : task.status === 'doing' ? '진행 중' : '완료'}</span>
                    <span class="summary-chip priority-chip {task.priority}">
                        {task.priority === 'high' ? '🔴 높음' : task.priority === 'medium' ? '🟡 보통' : '🟢 낮음'}
                    </span>
                    <span class="summary-chip urgency-chip {task.urgency}">
                        {task.urgency === 'urgent' ? '🔥 시급' : '⏳ 여유'}
                    </span>
                    {#if task.category && categoryColor}
                        <span class="summary-chip category-chip" style={`background:${categoryColor.bg}; color:${categoryColor.fg}; border-color:${categoryColor.border};`}>
                            {task.category}
                        </span>
                    {/if}
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

                <div class="form-section">
                    <label for="modal-task-text">작업명</label>
                    <input
                        id="modal-task-text"
                        type="text"
                        value={task.text}
                        oninput={(event) => updateField('text', /** @type {HTMLInputElement} */ (event.currentTarget).value)} />
                </div>

                <div class="form-grid">
                    <div class="form-section">
                        <label for="modal-start-date">시작일</label>
                        <input
                            id="modal-start-date"
                            type="date"
                            value={task.startDate}
                            oninput={(event) => updateField('startDate', /** @type {HTMLInputElement} */ (event.currentTarget).value)} />
                    </div>

                    <div class="form-section">
                        <label for="modal-end-date">마감일</label>
                        <input
                            id="modal-end-date"
                            type="date"
                            value={task.endDate}
                            oninput={(event) => updateField('endDate', /** @type {HTMLInputElement} */ (event.currentTarget).value)} />
                    </div>
                </div>

                <div class="form-grid">
                    <div class="form-section">
                        <label for="modal-priority">중요도</label>
                        <select
                            id="modal-priority"
                            value={task.priority}
                            onchange={(event) => updateField('priority', /** @type {HTMLSelectElement} */ (event.currentTarget).value)}>
                            <option value="high">🔴 높음</option>
                            <option value="medium">🟡 보통</option>
                            <option value="low">🟢 낮음</option>
                        </select>
                    </div>

                    <div class="form-section">
                        <label for="modal-urgency">시급성</label>
                        <select
                            id="modal-urgency"
                            value={task.urgency}
                            onchange={(event) => updateField('urgency', /** @type {HTMLSelectElement} */ (event.currentTarget).value)}>
                            <option value="urgent">🔥 시급</option>
                            <option value="normal">⏳ 여유</option>
                        </select>
                    </div>
                </div>

                <div class="form-grid">
                    <div class="form-section">
                        <label for="modal-category">카테고리</label>
                        <input
                            id="modal-category"
                            type="text"
                            value={task.category}
                            placeholder="예: 개발, 기획"
                            oninput={(event) => updateField('category', /** @type {HTMLInputElement} */ (event.currentTarget).value)} />
                    </div>

                    <div class="form-section">
                        <label for="modal-status">상태</label>
                        <select
                            id="modal-status"
                            value={task.status}
                            onchange={(event) => updateField('status', /** @type {HTMLSelectElement} */ (event.currentTarget).value)}>
                            <option value="todo">할 일</option>
                            <option value="doing">진행 중</option>
                            <option value="done">완료</option>
                        </select>
                        {#if parentTask}
                            <small class="field-hint">상태를 바꾸면 상위 작업에서 분리됩니다.</small>
                        {/if}
                    </div>
                </div>
            </div>

            <div class="panel-footer">
                <button class="btn btn-danger" onclick={deleteTask}>🗑️ 작업 삭제</button>
                <button class="btn btn-primary" onclick={onclose}>완료</button>
            </div>
        </div>
    </div>
{/if}
