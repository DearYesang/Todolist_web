<script>
    import { tasks, getCategoryColor } from './store.js';
    import { flip } from 'svelte/animate';
    import { fade, slide } from 'svelte/transition';

    let { openTask } = $props();

    const columns = [
        { id: 'todo', title: '할 일' },
        { id: 'doing', title: '진행 중' },
        { id: 'done', title: '완료' }
    ];

    function updateStatus(taskId, newStatus) {
        tasks.update(ts => {
            const task = ts.find(t => t.id === taskId);
            if (task) task.status = newStatus;
            return ts;
        });
    }

    let draggedId = $state(null);

    function onDragStart(e, id) {
        draggedId = id;
        e.dataTransfer.setData('text/plain', id);
        e.dataTransfer.effectAllowed = 'move';
    }

    function onDrop(e, status) {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain');
        if (id) updateStatus(id, status);
        draggedId = null;
    }

    function toggleTaskStatus(taskId) {
        tasks.update(ts => ts.map(t => {
            if (t.id === taskId) {
                const nextStatus = t.status === 'done' ? 'todo' : 'done';
                return {...t, status: nextStatus};
            }
            return t;
        }));
    }
</script>

<div class="board">
    {#each columns as col}
        <div class="column"
             role="list"
             aria-label={col.title}
             ondragover={(e) => e.preventDefault()}
             ondrop={(e) => onDrop(e, col.id)}
             class:drag-over={draggedId !== null}>
            <div class="column-header">
                <span class="column-title">{col.title}</span>
                <span class="column-count">{$tasks.filter(t => t.status === col.id).length}</span>
            </div>

            <div class="task-list">
                {#each $tasks.filter(t => t.status === col.id && !t.parentId) as parent (parent.id)}
                    {@const cc = getCategoryColor(parent.category)}
                    {@const children = $tasks.filter(c => c.parentId === parent.id)}
                    
                    <div class="card stack-card" 
                         role="listitem"
                         draggable="true" 
                         ondragstart={(e) => onDragStart(e, parent.id)} 
                         animate:flip={{duration:250}} out:fade>
                        
                        <div class="card-header">
                            <span class="card-text" 
                                  role="button" 
                                  tabindex="0"
                                  onclick={(e) => { e.stopPropagation(); openTask(parent.id); }}
                                  onkeydown={(e) => e.key === 'Enter' && openTask(parent.id)}>
                                {parent.status === 'done' ? '✅' : '📄'} {parent.text}
                            </span>
                            {#if parent.category}
                                <span class="card-category" style="background:{cc.bg}; color:{cc.fg}; border:1px solid {cc.border}">
                                    {parent.category}
                                </span>
                            {/if}
                        </div>
                        
                        <div class="card-meta">
                            <span class="importance-badge {parent.priority}" title="중요도: {parent.priority}">
                                {parent.priority === 'high' ? '🔴 긴급' : parent.priority === 'medium' ? '🟡 보통' : '🟢 낮음'}
                            </span>
                            <span class="date-tag" role="button" tabindex="0" onclick={(e) => { e.stopPropagation(); openTask(parent.id); }} onkeydown={(e) => e.key === 'Enter' && openTask(parent.id)}>
                                📅 {parent.startDate} ~ {parent.endDate}
                            </span>
                        </div>

                        {#if children.length > 0}
                            <div class="stacked-children">
                                {#each children as child}
                                    <div class="child-card" 
                                         role="button"
                                         tabindex="0"
                                         onclick={() => toggleTaskStatus(child.id)}
                                         onkeydown={(e) => e.key === 'Enter' && toggleTaskStatus(child.id)}
                                         transition:slide>
                                        <span class="child-status {child.status === 'done' ? 'done' : ''}">
                                            {child.status === 'done' ? '☑️' : '⬜'} {child.text}
                                        </span>
                                    </div>
                                {/each}
                            </div>
                        {/if}

                    </div>
                {/each}
            </div>
        </div>
    {/each}
</div>

<style>
    .board {
        display: flex; gap: 20px; margin: 0 auto; max-width: 1400px;
        padding-bottom: 40px;
    }
    .column {
        flex: 1; background: rgba(22, 27, 34, 0.5); border: 1px solid var(--border); border-radius: 12px;
        padding: 16px; display: flex; flex-direction: column; min-height: 600px;
        backdrop-filter: blur(10px); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .column.drag-over { 
        background: rgba(88, 166, 255, 0.1); 
        border-color: var(--accent);
        transform: scale(1.01);
    }
    .column-header { 
        display: flex; justify-content: space-between; align-items: center; 
        padding: 0 4px 16px; border-bottom: 1px solid var(--border-light); margin-bottom: 16px;
    }
    .column-title { font-size: 14px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
    .column-count { background: var(--surface-raised); padding: 2px 8px; border-radius: 10px; font-size: 12px; color: var(--text-muted); }
    
    .stack-card {
        background: var(--surface-raised); border: 1px solid var(--border); border-radius: 10px;
        padding: 16px; margin-bottom: 20px; cursor: grab; position: relative;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15); transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        z-index: 1;
    }
    .stack-card:hover { transform: translateY(-4px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
    .stack-card:active { cursor: grabbing; transform: scale(0.98); }
    
    /* 종이 겹침 디자인 트릭 (고급스러운 레이어드 효과) */
    .stack-card::before, .stack-card::after {
        content: ''; position: absolute; left: 8px; right: 8px; height: 12px;
        background: var(--surface-raised); border: 1px solid var(--border); border-radius: 8px;
        z-index: -1; transition: all 0.3s;
    }
    .stack-card::before { top: -6px; opacity: 0.6; transform: scaleX(0.97); }
    .stack-card::after { top: -12px; opacity: 0.3; transform: scaleX(0.94); }
    
    .stack-card:hover::before { top: -8px; opacity: 0.8; }
    .stack-card:hover::after { top: -16px; opacity: 0.5; }
    
    .card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
    .card-text { font-size: 15px; font-weight: 600; color: var(--text); line-height: 1.4; }
    .card-category { font-size: 10px; padding: 2px 8px; border-radius: 4px; font-weight: 700; text-transform: uppercase; }
    
    .card-meta { font-size: 11px; color: var(--text-muted); margin-bottom: 12px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    
    .importance-badge {
        font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 4px; text-transform: uppercase;
        background: var(--surface-hover); border: 1px solid var(--border);
    }
    .importance-badge.high { color: var(--priority-high); border-color: var(--priority-high); background: var(--priority-high-bg); }
    .importance-badge.medium { color: var(--priority-medium); border-color: var(--priority-medium); background: var(--priority-medium-bg); }
    .importance-badge.low { color: var(--priority-low); border-color: var(--priority-low); background: var(--priority-low-bg); }

    .date-tag {
        display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; 
        background: var(--bg); border: 1px solid var(--border); border-radius: 4px; cursor: pointer;
    }
    .date-tag:hover { border-color: var(--accent); color: var(--text); }
</style>
