<script>
    import { onDestroy, tick } from 'svelte';
    import { filters, tasks, toggleSubtask, updateTask } from '$lib/client/task-store.js';
    import { buildHierarchy, getCategoryColor, getFilteredTasks } from '$lib/shared/task-domain.js';

    let { openTask } = $props();

    const dayWidth = 48;
    const dayMs = 86400000;
    const todayCenterPaddingDays = 18;
    let suppressBarClick = $state(false);
    /** @type {string | null} */
    let expandedChecklistTaskId = $state(null);
    /** @type {HTMLDivElement | null} */
    let timelineArea = $state(null);
    let hasCenteredToday = $state(false);

    /** @type {null | {
     *   taskId: string;
     *   edge: 'start' | 'end';
     *   originX: number;
     *   originStartDate: string;
     *   originEndDate: string;
     *   previewStartDate: string;
     *   previewEndDate: string;
     * }} */
    let resizeState = $state(null);

    const ganttData = $derived.by(() => {
        const visibleTasks = getFilteredTasks($tasks, $filters);
        if (visibleTasks.length === 0) {
            return {
                displayList: [],
                gridWidth: dayWidth,
                headerDays: [],
                minDate: new Date(),
                totalDays: 0
            };
        }

        const today = parseLocalDate(formatDate(new Date()));
        let minDate = new Date(today);
        let maxDate = new Date(today);

        visibleTasks.forEach((task) => {
            const start = parseLocalDate(task.startDate);
            const end = parseLocalDate(task.endDate);
            if (start < minDate) minDate = new Date(start);
            if (end > maxDate) maxDate = new Date(end);
        });

        minDate.setDate(minDate.getDate() - 3);
        maxDate.setDate(maxDate.getDate() + 5);

        const todayWindowStart = new Date(today);
        todayWindowStart.setDate(todayWindowStart.getDate() - todayCenterPaddingDays);
        const todayWindowEnd = new Date(today);
        todayWindowEnd.setDate(todayWindowEnd.getDate() + todayCenterPaddingDays);
        if (todayWindowStart < minDate) minDate = todayWindowStart;
        if (todayWindowEnd > maxDate) maxDate = todayWindowEnd;

        const totalDays = Math.round((maxDate.getTime() - minDate.getTime()) / 86400000);
        const headerDays = [];

        for (let index = 0; index <= totalDays; index += 1) {
            const date = new Date(minDate);
            date.setDate(date.getDate() + index);
            headerDays.push({
                key: date.toISOString(),
                label: `${date.getMonth() + 1}/${date.getDate()}`,
                isToday: formatDate(date) === formatDate(today)
            });
        }

        const { roots, childrenByParent } = buildHierarchy(visibleTasks);
        /** @type {{ task: import('$lib/shared/task-domain.js').Task; depth: number }[]} */
        const displayList = [];

        /**
         * @param {import('$lib/shared/task-domain.js').Task[]} list
         * @param {number} depth
         */
        function addToDisplay(list, depth) {
            list.forEach((task) => {
                displayList.push({ task, depth });
                const children = childrenByParent[task.id] || [];
                if (children.length > 0 && !task.collapsed) {
                    addToDisplay(children, depth + 1);
                }
            });
        }

        addToDisplay(roots, 0);

        return {
            displayList,
            gridWidth: Math.max((totalDays + 1) * dayWidth, dayWidth),
            headerDays,
            minDate,
            totalDays
        };
    });

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
        const { startDate, endDate } = getRenderedDates(task);
        const start = parseLocalDate(startDate);
        const end = parseLocalDate(endDate);
        const offsetDays = (start.getTime() - ganttData.minDate.getTime()) / dayMs;
        const durationDays = (end.getTime() - start.getTime()) / dayMs + 1;

        return {
            left: offsetDays * dayWidth,
            width: Math.max(durationDays * dayWidth, 24)
        };
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
     * @param {string} dateString
     */
    function parseLocalDate(dateString) {
        return new Date(`${dateString}T12:00:00`);
    }

    /**
     * @param {Date} date
     */
    function formatDate(date) {
        const year = date.getFullYear();
        const month = `${date.getMonth() + 1}`.padStart(2, '0');
        const day = `${date.getDate()}`.padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * @param {string} dateString
     * @param {number} offset
     */
    function addDays(dateString, offset) {
        const date = parseLocalDate(dateString);
        date.setDate(date.getDate() + offset);
        return formatDate(date);
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
        suppressBarClick = true;

        resizeState = {
            taskId: task.id,
            edge,
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
        if (!resizeState) return;

        const dayOffset = Math.round((event.clientX - resizeState.originX) / dayWidth);

        if (resizeState.edge === 'start') {
            let nextStartDate = addDays(resizeState.originStartDate, dayOffset);
            if (parseLocalDate(nextStartDate).getTime() > parseLocalDate(resizeState.originEndDate).getTime()) {
                nextStartDate = resizeState.originEndDate;
            }

            resizeState = {
                ...resizeState,
                previewStartDate: nextStartDate
            };
            return;
        }

        let nextEndDate = addDays(resizeState.originEndDate, dayOffset);
        if (parseLocalDate(nextEndDate).getTime() < parseLocalDate(resizeState.originStartDate).getTime()) {
            nextEndDate = resizeState.originStartDate;
        }

        resizeState = {
            ...resizeState,
            previewEndDate: nextEndDate
        };
    }

    function handleResizeEnd() {
        if (!resizeState) return;

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
                    {@const color = getCategoryColor(item.task.category)}
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
