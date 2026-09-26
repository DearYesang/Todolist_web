<script>
    import { getCategoryColor, PRIORITY_LABELS, URGENCY_LABELS } from '$lib/shared/task-domain.js';

    /** @type {{
     *   task: import('$lib/shared/task-domain.js').Task;
     *   variant: 'card' | 'summary';
     *   onaddcategory?: (event: MouseEvent) => void;
     * }} */
    let { task, variant, onaddcategory } = $props();

    // A card and the detail panel's summary row show the same chips under
    // their own class names, which the stylesheets and the e2e tests use.
    const CLASS_NAMES = {
        card: {
            priority: 'priority-badge',
            urgency: 'urgency-badge',
            category: 'category-tag'
        },
        summary: {
            priority: 'summary-chip priority-chip',
            urgency: 'summary-chip urgency-chip',
            category: 'summary-chip category-chip'
        }
    };

    const classNames = $derived(CLASS_NAMES[variant]);
    const categoryColor = $derived(getCategoryColor(task.category, task.categoryMeta?.color));
</script>

<!-- Without a category, a card offers to add one when given onaddcategory. -->
<span class="{classNames.priority} {task.priority}">{PRIORITY_LABELS[task.priority]}</span>
<span class="{classNames.urgency} {task.urgency}">{URGENCY_LABELS[task.urgency]}</span>

{#if task.category}
    <span
        class={classNames.category}
        style={`background:${categoryColor.bg}; color:${categoryColor.fg}; border-color:${categoryColor.border};`}>
        {task.category}
    </span>
{:else if onaddcategory}
    <button class="{classNames.category} add-category" onclick={onaddcategory}>+ 카테고리</button>
{/if}
