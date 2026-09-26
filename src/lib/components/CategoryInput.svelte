<script>
    import { getCategoryColor } from '$lib/shared/task-domain.js';
    import { suggestCategories } from '$lib/shared/category-suggestions.js';

    /** @type {{
     *   value?: string;
     *   id?: string;
     *   categories?: string[];
     *   taskText?: string;
     *   parentCategory?: string;
     *   placeholder?: string;
     *   onchange?: (value: string) => void;
     *   oncommit?: (value: string) => void;
     * }} */
    let {
        value = $bindable(''),
        id = 'category',
        categories = [],
        taskText = '',
        parentCategory = '',
        placeholder = '예: 개발, 디자인, 마케팅',
        // Called on every keystroke with the text so far.
        onchange = () => {},
        // Called once the name is final: on leaving the field or pressing
        // Enter (the native change event) and on picking a suggestion.
        oncommit = () => {}
    } = $props();

    const listId = $derived(`${id}-list`);
    const suggestions = $derived(
        suggestCategories({
            text: taskText,
            existingCategories: categories,
            parentCategory,
            currentCategory: value
        })
    );

    /** @param {Event} event */
    function handleInput(event) {
        value = /** @type {HTMLInputElement} */ (event.currentTarget).value;
        onchange(value);
    }

    function handleCommit() {
        oncommit(value);
    }

    /**
     * Keeps the focus in the field while a suggestion is pressed, so leaving
     * the field does not commit a half-typed name before the suggestion.
     * @param {MouseEvent} event
     */
    function keepFieldFocus(event) {
        event.preventDefault();
    }

    /** @param {string} nextCategory */
    function applyCategory(nextCategory) {
        value = nextCategory;
        onchange(value);
        oncommit(value);
    }
</script>

<div class="category-input">
    <input
        id={id}
        class="form-input"
        type="text"
        value={value}
        placeholder={placeholder}
        list={listId}
        autocomplete="off"
        oninput={handleInput}
        onchange={handleCommit} />
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
                    onmousedown={keepFieldFocus}
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
