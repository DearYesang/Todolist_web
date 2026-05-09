<script>
    import { getCategoryColor } from '$lib/shared/task-domain.js';
    import { suggestCategories } from '$lib/shared/category-suggestions.js';

    let {
        value = $bindable(''),
        id = 'category',
        categories = [],
        taskText = '',
        parentCategory = '',
        placeholder = '예: 개발, 디자인, 마케팅',
        onchange = () => {}
    } = $props();

    const listId = $derived(`${id}-list`);
    const suggestions = $derived(suggestCategories({
        text: taskText,
        existingCategories: categories,
        parentCategory,
        currentCategory: value
    }));

    /** @param {Event} event */
    function handleInput(event) {
        value = /** @type {HTMLInputElement} */ (event.currentTarget).value;
        onchange(value);
    }

    /** @param {string} nextCategory */
    function applyCategory(nextCategory) {
        value = nextCategory;
        onchange(value);
    }
</script>

<div class="category-input">
    <input
        id={id}
        class="form-input"
        type="text"
        value={value}
        {placeholder}
        list={listId}
        autocomplete="off"
        oninput={handleInput} />
    <datalist id={listId}>
        {#each categories as categoryOption}
            <option value={categoryOption}></option>
        {/each}
    </datalist>

    {#if suggestions.length > 0}
        <div class="category-suggestions" aria-label="카테고리 추천">
            {#each suggestions as suggestion}
                {@const color = getCategoryColor(suggestion.name)}
                <button
                    class="category-suggestion-chip"
                    type="button"
                    title={suggestion.reason}
                    onclick={() => applyCategory(suggestion.name)}
                    style={`--category-fg:${color.fg}; --category-bg:${color.bg}; --category-border:${color.border};`}>
                    <span class="category-suggestion-dot" aria-hidden="true"></span>
                    <span>{suggestion.name}</span>
                    <small>{suggestion.reason}</small>
                </button>
            {/each}
        </div>
    {/if}
</div>
