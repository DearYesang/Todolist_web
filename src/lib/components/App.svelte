<script>
    import { onMount } from 'svelte';
    import { get } from 'svelte/store';
    import { exportServerTasks, importServerTasks } from '$lib/client/task-api.js';
    import { syncServerTasks } from '$lib/client/task-sync.js';
    import {
        clearDoneTasks,
        currentView,
        replaceTasks,
        resetFilters,
        tasks
    } from '$lib/client/task-store.js';
    import { createTaskCalendar } from '$lib/shared/calendar-ics.js';
    import AuthPanel from './AuthPanel.svelte';
    import CalendarFeedPanel from './CalendarFeedPanel.svelte';
    import FilterBar from './FilterBar.svelte';
    import GanttTimeline from './GanttTimeline.svelte';
    import KanbanBoard from './KanbanBoard.svelte';
    import TaskForm from './TaskForm.svelte';
    import TaskModal from './TaskModal.svelte';

    /** @type {string | null} */
    let selectedTaskId = $state(null);

    onMount(() => {
        void syncServerTasks();
    });

    /**
     * @param {string} id
     */
    function openTask(id) {
        selectedTaskId = id;
    }

    /**
     * @param {Event} event
     */
    function importData(event) {
        const input = /** @type {HTMLInputElement} */ (event.currentTarget);
        const file = input.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (loadEvent) => {
            const fileText = loadEvent.target?.result;
            if (typeof fileText !== 'string') return;

            try {
                const parsed = JSON.parse(fileText);
                if (!Array.isArray(parsed)) {
                    alert('올바른 칸반 데이터 형식이 아닙니다.');
                    return;
                }

                const importMode = get(tasks).length > 0 && confirm('현재 목록을 파일 내용으로 교체하시겠습니까? 취소하면 기존 목록에 추가합니다.')
                    ? 'replace'
                    : 'append';

                const result = await importServerTasks(parsed, { mode: importMode });
                if (result.ok) {
                    replaceTasks(importMode === 'replace' ? result.tasks : [...get(tasks), ...result.tasks]);
                    resetFilters();
                    const replacedText = result.summary.replacedTasks ? ` 교체된 작업: ${result.summary.replacedTasks}개.` : '';
                    alert(`데이터를 성공적으로 불러왔습니다. 가져온 작업: ${result.summary.importedTasks}개.${replacedText}`);
                    return;
                }

                if (result.fallback) {
                    replaceTasks(importMode === 'replace' ? parsed : [...get(tasks), ...parsed]);
                    resetFilters();
                    alert('데이터를 성공적으로 불러왔습니다.');
                    return;
                }

                alert(result.message);
            } catch (error) {
                alert('파일을 읽는 중 오류가 발생했습니다.');
            } finally {
                input.value = '';
            }
        };

        reader.readAsText(file);
    }

    async function exportData() {
        const result = await exportServerTasks();
        const sourceTasks = result.ok ? result.tasks : get(tasks);
        const data = JSON.stringify(sourceTasks, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `kanban_backup_${new Date().toISOString().split('T')[0]}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
    }

    function exportCalendarData() {
        const data = createTaskCalendar(get(tasks));
        const blob = new Blob([data], { type: 'text/calendar;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `todolist_calendar_${new Date().toISOString().split('T')[0]}.ics`;
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
        <AuthPanel />
        <CalendarFeedPanel />
        <input type="file" id="import-file" accept=".json" hidden onchange={importData} />
        <button class="btn" onclick={() => document.getElementById('import-file')?.click()}>📂 불러오기</button>
        <button class="btn" onclick={exportData}>💾 내보내기</button>
        <button class="btn" onclick={exportCalendarData}>📅 캘린더</button>
        <button class="btn" onclick={handleClearDone}>🧹 정리</button>
    </div>
</div>

<TaskForm />
<FilterBar />

{#if $currentView === 'kanban'}
    <KanbanBoard openTask={openTask} />
{:else}
    <GanttTimeline openTask={openTask} />
{/if}

{#if selectedTaskId}
    <TaskModal taskId={selectedTaskId} onclose={() => selectedTaskId = null} />
{/if}
