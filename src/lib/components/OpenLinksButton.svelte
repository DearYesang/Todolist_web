<script>
    import { requestOpenLinks } from '$lib/client/link-opener.js';

    /** @type {{
     *   links: import('$lib/shared/task-links.js').TaskLink[];
     *   title: string;
     *   label: string;
     *   description: string;
     * }} */
    let { links, title, label, description } = $props();

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
    <!-- The visible label is the accessible name (voice control matches what
         is on screen); the longer wording is the tooltip and description. -->
    <button
        type="button"
        class="btn btn-small btn-open-links"
        title={description}
        onclick={handleClick}>
        <span aria-hidden="true">🔗</span>
        <span>{label}</span>
    </button>
{/if}
