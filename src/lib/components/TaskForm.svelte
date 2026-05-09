<script>
    import { get } from 'svelte/store';
    import { createServerTask } from '$lib/client/task-api.js';
    import { buildTaskCreateDraft, createLocalTaskFromDraft } from '$lib/client/task-create.js';
    import { enqueueOfflineMutation } from '$lib/client/offline-write-queue.js';
    import { categories, tasks } from '$lib/client/task-store.js';
    import { shouldIgnoreImeSubmit } from '$lib/client/ime-keyboard.js';
    import { getDefaultDateRange, PRIORITY_LABELS, URGENCY_LABELS } from '$lib/shared/task-domain.js';
    import CategoryInput from './CategoryInput.svelte';
    import DateRangePicker from './DateRangePicker.svelte';

    let isFormOpen = $state(false);
    let newTaskText = $state('');
    /** @type {import('$lib/shared/task-domain.js').TaskPriority} */
    let selectedPriority = $state('medium');
    /** @type {import('$lib/shared/task-domain.js').TaskUrgency} */
    let selectedUrgency = $state('normal');
    let category = $state('');
    let parentId = $state('');
    let isSubmitting = $state(false);
    let formError = $state('');
    let isTaskTextComposing = $state(false);
    let didTaskTextCompositionJustEnd = $state(false);
    /** @type {ReturnType<typeof setTimeout> | null} */
    let taskTextCompositionResetTimer = null;

    const defaults = getDefaultDateRange();
    let startDate = $state(defaults.startDate);
    let endDate = $state(defaults.endDate);
    const selectedParent = $derived(parentId ? $tasks.find((task) => task.id === parentId) ?? null : null);

    $effect(() => {
        if (!category && selectedParent?.category) {
            category = selectedParent.category;
        }
    });

    function resetForm() {
        const range = getDefaultDateRange();
        newTaskText = '';
        selectedPriority = 'medium';
        selectedUrgency = 'normal';
        category = '';
        parentId = '';
        startDate = range.startDate;
        endDate = range.endDate;
        isSubmitting = false;
        formError = '';
        isFormOpen = false;
        didTaskTextCompositionJustEnd = false;
        isTaskTextComposing = false;
        clearTaskTextCompositionReset();
    }

    /**
     * @param {import('$lib/shared/task-domain.js').Task} task
     */
    function appendTask(task) {
        tasks.update((current) => [...current, task]);
    }

    async function addTask() {
        if (isSubmitting) return;

        const currentTasks = get(tasks);
        const parent = parentId ? currentTasks.find((task) => task.id === parentId) ?? null : null;
        const draft = buildTaskCreateDraft({
            text: newTaskText,
            priority: selectedPriority,
            urgency: selectedUrgency,
            category,
            startDate,
            endDate,
            parent
        });

        if (!draft) return;

        formError = '';
        isSubmitting = true;

        try {
            if (!draft.hasLocalParent) {
                const result = await createServerTask(draft.payload);
                if (result.ok) {
                    appendTask(result.task);
                    resetForm();
                    return;
                }

                if (!result.fallback) {
                    formError = '작업을 추가하지 못했습니다. 입력값을 확인해 주세요.';
                    return;
                }
            }

            const localTask = createLocalTaskFromDraft(draft.payload, draft.parent);
            appendTask(localTask);
            enqueueOfflineMutation({
                type: 'task.create',
                localTaskId: localTask.id,
                localParentId: draft.hasLocalParent ? draft.parent?.id ?? null : null,
                payload: draft.payload
            });
            resetForm();
        } finally {
            isSubmitting = false;
        }
    }

    /**
     * @param {KeyboardEvent} event
     */
    function handleTaskInputKeydown(event) {
        if (event.key !== 'Enter') {
            return;
        }

        if (shouldIgnoreImeSubmit(event, {
            isComposing: isTaskTextComposing,
            justEnded: didTaskTextCompositionJustEnd
        })) {
            return;
        }

        event.preventDefault();
        void addTask();
    }

    function handleTaskTextCompositionStart() {
        isTaskTextComposing = true;
        didTaskTextCompositionJustEnd = false;
        clearTaskTextCompositionReset();
    }

    /**
     * @param {CompositionEvent} event
     */
    function handleTaskTextCompositionEnd(event) {
        isTaskTextComposing = false;
        didTaskTextCompositionJustEnd = true;
        newTaskText = /** @type {HTMLInputElement} */ (event.currentTarget).value;
        clearTaskTextCompositionReset();
        taskTextCompositionResetTimer = setTimeout(() => {
            didTaskTextCompositionJustEnd = false;
            taskTextCompositionResetTimer = null;
        }, 0);
    }

    function clearTaskTextCompositionReset() {
        if (!taskTextCompositionResetTimer) return;
        clearTimeout(taskTextCompositionResetTimer);
        taskTextCompositionResetTimer = null;
    }
