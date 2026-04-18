<script>
    import { tasks, currentView } from './store.js';
    import KanbanBoard from './KanbanBoard.svelte';
    import GanttTimeline from './GanttTimeline.svelte';
    import TaskForm from './TaskForm.svelte';
    import TaskModal from './TaskModal.svelte';

    let selectedTaskId = $state(null);

    // 파일 업로드 핸들러
    function importData(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const data = JSON.parse(evt.target.result);
                if (Array.isArray(data)) {
                    tasks.set(data);
                    alert('데이터를 성공적으로 불러왔습니다!');
                }
            } catch (err) {
                alert('잘못된 파일입니다.');
            }
        };
        reader.readAsText(file);
    }

    function exportData() {
        tasks.subscribe(ts => {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(ts, null, 2));
            const a = document.createElement('a');
            a.href = dataStr;
            a.download = `kanban_backup_${new Date().toISOString().split('T')[0]}.json`;
            a.click();
        })(); // immediately unsubscribe
    }
</script>

<div class="header" style="margin-bottom: 20px;">
    <h1>🚀 나의 칸반 보드 (Svelte)</h1>
    <div class="view-toggle" style="display: flex; background: var(--surface-raised); border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; margin-left: auto; margin-right: 16px;">
        <button class="view-btn {$currentView === 'kanban' ? 'active' : ''}" onclick={() => $currentView = 'kanban'}>📋 칸반 뷰</button>
        <button class="view-btn {$currentView === 'gantt' ? 'active' : ''}" onclick={() => $currentView = 'gantt'}>📊 간트 뷰</button>
    </div>
    <div class="header-actions">
        <input type="file" id="import-file" accept=".json" style="display:none;" onchange={importData}>
        <button class="btn" onclick={() => document.getElementById('import-file').click()} title="데이터 불러오기">📂 불러오기</button>
        <button class="btn" onclick={exportData} title="데이터 내보내기">💾 내보내기</button>
    </div>
</div>

<TaskForm />

{#if $currentView === 'kanban'}
    <KanbanBoard openTask={(id) => selectedTaskId = id} />
{:else}
    <GanttTimeline openTask={(id) => selectedTaskId = id} />
{/if}

{#if selectedTaskId}
    <TaskModal taskId={selectedTaskId} onclose={() => selectedTaskId = null} />
{/if}

<style>
    /* 여분 CSS (app.css 외 추가 스타일) */
</style>
