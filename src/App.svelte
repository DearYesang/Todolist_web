<script>
    import { get } from 'svelte/store';
    import {
        clearDoneTasks,
        currentView,
        replaceTasks,
        resetFilters,
        tasks
    } from './store.js';
    import FilterBar from './FilterBar.svelte';
    import GanttTimeline from './GanttTimeline.svelte';
    import KanbanBoard from './KanbanBoard.svelte';
    import TaskForm from './TaskForm.svelte';
    import TaskModal from './TaskModal.svelte';

    /** @type {string | null} */
    let selectedTaskId = $state(null);

    /**
     * @param {Event} event
     */
    function importData(event) {
        const input = /** @type {HTMLInputElement} */ (event.currentTarget);
        const file = input.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (loadEvent) => {
            const result = loadEvent.target?.result;
            if (typeof result !== 'string') return;

            try {
                const parsed = JSON.parse(result);
                if (!Array.isArray(parsed)) {
                    alert('올바른 칸반 데이터 형식이 아닙니다.');
                    return;
                }

                if (get(tasks).length > 0 && !confirm('기존 데이터를 덮어쓰고 불러오시겠습니까?')) {
                    return;
                }

                replaceTasks(parsed);
                resetFilters();
                alert('데이터를 성공적으로 불러왔습니다.');
            } catch (error) {
                alert('파일을 읽는 중 오류가 발생했습니다.');
            } finally {
                input.value = '';
            }
        };

        reader.readAsText(file);
    }

    function exportData() {
        const data = JSON.stringify(get(tasks), null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `kanban_backup_${new Date().toISOString().split('T')[0]}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
    }

    function handleClearDone() {
        const doneCount = get(tasks).filter((task) => task.status === 'done').length;
        if (doneCount === 0) return;

        if (confirm(`완료된 작업 ${doneCount}개를 모두 삭제하시겠습니까?`)) {
            clearDoneTasks();
            if (selectedTaskId && !get(tasks).some((task) => task.id === selectedTaskId)) {
                selectedTaskId = null;
            }
        }
    }
</script>

<div class="header">
    <h1>🚀 나의 칸반 보드</h1>

    <div class="view-toggle">
        <button class="view-btn" class:active={$currentView === 'kanban'} onclick={() => $currentView = 'kanban'}>
            📋 칸반 뷰
        </button>
        <button class="view-btn" class:active={$currentView === 'gantt'} onclick={() => $currentView = 'gantt'}>
            📊 간트 뷰
        </button>
    </div>

    <div class="header-actions">
        <input type="file" id="import-file" accept=".json" hidden onchange={importData} />
        <button class="btn" onclick={() => document.getElementById('import-file')?.click()}>📂 불러오기</button>
        <button class="btn" onclick={exportData}>💾 내보내기</button>
        <button class="btn" onclick={handleClearDone}>🧹 정리</button>
    </div>
</div>

<TaskForm />
<FilterBar />

{#if $currentView === 'kanban'}
    <KanbanBoard openTask={(id) => selectedTaskId = id} />
{:else}
    <GanttTimeline openTask={(id) => selectedTaskId = id} />
{/if}

{#if selectedTaskId}
    <TaskModal taskId={selectedTaskId} onclose={() => selectedTaskId = null} />
{/if}
