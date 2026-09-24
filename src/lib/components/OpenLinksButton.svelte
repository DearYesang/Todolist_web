<script>
    import { requestOpenLinks } from '$lib/client/link-opener.js';

    /** @type {{
     *   links: import('$lib/shared/task-links.js').TaskLink[];
     *   title: string;
     *   label: string;
     *   ariaLabel: string;
     * }} */
    let { links, title, label, ariaLabel } = $props();

    /**
     * Must stay synchronous: window.open only gets the click's user
     * activation while this handler is still running.
     * @param {MouseEvent} event
     */
    function handleClick(event) {
        event.stopPropagation();
        requestOpenLinks(links, { title });
    }
</script>

{#if links.length >= 2}
    <button
        type="button"
        class="btn btn-small btn-open-links"
        aria-label={ariaLabel}
        title={ariaLabel}
        onclick={handleClick}>
        <span aria-hidden="true">🔗</span>
        <span>{label}</span>
    </button>
{/if}
