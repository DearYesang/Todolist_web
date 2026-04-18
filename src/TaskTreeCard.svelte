<script>
    import TaskTreeCard from './TaskTreeCard.svelte';
    import {
        addSubtask,
        deleteSubtask,
        deleteTaskCascade,
        getCategoryColor,
        moveTask,
        PRIORITY_LABELS,
        renameSubtask,
        STATUS_LABELS,
        toggleCollapse,
        toggleSubtask,
        URGENCY_LABELS
    } from './store.js';

    let {
        task,
        allTasks,
        childrenByParent,
        depth = 0,
        draggedId = null,
        openTask,
        onDragStart,
        onDragEnd,
        onDropOnTask
    } = $props();

    let isDragOver = $state(false);
    let newSubtaskText = $state('');

    const children = $derived(childrenByParent[task.id] || []);
    const directChildren = $derived(allTasks.filter((candidate) => candidate.parentId === task.id));
    const doneChildrenCount = $derived(directChildren.filter((candidate) => candidate.status === 'done').length);
    const foreignParent = $derived.by(() => {
        if (!task.parentId) return null;
        const parent = allTasks.find((candidate) => candidate.id === task.parentId) || null;
        return parent && parent.status !== task.status ? parent : null;
    });
    const categoryColor = $derived(getCategoryColor(task.category));
    const completedSubtasks = $derived(task.subtasks.filter((subtask) => subtask.done).length);
    const subtaskProgress = $derived(task.subtasks.length === 0 ? 0 : Math.round((completedSubtasks / task.subtasks.length) * 100));

    function handleOpenTask(event) {
        event.stopPropagation();
        openTask(task.id);
    }

    function handleDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        isDragOver = false;
        onDropOnTask(event, task.id);
    }

    function handleAddSubtask(event) {
        event.stopPropagation();
        if (!newSubtaskText.trim()) return;

        addSubtask(task.id, newSubtaskText);
        newSubtaskText = '';
    }

    function handleSubtaskKeydown(event) {
        if (event.key === 'Enter') {
            handleAddSubtask(event);
        }
    }

    function handleDeleteTask(event) {
        event.stopPropagation();
        const message = directChildren.length > 0
            ? `이 작업에는 ${directChildren.length}개의 하위 작업이 있습니다.\n모두 함께 삭제하시겠습니까?`
            : '이 작업을 삭제하시겠습니까?';

        if (confirm(message)) {
            deleteTaskCascade(task.id);
        }
    }

    /**
     * @param {'todo' | 'doing' | 'done'} nextStatus
     * @param {MouseEvent} event
     */
    function handleMove(nextStatus, event) {
        event.stopPropagation();
        moveTask(task.id, nextStatus);
    }

    /**
     * @param {{ id: string; text: string }} subtask
     * @param {MouseEvent} event
     */
    function handleRenameSubtask(subtask, event) {
        event.stopPropagation();
        const nextText = prompt('체크리스트 내용을 수정하세요:', subtask.text);
        if (nextText !== null && nextText.trim()) {
            renameSubtask(task.id, subtask.id, nextText);
        }
    }

    /**
     * @param {string} text
     */
    function getSubtaskParts(text) {
        const urlPattern = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
        /** @type {{ type: 'text' | 'url'; value: string }[]} */
        const parts = [];
        let lastIndex = 0;

        for (const match of text.matchAll(urlPattern)) {
            const value = match[0];
            const index = match.index ?? 0;

            if (index > lastIndex) {
                parts.push({
                    type: 'text',
                    value: text.slice(lastIndex, index)
                });
            }

            parts.push({
                type: 'url',
                value
            });

            lastIndex = index + value.length;
        }

        if (lastIndex < text.length) {
            parts.push({
                type: 'text',
                value: text.slice(lastIndex)
            });
        }

        return parts.length > 0 ? parts : [{ type: 'text', value: text }];
    }

    /**
     * @param {string} url
     */
    function getHref(url) {
        return url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
    }
</script>

