<script>
    import { tasks, getCategoryColor } from './store.js';

    let { openTask } = $props();

    // Svelte 5 Runes: Derived states
    const ganttData = $derived.by(() => {
        let minDate = new Date('2099-12-31');
        let maxDate = new Date('2000-01-01');

        $tasks.forEach((/** @type {any} */ t) => {
            const s = new Date(t.startDate);
            const e = new Date(t.endDate);
            if (s < minDate) minDate = new Date(s);
            if (e > maxDate) maxDate = new Date(e);
        });

        if ($tasks.length === 0) {
            minDate = new Date();
            maxDate = new Date();
        }

        minDate.setDate(minDate.getDate() - 3);
        maxDate.setDate(maxDate.getDate() + 5);

        const totalDays = Math.round((maxDate.getTime() - minDate.getTime()) / 86400000);

        const headerDays = [];
        for (let i = 0; i <= totalDays; i++) {
            let d = new Date(minDate);
            d.setDate(d.getDate() + i);
            headerDays.push({
                label: `${d.getMonth()+1}/${d.getDate()}`,
                isToday: d.toISOString().split('T')[0] === new Date().toISOString().split('T')[0]
            });
        }

        // --- Row Packing ---
        /** @type {any[][]} */
        let packedRows = [];
        let sortedTasks = [...$tasks].sort((a,b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

        sortedTasks.forEach((/** @type {any} */ task) => {
            const sTime = new Date(task.startDate).getTime();
            const eTime = new Date(task.endDate).getTime();
            
            let placed = false;
            for (let row of packedRows) {
                const lastTaskInRow = row[row.length - 1];
                const lastTaskETime = new Date(lastTaskInRow.endDate).getTime();
                
                if (sTime > lastTaskETime) {
                    row.push(task);
                    placed = true;
                    break;
                }
            }
            if (!placed) {
                packedRows.push([task]);
            }
        });

        return { minDate, maxDate, totalDays, headerDays, packedRows };
    });

    const dayWidth = 48; // px

    /** @param {any} task */
    function getCoords(task) {
        const s = new Date(task.startDate);
        const e = new Date(task.endDate);
        const offsetDays = (s.getTime() - ganttData.minDate.getTime()) / 86400000;
        const durationDays = (e.getTime() - s.getTime()) / 86400000 + 1;
        return {
            left: offsetDays * dayWidth,
            width: durationDays * dayWidth
        };
    }
</script>

<div class="gantt-board">
    <div class="gantt-timeline-area">
        <div class="gantt-header-row">
            {#each ganttData.headerDays as day}
                <div class="gantt-day-header" class:today={day.isToday}>{day.label}</div>
            {/each}
        </div>
        <div class="gantt-timeline">
            {#if ganttData.packedRows.length === 0}
                <div class="empty-state">일정을 그릴 작업이 없습니다.</div>
            {/if}

            {#each ganttData.packedRows as row, i (i)}
                <div class="gantt-row">
                    {#each row as task (task.id)}
                        {@const coords = getCoords(task)}
                        {@const cc = getCategoryColor(task.category) || { bg: '#333', fg: '#aaa', border: '#444' }}
                        {@const isDone = task.status === 'done'}
                        
                        <!-- 막대에 마우스를 올렸을 때 전체 툴팁을 보고 이름을 확인하도록 변경 -->
                        <div class="gantt-bar-wrapper" 
                             style="left: {coords.left}px; width: {coords.width}px;" 
                             title="{task.text} ({task.startDate} ~ {task.endDate})">
                            <div class="gantt-bar {isDone?'done':''}" 
                                 role="button"
                                 tabindex="0"
                                 onclick={() => openTask(task.id)}
                                 onkeydown={(e) => e.key === 'Enter' && openTask(task.id)}
                                 style="background: {cc.fg}; border: 1px solid {cc.border};">
                                <!-- 막대 내부에 작업명 텍스트 표시 (공간 압축 모드 전용) -->
                                <span class="bar-inner-text">{task.text}</span>
                            </div>
                        </div>
                    {/each}
                </div>
            {/each}
        </div>
    </div>
</div>



<style>
    .gantt-board {
        max-width: 1320px; margin: 0 auto; padding: 0 24px 30px; display: flex; align-items: flex-start;
    }
    .gantt-timeline-area {
        flex: 1; overflow-x: auto; background: var(--surface); border: 1px solid var(--border);
        border-radius: var(--radius); position: relative;
    }
    .gantt-header-row {
        display: flex; border-bottom: 1px solid var(--border); position: sticky; top: 0;
        background: var(--surface-raised); z-index: 10; min-width: max-content;
    }
    .gantt-day-header {
        flex-shrink: 0; width: 48px; text-align: center; font-size: 11px; color: var(--text-muted);
        padding: 8px 0; border-right: 1px dashed var(--border);
    }
    .gantt-day-header.today { color: var(--accent); font-weight: 600; background: rgba(88, 166, 255, 0.1); }
    
    .gantt-timeline {
        position: relative; padding-top: 10px; padding-bottom: 20px; min-width: max-content;
        background-image: linear-gradient(to right, var(--border) 1px, transparent 1px);
        background-size: 48px 100%;
    }
    .gantt-row {
        display: flex; align-items: center; height: 44px; position: relative;
        border-bottom: 1px solid var(--border-light);
    }
    .gantt-row:hover { background: var(--surface-hover); }
    
    .gantt-bar-wrapper {
        position: absolute; height: 28px; top: 8px; transition: all 0.2s;
    }
    .gantt-bar {
        width: 100%; height: 100%; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        cursor: pointer; position: relative; min-width: 24px; opacity: 0.9;
        display: flex; align-items: center; padding: 0 8px; overflow: hidden;
    }
    .gantt-bar:hover { transform: scaleY(1.1); filter: brightness(1.2); opacity: 1; z-index: 5; }
    .gantt-bar.done { background: #484f58 !important; border-color: var(--border) !important; opacity: 0.5; box-shadow: none; }
    
    .bar-inner-text {
        font-size: 12px; color: #fff; white-space: nowrap; overflow: hidden;
        text-overflow: ellipsis; font-weight: 600; text-shadow: 0 1px 2px rgba(0,0,0,0.5);
    }
    .empty-state { text-align: center; padding: 30px; color: var(--text-muted); font-size: 13px; }
</style>