</script>

<div class="add-panel" class:open={isFormOpen}>
    <button class="add-toggle" class:active={isFormOpen} onclick={() => isFormOpen = !isFormOpen}>
        {isFormOpen ? '－ 닫기' : '＋ 새 작업 추가...'}
    </button>

    {#if isFormOpen}
        <div class="add-form active">
            <div class="form-grid">
                <div class="form-row form-row-stretch">
                    <label class="form-label" for="task-text">작업명</label>
                    <input
                        id="task-text"
                        class="form-input"
                        type="text"
                        bind:value={newTaskText}
                        placeholder="무엇을 해야 하나요?"
                        oncompositionstart={handleTaskTextCompositionStart}
                        oncompositionend={handleTaskTextCompositionEnd}
                        onkeydown={handleTaskInputKeydown} />
                </div>

                <div class="form-row">
                    <label class="form-label" for="parent-id">상위 작업</label>
                    <select id="parent-id" class="form-select" bind:value={parentId}>
                        <option value="">없음 (최상위)</option>
                        {#each $tasks as task (task.id)}
                            <option value={task.id}>
                                {task.status === 'todo' ? '📋' : task.status === 'doing' ? '🔄' : '✅'} {task.text}
                            </option>
                        {/each}
                    </select>
                </div>

                <div class="form-row">
                    <label class="form-label" for="task-date-start-date">일정</label>
                    <DateRangePicker idPrefix="task-date" bind:startDate bind:endDate />
                </div>

                <div class="form-row">
                    <label class="form-label" for="category">카테고리</label>
                    <CategoryInput
                        id="category"
                        bind:value={category}
                        categories={$categories}
                        parentCategory={selectedParent?.category ?? ''}
                        taskText={newTaskText} />
                </div>
            </div>

            <div class="pill-section">
                <span class="form-label">중요도</span>
                <div class="priority-pills">
                    {#each Object.entries(PRIORITY_LABELS) as [value, label]}
                        <button
                            class="priority-pill"
                            class:active={selectedPriority === value}
                            data-p={value}
                            onclick={() => selectedPriority = /** @type {import('$lib/shared/task-domain.js').TaskPriority} */ (value)}>
                            {label}
                        </button>
                    {/each}
                </div>
            </div>

            <div class="pill-section">
                <span class="form-label">시급성</span>
                <div class="urgency-pills">
                    {#each Object.entries(URGENCY_LABELS) as [value, label]}
                        <button
                            class="urgency-pill"
                            class:active={selectedUrgency === value}
                            data-u={value}
                            onclick={() => selectedUrgency = /** @type {import('$lib/shared/task-domain.js').TaskUrgency} */ (value)}>
                            {label}
                        </button>
                    {/each}
                </div>
            </div>

            <div class="form-actions">
                {#if formError}
                    <p class="form-error" role="alert">{formError}</p>
                {/if}
                <button class="btn" onclick={resetForm}>취소</button>
                <button class="btn btn-primary" onclick={addTask} disabled={isSubmitting}>
                    {isSubmitting ? '추가 중...' : '✚ 작업 추가'}
                </button>
            </div>
        </div>
    {/if}
</div>