<div
    class="task-card"
    class:child-card={depth > 0}
    class:drag-over-card={isDragOver && draggedId !== task.id}
    data-priority={task.priority}
    draggable="true"
    role="listitem"
    style={depth > 0 ? `margin-left:${depth * 32}px;` : ''}
    ondragstart={(event) => onDragStart(event, task.id)}
    ondragend={onDragEnd}
    ondragover={(event) => event.preventDefault()}
    ondragenter={(event) => {
        event.preventDefault();
        event.stopPropagation();
        isDragOver = draggedId !== null && draggedId !== task.id;
    }}
    ondragleave={(event) => {
        event.stopPropagation();
        isDragOver = false;
    }}
    ondrop={handleDrop}>
    <div class="card-meta">
        <span class="priority-badge {task.priority}">{PRIORITY_LABELS[task.priority]}</span>
        <span class="urgency-badge {task.urgency}">{URGENCY_LABELS[task.urgency]}</span>

        {#if task.category}
            <span
                class="category-tag"
                style={`background:${categoryColor.bg}; color:${categoryColor.fg}; border-color:${categoryColor.border};`}>
                {task.category}
            </span>
        {:else}
            <button class="category-tag add-category" onclick={handleOpenTask}>+ 카테고리</button>
        {/if}

        {#if foreignParent}
            <span class="parent-indicator">
                {foreignParent.text}
                <span class="parent-status">({STATUS_LABELS[foreignParent.status]})</span>
            </span>
        {/if}

        {#if directChildren.length > 0}
            <button
                class="collapse-toggle"
                class:collapsed={task.collapsed}
                title={task.collapsed ? '펼치기' : '접기'}
                onclick={(event) => {
                    event.stopPropagation();
                    toggleCollapse(task.id);
                }}>
                ▼
            </button>
        {/if}
    </div>

    <div class="card-text" role="button" tabindex="0" onclick={handleOpenTask} onkeydown={(event) => event.key === 'Enter' && openTask(task.id)}>
        {task.text}
    </div>

    <button class="date-tag" onclick={handleOpenTask}>
        📅 {task.startDate} ~ {task.endDate}
    </button>

    {#if directChildren.length > 0}
        <div class="children-info">
            📎 하위 작업 {directChildren.length}개 (완료 {doneChildrenCount}/{directChildren.length})
        </div>
    {/if}

    <div class="subtask-section">
        {#if task.subtasks.length > 0}
            <div class="subtask-header">
                <span class="subtask-progress-info">체크리스트 {completedSubtasks}/{task.subtasks.length}</span>
            </div>
            <div class="progress-bar-container">
                <div class="progress-bar-fill" style={`width:${subtaskProgress}%`}></div>
            </div>
            <div class="subtask-list">
                {#each task.subtasks as subtask (subtask.id)}
                    <div class="subtask-item">
                        <input
                            type="checkbox"
                            checked={subtask.done}
                            onchange={() => toggleSubtask(task.id, subtask.id)}
                            onclick={(event) => event.stopPropagation()} />
                        <span class="subtask-text" class:done={subtask.done}>
                            {#each getSubtaskParts(subtask.text) as part, index (`${subtask.id}-${index}`)}
                                {#if part.type === 'url'}
                                    <a
                                        class="subtask-link"
                                        href={getHref(part.value)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onclick={(event) => event.stopPropagation()}>
                                        {part.value}
                                    </a>
                                {:else}
                                    {part.value}
                                {/if}
                            {/each}
                        </span>
                        <button class="subtask-action edit" onclick={(event) => handleRenameSubtask(subtask, event)}>✏️</button>
                        <button class="subtask-action delete" onclick={(event) => {
                            event.stopPropagation();
                            deleteSubtask(task.id, subtask.id);
                        }}>×</button>
                    </div>
                {/each}
            </div>
        {/if}

        <div class="add-subtask-row">
            <input
                class="add-subtask-input"
                type="text"
                bind:value={newSubtaskText}
                placeholder="+ 체크리스트 추가..."
                onclick={(event) => event.stopPropagation()}
                onkeydown={handleSubtaskKeydown} />
            <button class="btn btn-ghost" onclick={handleAddSubtask}>+</button>
        </div>
    </div>

    <div class="card-actions">
        <div class="move-btns">
            {#if task.status === 'todo'}
                <button class="btn btn-move" onclick={(event) => handleMove('doing', event)}>진행 중으로 →</button>
            {:else if task.status === 'doing'}
                <button class="btn btn-move" onclick={(event) => handleMove('todo', event)}>← 할 일</button>
                <button class="btn btn-move" onclick={(event) => handleMove('done', event)}>완료 →</button>
            {:else}
                <button class="btn btn-move" onclick={(event) => handleMove('doing', event)}>← 진행 중</button>
            {/if}
        </div>

        <button class="btn btn-danger" onclick={handleDeleteTask}>🗑</button>
    </div>
</div>

{#if children.length > 0 && !task.collapsed}
    {#each children as child (child.id)}
        <TaskTreeCard
            allTasks={allTasks}
            childrenByParent={childrenByParent}
            depth={depth + 1}
            draggedId={draggedId}
            openTask={openTask}
            onDragEnd={onDragEnd}
            onDragStart={onDragStart}
            onDropOnTask={onDropOnTask}
            task={child} />
    {/each}
{/if}
