<script>
    import { buildHierarchy, filters, getCategoryColor, getFilteredTasks, tasks } from './store.js';

    let { openTask } = $props();

    const dayWidth = 48;
    /** @type {HTMLDivElement | null} */
    let timelineArea = $state(null);

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

        let minDate = new Date('2099-12-31');
        let maxDate = new Date('2000-01-01');

        visibleTasks.forEach((task) => {
            const start = new Date(task.startDate);
            const end = new Date(task.endDate);
            if (start < minDate) minDate = new Date(start);
            if (end > maxDate) maxDate = new Date(end);
        });

        minDate.setDate(minDate.getDate() - 3);
        maxDate.setDate(maxDate.getDate() + 5);

        const totalDays = Math.round((maxDate.getTime() - minDate.getTime()) / 86400000);
        const headerDays = [];

        for (let index = 0; index <= totalDays; index += 1) {
            const date = new Date(minDate);
            date.setDate(date.getDate() + index);
            headerDays.push({
                key: date.toISOString(),
                label: `${date.getMonth() + 1}/${date.getDate()}`,
                isToday: date.toISOString().split('T')[0] === new Date().toISOString().split('T')[0]
            });
        }

        const { roots, childrenByParent } = buildHierarchy(visibleTasks);
        /** @type {{ task: import('./store.js').Task; depth: number }[]} */
        const displayList = [];

        /**
         * @param {import('./store.js').Task[]} list
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

    /**
     * @param {import('./store.js').Task} task
     */
    function getCoords(task) {
        const start = new Date(task.startDate);
        const end = new Date(task.endDate);
        const offsetDays = (start.getTime() - ganttData.minDate.getTime()) / 86400000;
        const durationDays = (end.getTime() - start.getTime()) / 86400000 + 1;

        return {
            left: offsetDays * dayWidth,
            width: Math.max(durationDays * dayWidth, 24)
        };
    }

    /**
     * @param {WheelEvent} event
     */
    function handleTimelineWheel(event) {
        if (!timelineArea || timelineArea.scrollWidth <= timelineArea.clientWidth) return;
        if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;

        event.preventDefault();

        const deltaMultiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? 16
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                ? timelineArea.clientWidth
                : 1;
        const scrollDelta = event.deltaY * deltaMultiplier;

        timelineArea.scrollBy({
            left: scrollDelta,
            behavior: Math.abs(scrollDelta) > dayWidth * 2 ? 'smooth' : 'auto'
        });
    }
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
                    <div
                        class="gantt-sidebar-item"
                        class:done={item.task.status === 'done'}
                        style={`padding-left:${16 + item.depth * 24}px;`}>
                        {#if item.depth > 0}
                            <div class="gantt-link-line"></div>
                        {/if}
                        <span
                            role="button"
                            tabindex="0"
                            onclick={() => openTask(item.task.id)}
                            onkeydown={(event) => event.key === 'Enter' && openTask(item.task.id)}>
                            {item.task.status === 'done' ? '☑️' : '🗓️'} {item.task.text}
                        </span>
                    </div>
                {/each}
            {/if}
        </div>
    </div>

    <div
        class="gantt-timeline-area"
        bind:this={timelineArea}
        onwheel={handleTimelineWheel}>
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
                    <div class="gantt-row">
                        <div class="gantt-bar-wrapper" style={`left:${coords.left}px; width:${coords.width}px;`}>
                            <div
                                class="gantt-bar"
                                class:done={item.task.status === 'done'}
                                role="button"
                                tabindex="0"
                                title={`${item.task.text} (${item.task.startDate} ~ ${item.task.endDate})`}
                                onclick={() => openTask(item.task.id)}
                                onkeydown={(event) => event.key === 'Enter' && openTask(item.task.id)}
                                style={`background:${color.fg}; border-color:${color.border};`}>
                                <span class="bar-inner-text">{item.task.text}</span>
                            </div>
                        </div>
                    </div>
                {/each}
            {/if}
        </div>
    </div>
</div>
