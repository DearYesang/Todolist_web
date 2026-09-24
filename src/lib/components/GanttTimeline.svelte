<script>
    import { onDestroy, tick } from 'svelte';
    import { filters, tasks, toggleSubtask, updateTask } from '$lib/client/task-store.js';
    import {
        buildGanttLayout,
        canStartResize,
        GANTT_DAY_WIDTH,
        getBarCoords,
        getResizeDayOffset,
        getResizePreview,
        ownsResizePointer
    } from '$lib/shared/gantt-layout.js';
    import { getCategoryColor, getFilteredTasks } from '$lib/shared/task-domain.js';

    let { openTask } = $props();

    const dayWidth = GANTT_DAY_WIDTH;
    let suppressBarClick = $state(false);
    /** @type {string | null} */
    let expandedChecklistTaskId = $state(null);
    /** @type {HTMLDivElement | null} */
    let timelineArea = $state(null);
    let hasCenteredToday = $state(false);

    /** @type {null | {
     *   taskId: string;
     *   edge: 'start' | 'end';
     *   pointerId: number;
     *   originX: number;
     *   originStartDate: string;
     *   originEndDate: string;
     *   previewStartDate: string;
     *   previewEndDate: string;
     * }} */
    let resizeState = $state(null);

    const ganttData = $derived(buildGanttLayout(getFilteredTasks($tasks, $filters), { dayWidth }));

    $effect(() => {
        if (hasCenteredToday || !timelineArea || ganttData.headerDays.length === 0) {
            return;
        }

        void tick().then(() => {
            centerTodayInTimeline();
        });
    });

    /**
     * @param {import('$lib/shared/task-domain.js').Task} task
     */
    function getCoords(task) {
        return getBarCoords(getRenderedDates(task), ganttData.minDate, dayWidth);
    }

    function centerTodayInTimeline() {
        if (hasCenteredToday || !timelineArea) return;

        const todayIndex = ganttData.headerDays.findIndex((day) => day.isToday);
        if (todayIndex === -1) return;

        const todayCenter = todayIndex * dayWidth + dayWidth / 2;
        const maxScrollLeft = Math.max(timelineArea.scrollWidth - timelineArea.clientWidth, 0);
        const nextScrollLeft = Math.min(Math.max(todayCenter - timelineArea.clientWidth / 2, 0), maxScrollLeft);

        timelineArea.scrollTo({ left: nextScrollLeft, behavior: 'auto' });
        hasCenteredToday = true;
    }

    /**
     * @param {import('$lib/shared/task-domain.js').Task} task
     */
    function getRenderedDates(task) {
        if (resizeState?.taskId === task.id) {
            return {
                startDate: resizeState.previewStartDate,
                endDate: resizeState.previewEndDate
            };
        }

        return {
            startDate: task.startDate,
            endDate: task.endDate
        };
    }

    /**
     * @param {import('$lib/shared/task-domain.js').Task} task
     */
    function getBarTitle(task) {
        const { startDate, endDate } = getRenderedDates(task);
        return `${task.text} (${startDate} ~ ${endDate})`;
    }

    function clearResizeListeners() {
        window.removeEventListener('pointermove', handleResizeMove);
        window.removeEventListener('pointerup', handleResizeEnd);
        window.removeEventListener('pointercancel', handleResizeEnd);
    }

    /**
     * @param {PointerEvent} event
     * @param {import('$lib/shared/task-domain.js').Task} task
     * @param {'start' | 'end'} edge
     */
    function startResize(event, task, edge) {
        event.preventDefault();
        event.stopPropagation();
        if (!canStartResize(resizeState, event)) return;
        suppressBarClick = true;

        resizeState = {
            taskId: task.id,
            edge,
            pointerId: event.pointerId,
            originX: event.clientX,
            originStartDate: task.startDate,
            originEndDate: task.endDate,
            previewStartDate: task.startDate,
            previewEndDate: task.endDate
        };

        clearResizeListeners();
        window.addEventListener('pointermove', handleResizeMove);
        window.addEventListener('pointerup', handleResizeEnd);
        window.addEventListener('pointercancel', handleResizeEnd);
    }

    /**
     * @param {PointerEvent} event
     */
    function handleResizeMove(event) {
        if (!resizeState || !ownsResizePointer(resizeState, event)) return;

        const dayOffset = getResizeDayOffset(resizeState.originX, event.clientX, dayWidth);
        resizeState = {
            ...resizeState,
            ...getResizePreview(resizeState, dayOffset)
        };
    }

    /**
     * @param {PointerEvent} event
     */
    function handleResizeEnd(event) {
        if (!resizeState || !ownsResizePointer(resizeState, event)) return;

        const { taskId, originStartDate, originEndDate, previewStartDate, previewEndDate } = resizeState;
        clearResizeListeners();

        if (originStartDate !== previewStartDate || originEndDate !== previewEndDate) {
            updateTask(taskId, {
                startDate: previewStartDate,
                endDate: previewEndDate
            });
        }

        resizeState = null;
        window.setTimeout(() => {
            suppressBarClick = false;
        }, 0);
    }

    /**
     * @param {string} taskId
     */
    function handleBarClick(taskId) {
        if (suppressBarClick) return;
        openTask(taskId);
    }

    /**
     * @param {import('$lib/shared/task-domain.js').Task} task
     */
    function toggleChecklistPreview(task) {
        if (task.subtasks.length === 0) {
            openTask(task.id);
            return;
        }

        expandedChecklistTaskId = expandedChecklistTaskId === task.id ? null : task.id;
    }

    /**
     * @param {string} taskId
     * @param {string} subtaskId
     */
    function toggleChecklistItem(taskId, subtaskId) {
        toggleSubtask(taskId, subtaskId);
    }

    /**
     * @param {import('$lib/shared/task-domain.js').Task} task
     */
    function getRowHeight(task) {
        if (expandedChecklistTaskId !== task.id || task.subtasks.length === 0) {
            return 36;
        }

        return 72 + Math.min(task.subtasks.length, 3) * 22;
    }

    /**
     * @param {import('$lib/shared/task-domain.js').Task} task
     */
    function getChecklistPreview(task) {
        return task.subtasks.slice(0, 3);
    }

    onDestroy(() => {
        clearResizeListeners();
    });
