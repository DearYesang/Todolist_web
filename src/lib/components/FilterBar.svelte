<script>
    import {
        filters,
        setCategoryFilter,
        setPriorityFilter,
        setUrgencyFilter,
        visibleCategorySummaries
    } from '$lib/client/task-store.js';
    import { getCategoryColor } from '$lib/shared/task-domain.js';
    import CategoryManager from './CategoryManager.svelte';

    let isCategoryManagerOpen = $state(false);

    /** @type {{ value: import('$lib/shared/task-domain.js').PriorityFilter; label: string }[]} */
    const priorityOptions = [
        { value: 'all', label: '전체' },
        { value: 'high', label: '🔴 높음' },
        { value: 'medium', label: '🟡 보통' },
        { value: 'low', label: '🟢 낮음' }
    ];

    /** @type {{ value: import('$lib/shared/task-domain.js').UrgencyFilter; label: string }[]} */
    const urgencyOptions = [
        { value: 'all', label: '전체' },
        { value: 'urgent', label: '🔥 시급' },
        { value: 'normal', label: '⏳ 여유' }
    ];
</script>

<div class="filter-bar">
    <span class="filter-label">필터</span>

    {#each priorityOptions as option}
        <button
            class="filter-chip"
            class:active={$filters.priority === option.value}
            onclick={() => setPriorityFilter(option.value)}>
            {option.label}
        </button>
    {/each}

    <div class="filter-divider"></div>
    <span class="filter-label">시급성</span>

    {#each urgencyOptions as option}
        <button
            class="filter-chip"
            class:active={$filters.urgency === option.value}
            onclick={() => setUrgencyFilter(option.value)}>
            {option.label}
        </button>
    {/each}

    <div class="filter-divider"></div>
    <span class="filter-label">카테고리</span>
    <button class="filter-chip manage-categories-chip" onclick={() => isCategoryManagerOpen = true}>
        관리
    </button>
    <button
        class="filter-chip"
        class:active={$filters.category === 'all'}
        onclick={() => setCategoryFilter('all')}>
        전체
    </button>

    {#each $visibleCategorySummaries as category}
        {@const color = getCategoryColor(category.name, category.color)}
        <button
            class="filter-chip category-chip"
            class:active={category.id ? $filters.categoryId === category.id : $filters.category === category.name}
            onclick={() => setCategoryFilter(category.id ?? category.name, category.name)}
            style={(category.id ? $filters.categoryId === category.id : $filters.category === category.name) ? `background:${color.bg}; color:${color.fg}; border-color:${color.border};` : ''}>
            <span>{category.name}</span>
            <small>{category.active}</small>
        </button>
    {/each}
</div>

{#if isCategoryManagerOpen}
    <CategoryManager onclose={() => isCategoryManagerOpen = false} />
{/if}
