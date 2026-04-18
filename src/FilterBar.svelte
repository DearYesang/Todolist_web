<script>
    import {
        categories,
        filters,
        getCategoryColor,
        setCategoryFilter,
        setPriorityFilter,
        setUrgencyFilter
    } from './store.js';

    const priorityOptions = [
        { value: 'all', label: '전체' },
        { value: 'high', label: '🔴 높음' },
        { value: 'medium', label: '🟡 보통' },
        { value: 'low', label: '🟢 낮음' }
    ];

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
    <button
        class="filter-chip"
        class:active={$filters.category === 'all'}
        onclick={() => setCategoryFilter('all')}>
        전체
    </button>

    {#each $categories as category}
        {@const color = getCategoryColor(category)}
        <button
            class="filter-chip category-chip"
            class:active={$filters.category === category}
            onclick={() => setCategoryFilter(category)}
            style={$filters.category === category ? `background:${color.bg}; color:${color.fg}; border-color:${color.border};` : ''}>
            {category}
        </button>
    {/each}
</div>