</script>

<div class="gantt-board">
    <div class="gantt-sidebar">
        <div class="gantt-sidebar-header">작업 목록</div>
        <div class="gantt-sidebar-rows">
            {#if ganttData.displayList.length === 0}
                <div class="empty-state">
                    <div class="icon">📭</div>
                    <p>일정을 그릴 작업이 없습니다.</p>
                </div>
            {:else}
                {#each ganttData.displayList as item (item.task.id)}
                    {@const rowHeight = getRowHeight(item.task)}
                    <div
                        class="gantt-sidebar-item"
                        class:expanded={expandedChecklistTaskId === item.task.id}
                        class:done={item.task.status === 'done'}
                        style={`--gantt-row-height:${rowHeight}px;`}>
                        <div
                            class="gantt-sidebar-title"
                            role="button"
                            tabindex="0"
                            aria-expanded={expandedChecklistTaskId === item.task.id}
                            style={`padding-left:${16 + item.depth * 24}px;`}
                            onclick={() => toggleChecklistPreview(item.task)}
                            onkeydown={(event) => event.key === 'Enter' && toggleChecklistPreview(item.task)}>
                            {#if item.depth > 0}
                                <div class="gantt-link-line"></div>
                            {/if}
                            <span>
                                {item.task.status === 'done' ? '☑️' : '🗓️'} {item.task.text}
                            </span>
                            {#if item.task.subtasks.length > 0}
                                <small class="gantt-checklist-count">{item.task.subtasks.filter((subtask) => subtask.done).length}/{item.task.subtasks.length}</small>
                            {/if}
                        </div>

                        {#if expandedChecklistTaskId === item.task.id && item.task.subtasks.length > 0}
                            <div class="gantt-checklist-preview" style={`padding-left:${16 + item.depth * 24}px;`}>
                                {#each getChecklistPreview(item.task) as subtask (subtask.id)}
                                    <label class="gantt-checklist-item" class:done={subtask.done}>
                                        <input
                                            type="checkbox"
                                            checked={subtask.done}
                                            aria-label={`${subtask.text} 완료`}
                                            onchange={() => toggleChecklistItem(item.task.id, subtask.id)} />
                                        <span>{subtask.text}</span>
                                    </label>
                                {/each}
                                <div class="gantt-checklist-footer">
                                    {#if item.task.subtasks.length > 3}
                                        <small>+{item.task.subtasks.length - 3}개</small>
                                    {/if}
                                    <button class="btn btn-small" type="button" onclick={() => openTask(item.task.id)}>상세</button>
                                </div>
                            </div>
                        {/if}
                    </div>
                {/each}
            {/if}
        </div>
    </div>

    <div class="gantt-timeline-area" bind:this={timelineArea}>
        <div class="gantt-header-row" style={`width:${ganttData.gridWidth}px;`}>
            {#each ganttData.headerDays as day (day.key)}
                <div class="gantt-day-header" class:today={day.isToday}>{day.label}</div>
            {/each}
        </div>

        <div class="gantt-timeline" style={`width:${ganttData.gridWidth}px;`}>
            {#if ganttData.displayList.length === 0}
                <div class="empty-state">
                    <div class="icon">📅</div>
                    <p>필터 조건에 맞는 일정이 없습니다.</p>
                </div>
            {:else}
                {#each ganttData.displayList as item (item.task.id)}
                    {@const coords = getCoords(item.task)}
                    {@const color = getCategoryColor(item.task.category, item.task.categoryMeta?.color)}
                    <div class="gantt-row" style={`--gantt-row-height:${getRowHeight(item.task)}px;`}>
                        <div
                            class="gantt-bar-wrapper"
                            class:resizing={resizeState?.taskId === item.task.id}
                            style={`left:${coords.left}px; width:${coords.width}px;`}>
                            <div
                                class="gantt-bar"
                                class:done={item.task.status === 'done'}
                                class:resizing={resizeState?.taskId === item.task.id}
                                role="button"
                                tabindex="0"
                                aria-label={`${item.task.text} 일정 막대`}
                                title={getBarTitle(item.task)}
                                onclick={() => handleBarClick(item.task.id)}
                                onkeydown={(event) => event.key === 'Enter' && openTask(item.task.id)}
                                style={`background:${color.fg}; border-color:${color.border};`}>
                                <div
                                    class="resize-handle start"
                                    aria-hidden="true"
                                    title="시작일 조절"
                                    onpointerdown={(event) => startResize(event, item.task, 'start')}></div>
                                <span class="bar-inner-text">{item.task.text}</span>
                                <div
                                    class="resize-handle end"
                                    aria-hidden="true"
                                    title="마감일 조절"
                                    onpointerdown={(event) => startResize(event, item.task, 'end')}></div>
                            </div>
                        </div>
                    </div>
                {/each}
            {/if}
        </div>
    </div>
</div>
