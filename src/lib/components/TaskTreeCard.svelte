<script>
    import { onDestroy } from 'svelte';
    import TaskTreeCard from './TaskTreeCard.svelte';
    import OpenLinksButton from './OpenLinksButton.svelte';
    import { getBoardContext } from './board-context.js';
    import { DND_ZONE_ATTRIBUTE } from '$lib/client/pointer-dnd.js';
    import {
        addSubtask,
        deleteSubtask,
        deleteTaskCascade,
        moveTask,
        renameSubtask,
        taskIndex,
        toggleCollapse,
        toggleSubtask
    } from '$lib/client/task-store.js';
    import { downloadTaskCalendar } from '$lib/client/calendar-download.js';
    import {
        getCategoryColor,
        getDeleteTaskConfirmMessage,
        getTaskDueStatus,
        PRIORITY_LABELS,
        STATUS_LABELS,
        URGENCY_LABELS
    } from '$lib/shared/task-domain.js';
    import { collectSubtreeLinks, extractTaskLinks, splitTextIntoLinkParts } from '$lib/shared/task-links.js';
    import { createImeCompositionGuard } from '$lib/client/ime-keyboard.js';

    /** @type {{
     *   task: import('$lib/shared/task-domain.js').Task;
     *   childrenByParent: Record<string, import('$lib/shared/task-domain.js').Task[]>;
     *   depth?: number;
     * }} */
    let {
        task,
        childrenByParent,
        depth = 0
    } = $props();

    // The same for every card on the board, at every depth.
    const { dnd, openTask } = getBoardContext();

    /**
     * @param {HTMLElement} node
     * @param {string} id
     */
    function cardDraggable(node, id) {
        return dnd.controller.draggable(node, id);
    }
    let newSubtaskText = $state('');
    const subtaskComposition = createImeCompositionGuard();
    onDestroy(() => subtaskComposition.reset());

    const children = $derived(childrenByParent[task.id] || []);
    // taskIndex covers the full task list, so a card finds its children and
    // parent without scanning every task.
    const directChildren = $derived($taskIndex.childrenByParentId.get(task.id) ?? []);
    const doneChildrenCount = $derived(directChildren.filter((candidate) => candidate.status === 'done').length);
    const dueStatus = $derived(getTaskDueStatus(task));
    const foreignParent = $derived.by(() => {
        if (!task.parentId) return null;
        const parent = $taskIndex.byId.get(task.parentId) || null;
        return parent && parent.status !== task.status ? parent : null;
    });
    const categoryColor = $derived(getCategoryColor(task.category, task.categoryMeta?.color));
    const completedSubtasks = $derived(task.subtasks.filter((subtask) => subtask.done).length);
    const subtaskProgress = $derived(task.subtasks.length === 0 ? 0 : Math.round((completedSubtasks / task.subtasks.length) * 100));
    /** @type {Record<string, import('$lib/shared/task-links.js').LinkPart[]>} */
    const subtaskParts = $derived(Object.fromEntries(
        task.subtasks.map((subtask) => [subtask.id, splitTextIntoLinkParts(subtask.text)])
    ));
    const ownLinks = $derived(extractTaskLinks(task));
    // Walks the full task index, not the column-filtered childrenByParent, so
    // collapsed, filtered and other-column descendants still count.
    const subtreeLinks = $derived(directChildren.length > 0 ? collectSubtreeLinks($taskIndex, task.id) : ownLinks);

    /**
     * @param {MouseEvent} event
     */
    function handleOpenTask(event) {
        event.stopPropagation();
        openTask(task.id);
    }

    /**
     * @param {Event} event
     */
    function handleAddSubtask(event) {
        event.preventDefault();
        event.stopPropagation();
        if (!newSubtaskText.trim()) return;

        addSubtask(task.id, newSubtaskText);
        newSubtaskText = '';
    }

    function handleSubtaskCompositionStart() {
        subtaskComposition.start();
    }

    /**
     * @param {CompositionEvent} event
     */
    function handleSubtaskCompositionEnd(event) {
        subtaskComposition.end();
        newSubtaskText = /** @type {HTMLInputElement} */ (event.currentTarget).value;
    }

    /**
     * @param {KeyboardEvent} event
     */
    function handleSubtaskKeydown(event) {
        if (event.key !== 'Enter') {
            return;
        }

        event.stopPropagation();
        if (subtaskComposition.shouldIgnoreEnter(event)) {
            return;
        }

        handleAddSubtask(event);
    }

    /**
     * @param {MouseEvent} event
     */
    function handleDeleteTask(event) {
        event.stopPropagation();
        if (confirm(getDeleteTaskConfirmMessage(directChildren.length))) {
            deleteTaskCascade(task.id);
        }
    }

    /**
     * @param {MouseEvent} event
     */
    function handleCalendarDownload(event) {
        event.stopPropagation();
        downloadTaskCalendar(task);
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
</script>

<div
    class="task-card"
    class:child-card={depth > 0}
    class:drag-over-card={dnd.cardDrops
        && dnd.state.hoveredZone === `card:${task.id}`
        && dnd.state.draggedId !== task.id}
    data-priority={task.priority}
    role="listitem"
    style={depth > 0 ? `margin-left:${depth * 32}px;` : ''}
    use:cardDraggable={task.id}
    {...(dnd.cardDrops ? { [DND_ZONE_ATTRIBUTE]: `card:${task.id}` } : {})}>
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
                aria-label={task.collapsed ? `${task.text} 하위 작업 펼치기` : `${task.text} 하위 작업 접기`}
                aria-expanded={!task.collapsed}
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

    <button
        class="date-tag"
        class:overdue={dueStatus === 'overdue'}
        class:due-today={dueStatus === 'due-today'}
        onclick={handleOpenTask}>
        {dueStatus === 'overdue' ? '⚠️' : '📅'} {task.startDate} ~ {task.endDate}{dueStatus === 'overdue' ? ' · 기한 초과' : dueStatus === 'due-today' ? ' · 오늘 마감' : ''}
    </button>

    {#if directChildren.length > 0}
        <div class="children-info">
            <span>📎 하위 작업 {directChildren.length}개 (완료 {doneChildrenCount}/{directChildren.length})</span>
            {#if subtreeLinks.length > ownLinks.length}
                <OpenLinksButton
                    links={subtreeLinks}
                    title={`${task.text} (하위 포함)`}
                    label={`하위 포함 모두 열기 (${subtreeLinks.length})`}
                    description={`하위 작업 포함 링크 ${subtreeLinks.length}개를 새 탭에서 모두 열기`} />
            {/if}
        </div>
    {/if}

    <div class="subtask-section">
        {#if task.subtasks.length > 0}
            <div class="subtask-header">
                <span class="subtask-progress-info">체크리스트 {completedSubtasks}/{task.subtasks.length}</span>
                <OpenLinksButton
                    links={ownLinks}
                    title={task.text}
                    label={`모두 열기 (${ownLinks.length})`}
                    description={`체크리스트 링크 ${ownLinks.length}개를 새 탭에서 모두 열기`} />
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
                            {#each subtaskParts[subtask.id] ?? [] as part, index (`${subtask.id}-${index}`)}
                                {#if part.type === 'url'}
                                    <a
                                        class="subtask-link"
                                        href={part.href}
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
                        <button
                            class="subtask-action edit"
                            aria-label={`${subtask.text} 수정`}
                            title="수정"
                            onclick={(event) => handleRenameSubtask(subtask, event)}>✏️</button>
                        <button class="subtask-action delete" aria-label={`${subtask.text} 삭제`} title="삭제" onclick={(event) => {
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
                oncompositionstart={handleSubtaskCompositionStart}
                oncompositionend={handleSubtaskCompositionEnd}
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

        <div class="card-secondary-actions">
            <button class="btn btn-calendar btn-small" onclick={handleCalendarDownload}>📅 일정 추가</button>
            <button class="btn btn-danger" aria-label={`${task.text} 삭제`} title="작업 삭제" onclick={handleDeleteTask}>🗑</button>
        </div>
    </div>
</div>

{#if children.length > 0 && !task.collapsed}
    {#each children as child (child.id)}
        <TaskTreeCard
            childrenByParent={childrenByParent}
            depth={depth + 1}
            task={child} />
    {/each}
{/if}
