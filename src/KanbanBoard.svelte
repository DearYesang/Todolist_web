<script>
    import { assignParent, buildColumnHierarchy, canAssignParent, filters, moveTask, tasks } from './store.js';
    import TaskTreeCard from './TaskTreeCard.svelte';

    let { openTask } = $props();

    const columns = [
        { id: 'todo', title: '할 일', emptyIcon: '📋' },
        { id: 'doing', title: '진행 중', emptyIcon: '⚡' },
        { id: 'done', title: '완료', emptyIcon: '🎉' }
    ];

    /** @type {string | null} */
    let draggedId = $state(null);
    /** @type {string | null} */
    let hoveredColumn = $state(null);

    const columnData = $derived.by(() =>
        columns.map((column) => ({
            ...column,
            ...buildColumnHierarchy($tasks, /** @type {'todo' | 'doing' | 'done'} */ (column.id), $filters)
        }))
    );

    /**
     * @param {DragEvent} event
     * @param {string} taskId
     */
    function onDragStart(event, taskId) {
        draggedId = taskId;
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', taskId);
        }
    }

    function onDragEnd() {
        draggedId = null;
        hoveredColumn = null;
    }

    /**
     * @param {DragEvent} event
     * @param {'todo' | 'doing' | 'done'} status
     */
    function onDropOnColumn(event, status) {
        event.preventDefault();
        const taskId = event.dataTransfer?.getData('text/plain');
        if (!taskId) return;

        assignParent(taskId, null);
        moveTask(taskId, status);
        draggedId = null;
        hoveredColumn = null;
    }

    /**
     * @param {DragEvent} event
     * @param {string} targetTaskId
     */
    function onDropOnTask(event, targetTaskId) {
        const taskId = event.dataTransfer?.getData('text/plain');
        if (!taskId || taskId === targetTaskId) return;

        if (!canAssignParent($tasks, taskId, targetTaskId)) {
            alert('하위 작업을 해당 작업의 부모로 설정할 수 없습니다.');
            draggedId = null;
            return;
        }

        assignParent(taskId, targetTaskId);
        draggedId = null;
        hoveredColumn = null;
    }
</script>

<div class="board">
    {#each columnData as column (column.id)}
        <div class="column" id={`col-${column.id}`}>
            <div class="column-header">
                <div class="column-dot"></div>
                <span class="column-title">{column.title}</span>
                <span class="column-count">{column.columnTasks.length}</span>
            </div>

            <div
                class="task-list"
                class:drag-over-col={hoveredColumn === column.id && draggedId !== null}
                role="list"
                aria-label={`${column.title} 작업 목록`}
                ondragover={(event) => event.preventDefault()}
                ondragenter={(event) => {
                    event.preventDefault();
                    hoveredColumn = column.id;
                }}
                ondragleave={() => {
                    if (hoveredColumn === column.id) hoveredColumn = null;
                }}
                ondrop={(event) => onDropOnColumn(event, /** @type {'todo' | 'doing' | 'done'} */ (column.id))}>
                {#if column.roots.length === 0}
                    <div class="empty-state">
                        <div class="icon">{column.emptyIcon}</div>
                        <div>작업이 없습니다</div>
                    </div>
                {:else}
                    {#each column.roots as task (task.id)}
                        <TaskTreeCard
                            allTasks={$tasks}
                            childrenByParent={column.childrenByParent}
                            draggedId={draggedId}
                            openTask={openTask}
                            onDragEnd={onDragEnd}
                            onDragStart={onDragStart}
                            onDropOnTask={onDropOnTask}
                            task={task} />
                    {/each}
                {/if}
            </div>
        </div>
    {/each}
</div>
