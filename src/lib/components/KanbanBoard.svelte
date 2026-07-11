<script>
    import { setContext } from 'svelte';
    import { assignParent, filters, moveTask, tasks } from '$lib/client/task-store.js';
    import { createPointerDndController, DND_ZONE_ATTRIBUTE } from '$lib/client/pointer-dnd.js';
    import { buildColumnHierarchy, canAssignParent } from '$lib/shared/task-domain.js';
    import TaskTreeCard from './TaskTreeCard.svelte';

    let { openTask } = $props();

    const columns = [
        { id: 'todo', title: '할 일', emptyIcon: '📋' },
        { id: 'doing', title: '진행 중', emptyIcon: '⚡' },
        { id: 'done', title: '완료', emptyIcon: '🎉' }
    ];

    const dndState = $state({ draggedId: /** @type {string | null} */ (null), hoveredZone: /** @type {string | null} */ (null) });

    const controller = createPointerDndController({
        onStateChange(snapshot) {
            dndState.draggedId = snapshot.draggedId;
            dndState.hoveredZone = snapshot.hoveredZone;
        },
        onDrop(draggedId, zone) {
            const [kind, target] = splitZone(zone);
            if (kind === 'card') {
                if (target === draggedId) return;
                if (!canAssignParent($tasks, draggedId, target)) {
                    alert('하위 작업을 해당 작업의 부모로 설정할 수 없습니다.');
                    return;
                }
                assignParent(draggedId, target);
                return;
            }

            if (kind === 'column') {
                const task = $tasks.find((candidate) => candidate.id === draggedId);
                // Dropping back into the same lane is a no-op; the old code
                // silently detached the card from its parent here.
                if (!task || task.status === target) return;
                moveTask(draggedId, /** @type {'todo' | 'doing' | 'done'} */ (target));
            }
        }
    });

    // Cards are drop targets (re-parenting) only on the Kanban board.
    setContext('task-dnd', { controller, state: dndState, cardDrops: true });

    /**
     * @param {string} zone
     * @returns {[string, string]}
     */
    function splitZone(zone) {
        const separator = zone.indexOf(':');
        return [zone.slice(0, separator), zone.slice(separator + 1)];
    }

    const columnData = $derived.by(() =>
        columns.map((column) => ({
            ...column,
            ...buildColumnHierarchy($tasks, /** @type {'todo' | 'doing' | 'done'} */ (column.id), $filters)
        }))
    );
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
                class:drag-over-col={dndState.draggedId !== null && dndState.hoveredZone === `column:${column.id}`}
                role="list"
                aria-label={`${column.title} 작업 목록`}
                {...{ [DND_ZONE_ATTRIBUTE]: `column:${column.id}` }}>
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
                            openTask={openTask}
                            task={task} />
                    {/each}
                {/if}
            </div>
        </div>
    {/each}
</div>
