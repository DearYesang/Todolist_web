<script>
    import { filters, tasks, updateTask } from '$lib/client/task-store.js';
    import { buildHierarchy, matchesFilters } from '$lib/shared/task-domain.js';
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

    /** @type {string | null} */
    let draggedId = $state(null);
    /** @type {string | null} */
    let hoveredQuadrant = $state(null);

    const matrixData = $derived.by(() =>
        quadrants.map((quadrant) => {
            const quadrantTasks = $tasks.filter((task) =>
                matchesFilters(task, $filters) && isTaskInQuadrant(task, quadrant)
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
        const isImportant = task.priority === 'high';
        const matchesImportance = quadrant.importance === 'important' ? isImportant : !isImportant;
        return matchesImportance && task.urgency === quadrant.urgency;
    }

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
        hoveredQuadrant = null;
    }

    /**
     * @param {DragEvent} event
     * @param {EisenhowerQuadrant} quadrant
     */
    function onDropOnQuadrant(event, quadrant) {
        event.preventDefault();
        const taskId = event.dataTransfer?.getData('text/plain');
        if (taskId) {
            moveTaskToQuadrant(taskId, quadrant);
        }
        onDragEnd();
    }

    /**
     * @param {DragEvent} event
     * @param {string} targetTaskId
     */
    function onDropOnTask(event, targetTaskId) {
        event.preventDefault();
        const draggedTaskId = event.dataTransfer?.getData('text/plain');
        if (!draggedTaskId || draggedTaskId === targetTaskId) {
            onDragEnd();
            return;
        }

        const targetTask = $tasks.find((task) => task.id === targetTaskId);
        const targetQuadrant = quadrants.find((quadrant) => targetTask && isTaskInQuadrant(targetTask, quadrant));
        if (targetQuadrant) {
            moveTaskToQuadrant(draggedTaskId, targetQuadrant);
        }
        onDragEnd();
    }

    /**
     * @param {string} taskId
     * @param {EisenhowerQuadrant} quadrant
     */
    function moveTaskToQuadrant(taskId, quadrant) {
        const task = $tasks.find((candidate) => candidate.id === taskId);
        if (!task) return;

        updateTask(taskId, {
            priority: quadrant.importance === 'important'
                ? 'high'
                : task.priority === 'low'
                    ? 'low'
                    : 'medium',
            urgency: quadrant.urgency
        });
    }
</script>

<div class="eisenhower-board">
    {#each matrixData as quadrant (quadrant.id)}
        <section
            class="eisenhower-quadrant"
            class:drag-over-col={hoveredQuadrant === quadrant.id && draggedId !== null}
            data-quadrant={quadrant.id}
            aria-label={`${quadrant.title} 작업 목록`}
            ondragover={(event) => event.preventDefault()}
            ondragenter={(event) => {
                event.preventDefault();
                hoveredQuadrant = quadrant.id;
            }}
            ondragleave={() => {
                if (hoveredQuadrant === quadrant.id) hoveredQuadrant = null;
            }}
            ondrop={(event) => onDropOnQuadrant(event, quadrant)}>
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
                            draggedId={draggedId}
                            openTask={openTask}
                            onDragEnd={onDragEnd}
                            onDragStart={onDragStart}
                            onDropOnTask={onDropOnTask}
                            task={task} />
                    {/each}
                {/if}
            </div>
        </section>
    {/each}
</div>
