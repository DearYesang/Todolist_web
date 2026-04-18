<script>
    import { tasks } from './store.js';

    let isFormOpen = $state(false);
    let newTaskText = $state('');
    let selectedPriority = $state('medium');
    let selectedUrgency = $state('normal');
    let category = $state('');
    let parentId = $state('');

    let today = new Date().toISOString().split('T')[0];
    let endDay = new Date();
    endDay.setDate(endDay.getDate() + 2);
    let futureStr = endDay.toISOString().split('T')[0];

    let startDate = $state(today);
    let endDate = $state(futureStr);

    function addTask() {
        if (!newTaskText.trim()) return;

        tasks.update(ts => {
            const newTask = {
                id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                text: newTaskText.trim(),
                status: parentId ? (ts.find(t => t.id === parentId)?.status || 'todo') : 'todo',
                priority: selectedPriority,
                urgency: selectedUrgency,
                category: category.trim(),
                parentId: parentId || null,
                startDate,
                endDate,
                subtasks: [],
                collapsed: false,
                createdAt: Date.now()
            };
            return [...ts, newTask];
        });

        newTaskText = '';
        category = '';
        isFormOpen = false;
    }
</script>

<div class="add-panel" style="max-width: 1320px; margin: 0 auto; margin-bottom: 24px;">
    <button class="add-toggle" onclick={() => isFormOpen = !isFormOpen}>
        {isFormOpen ? '－ 닫기' : '＋ 새 작업 추가...'}
    </button>
    
    {#if isFormOpen}
    <div class="add-form" style="display: flex; gap: 16px; flex-wrap: wrap; margin-top: 10px;">
        <div class="form-row">
            <label class="form-label" for="task-text">작업명</label>
            <input type="text" id="task-text" class="form-input" bind:value={newTaskText} placeholder="무엇을 해야 하나요?">
        </div>
        <div class="form-row">
            <label class="form-label" for="start-date">일정</label>
            <div style="display:flex; gap: 8px; align-items:center;">
                <input type="date" id="start-date" class="form-input" bind:value={startDate} style="flex:1; font-size:12px; padding:6px">
                <span style="color:var(--text-muted)">~</span>
                <input type="date" id="end-date" class="form-input" bind:value={endDate} style="flex:1; font-size:12px; padding:6px">
            </div>
        </div>
        <div class="form-row">
            <label class="form-label" for="parent-id">상위 작업 (선택)</label>
            <select id="parent-id" class="form-select" bind:value={parentId}>
                <option value="">없음 (최상위)</option>
                {#each $tasks.filter(t => !t.parentId) as t}
                    <option value={t.id}>{t.text}</option>
                {/each}
            </select>
        </div>
        <div class="form-row">
            <label class="form-label" for="category">카테고리</label>
            <input type="text" id="category" class="form-input" bind:value={category} placeholder="예: 개발, 기획">
        </div>
        
        <div class="form-row" style="margin-left: auto; justify-content: flex-end; align-items: flex-end;">
            <button class="btn btn-primary" onclick={addTask}>✚ 작업 추가</button>
        </div>
    </div>
    {/if}
</div>
