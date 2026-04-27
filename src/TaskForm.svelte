<script>
    import {
        categories,
        createId,
        getDefaultDateRange,
        normalizeDateRange,
        PRIORITY_LABELS,
        tasks,
        URGENCY_LABELS
    } from './store.js';

    let isFormOpen = $state(false);
    let newTaskText = $state('');
    let selectedPriority = $state('medium');
    let selectedUrgency = $state('normal');
    let category = $state('');
    let parentId = $state('');

    const defaults = getDefaultDateRange();
    let startDate = $state(defaults.startDate);
    let endDate = $state(defaults.endDate);

    function resetForm() {
        const range = getDefaultDateRange();
        newTaskText = '';
        selectedPriority = 'medium';
        selectedUrgency = 'normal';
        category = '';
        parentId = '';
        startDate = range.startDate;
        endDate = range.endDate;
        isFormOpen = false;
    }

    function addTask() {
        const text = newTaskText.trim();
        if (!text) return;

        tasks.update((current) => {
            const parent = parentId ? current.find((task) => task.id === parentId) : null;
            const normalizedRange = normalizeDateRange(startDate, endDate);

            return [
                ...current,
                {
                    id: createId(),
                    text,
                    status: parent?.status || 'todo',
                    startDate: normalizedRange.startDate,
                    endDate: normalizedRange.endDate,
                    priority: selectedPriority,
                    urgency: selectedUrgency,
                    category: category.trim(),
                    parentId: parent?.id || null,
                    subtasks: [],
                    collapsed: false,
                    createdAt: Date.now()
                }
            ];
        });

        resetForm();
    }

    function handleTaskInputKeydown(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            addTask();
        }
    }
</script>

<div class="add-panel">
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
                    <label class="form-label" for="start-date">일정</label>
                    <div class="date-range">
                        <input id="start-date" class="form-input form-date-input" type="date" bind:value={startDate} />
                        <span class="range-separator">~</span>
                        <input id="end-date" class="form-input form-date-input" type="date" bind:value={endDate} />
                    </div>
                </div>

                <div class="form-row">
                    <label class="form-label" for="category">카테고리</label>
                    <input
                        id="category"
                        class="form-input"
                        type="text"
                        bind:value={category}
                        placeholder="예: 개발, 디자인, 마케팅"
                        list="category-list" />
                    <datalist id="category-list">
                        {#each $categories as categoryOption}
                            <option value={categoryOption}></option>
                        {/each}
                    </datalist>
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
                            onclick={() => selectedPriority = value}>
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
                            onclick={() => selectedUrgency = value}>
                            {label}
                        </button>
                    {/each}
                </div>
            </div>

            <div class="form-actions">
                <button class="btn" onclick={resetForm}>취소</button>
                <button class="btn btn-primary" onclick={addTask}>✚ 작업 추가</button>
            </div>
        </div>
    {/if}
</div>
