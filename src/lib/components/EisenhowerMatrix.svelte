<script>
    import { setContext } from 'svelte';
    import { filters, tasks, updateTask } from '$lib/client/task-store.js';
    import { createPointerDndController, DND_ZONE_ATTRIBUTE } from '$lib/client/pointer-dnd.js';
    import { buildHierarchy, isTaskInEisenhowerQuadrant, matchesFilters, resolveEisenhowerMove } from '$lib/shared/task-domain.js';
    import TaskTreeCard from './TaskTreeCard.svelte';

    let { openTask } = $props();

    /**
     * @typedef {{
     *   id: 'do' | 'schedule' | 'reduce' | 'backlog';
     *   title: string;
     *   subtitle: string;
     *   icon: string;
     *   importance: 'important' | 'less-important';
     *   urgency: import('$lib/shared/task-domain.js').TaskUrgency;
     * }} EisenhowerQuadrant
     */

    /** @type {EisenhowerQuadrant[]} */
    const quadrants = [
        {
            id: 'do',
            title: '즉시 실행',
            subtitle: '중요하고 시급',
            icon: '🔥',
            importance: 'important',
            urgency: 'urgent'
        },
        {
            id: 'schedule',
            title: '계획하기',
            subtitle: '중요하지만 시급하지 않음',
            icon: '📅',
            importance: 'important',
            urgency: 'normal'
        },
        {
            id: 'reduce',
            title: '줄이기',
            subtitle: '시급하지만 중요도 낮음',
            icon: '⚡',
            importance: 'less-important',
            urgency: 'urgent'
        },
        {
            id: 'backlog',
            title: '보류/제거',
            subtitle: '시급하지 않고 중요도 낮음',
            icon: '🧹',
            importance: 'less-important',
            urgency: 'normal'
        }
    ];

    let showDoneTasks = $state(false);

    const dndState = $state({ draggedId: /** @type {string | null} */ (null), hoveredZone: /** @type {string | null} */ (null) });

    const controller = createPointerDndController({
        onStateChange(snapshot) {
            dndState.draggedId = snapshot.draggedId;
            dndState.hoveredZone = snapshot.hoveredZone;
        },
        onDrop(draggedId, zone) {
            const quadrant = quadrants.find((candidate) => `quadrant:${candidate.id}` === zone);
            if (quadrant) {
                moveTaskToQuadrant(draggedId, quadrant);
            }
        }
    });

    // Cards are NOT drop targets here: dropping anywhere in a quadrant —
    // including on top of another card — means "move to this quadrant", so
    // only quadrants get zone attributes and highlights.
    setContext('task-dnd', { controller, state: dndState, cardDrops: false });

    const hiddenDoneCount = $derived(
        $tasks.filter((task) => task.status === 'done' && matchesFilters(task, $filters)).length
    );

    const matrixData = $derived.by(() =>
        quadrants.map((quadrant) => {
            const quadrantTasks = $tasks.filter((task) =>
                matchesFilters(task, $filters)
                && isTaskInQuadrant(task, quadrant)
                && (showDoneTasks || task.status !== 'done')
            );
            const { roots, childrenByParent } = buildHierarchy(quadrantTasks);

            return {
                ...quadrant,
                quadrantTasks,
                roots,
                childrenByParent
            };
        })
    );

    /**
     * @param {import('$lib/shared/task-domain.js').Task} task
     * @param {EisenhowerQuadrant} quadrant
     */
    function isTaskInQuadrant(task, quadrant) {
        return isTaskInEisenhowerQuadrant(task, quadrant);
    }

    /**
     * @param {string} taskId
     * @param {EisenhowerQuadrant} quadrant
     */
    function moveTaskToQuadrant(taskId, quadrant) {
        const task = $tasks.find((candidate) => candidate.id === taskId);
        const patch = task ? resolveEisenhowerMove(task, quadrant) : null;
        if (patch) {
            updateTask(taskId, patch);
        }
    }
</script>

<div class="eisenhower-toolbar">
    <button class="btn btn-ghost eisenhower-done-toggle" onclick={() => showDoneTasks = !showDoneTasks}>
        {showDoneTasks ? '완료 숨기기' : `완료 보기${hiddenDoneCount > 0 ? ` (${hiddenDoneCount})` : ''}`}
    </button>
</div>

<div class="eisenhower-board">
    {#each matrixData as quadrant (quadrant.id)}
        <section
            class="eisenhower-quadrant"
            class:drag-over-col={dndState.draggedId !== null && dndState.hoveredZone === `quadrant:${quadrant.id}`}
            data-quadrant={quadrant.id}
            aria-label={`${quadrant.title} 작업 목록`}
            {...{ [DND_ZONE_ATTRIBUTE]: `quadrant:${quadrant.id}` }}>
            <div class="eisenhower-header">
                <div>
                    <p class="eisenhower-label">{quadrant.icon} {quadrant.subtitle}</p>
                    <h2>{quadrant.title}</h2>
                </div>
                <span class="column-count">{quadrant.quadrantTasks.length}</span>
            </div>

            <div class="task-list eisenhower-list" role="list">
                {#if quadrant.roots.length === 0}
                    <div class="empty-state">
                        <div class="icon">{quadrant.icon}</div>
                        <div>작업이 없습니다</div>
                    </div>
                {:else}
                    {#each quadrant.roots as task (task.id)}
                        <TaskTreeCard
                            allTasks={$tasks}
                            childrenByParent={quadrant.childrenByParent}
                            openTask={openTask}
                            task={task} />
                    {/each}
                {/if}
            </div>
        </section>
    {/each}
</div>
