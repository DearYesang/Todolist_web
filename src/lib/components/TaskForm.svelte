<script>
    import { onDestroy } from 'svelte';
    import { categories, createTask, tasks } from '$lib/client/task-store.js';
    import { createImeCompositionGuard } from '$lib/client/ime-keyboard.js';
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
    const taskTextComposition = createImeCompositionGuard();
    onDestroy(() => taskTextComposition.reset());

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
        taskTextComposition.reset();
    }

    async function addTask() {
        // A blank title leaves the form as it is, without an error.
        if (isSubmitting || !newTaskText.trim()) return;

        formError = '';
        isSubmitting = true;

        try {
            const result = await createTask({
                text: newTaskText,
                priority: selectedPriority,
                urgency: selectedUrgency,
                category,
                startDate,
                endDate,
                parentId: parentId || null
            });
            if (result.ok) {
                resetForm();
            } else {
                formError = result.message;
            }
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

        if (taskTextComposition.shouldIgnoreEnter(event)) {
            return;
        }

        event.preventDefault();
        void addTask();
    }

    function handleTaskTextCompositionStart() {
        taskTextComposition.start();
    }

    /**
     * @param {CompositionEvent} event
     */
    function handleTaskTextCompositionEnd(event) {
        taskTextComposition.end();
        newTaskText = /** @type {HTMLInputElement} */ (event.currentTarget).value;
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
