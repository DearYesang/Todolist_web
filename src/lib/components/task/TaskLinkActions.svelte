<script>
    import { taskIndex } from '$lib/client/task-store.js';
    import { collectSubtreeLinks, extractTaskLinks } from '$lib/shared/task-links.js';
    import OpenLinksButton from '../OpenLinksButton.svelte';

    /** @type {{
     *   task: import('$lib/shared/task-domain.js').Task;
     *   show: 'own' | 'subtree' | 'both';
     * }} */
    let { task, show } = $props();

    const ownLinks = $derived(extractTaskLinks(task));
    // Walks the full task index, not a lane's filtered children, so
    // collapsed, filtered and other-column descendants still count. It
    // starts with ownLinks, so it is never the shorter list.
    const subtreeLinks = $derived(
        show !== 'own' && $taskIndex.childrenByParentId.has(task.id)
            ? collectSubtreeLinks($taskIndex, task.id)
            : ownLinks
    );
</script>

{#snippet ownButton()}
    <OpenLinksButton
        links={ownLinks}
        title={task.text}
        label={`모두 열기 (${ownLinks.length})`}
        description={`체크리스트 링크 ${ownLinks.length}개를 새 탭에서 모두 열기`} />
{/snippet}

{#snippet subtreeButton()}
    {#if subtreeLinks.length > ownLinks.length}
        <OpenLinksButton
            links={subtreeLinks}
            title={`${task.text} (하위 포함)`}
            label={`하위 포함 모두 열기 (${subtreeLinks.length})`}
            description={`하위 작업 포함 링크 ${subtreeLinks.length}개를 새 탭에서 모두 열기`} />
    {/if}
{/snippet}

<!-- A card shows its own links in the checklist header and the subtree's
     in the children row. The detail panel shows both in one row, and no
     row when neither button would show: OpenLinksButton needs 2 links. -->
{#if show === 'own'}
    {@render ownButton()}
{:else if show === 'subtree'}
    {@render subtreeButton()}
{:else if subtreeLinks.length >= 2}
    <div class="modal-link-actions">
        {@render ownButton()}
        {@render subtreeButton()}
    </div>
{/if}
