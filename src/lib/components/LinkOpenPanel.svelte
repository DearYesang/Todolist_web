<script>
    import { tick } from 'svelte';
    import {
        confirmOpen,
        dismissLinkOpen,
        linkOpenState,
        openNextBlocked,
        openPendingLinks,
        summarizeLinkOpenState
    } from '$lib/client/link-opener.js';

    /** @type {HTMLButtonElement | null} */
    let confirmButton = $state(null);

    const summary = $derived($linkOpenState ? summarizeLinkOpenState($linkOpenState) : null);
    const isConfirming = $derived($linkOpenState?.phase === 'confirm');

    $effect(() => {
        if (!isConfirming) return;
        // Keyboard users land on the confirming button (Tab + Enter flow).
        tick().then(() => confirmButton?.focus({ preventScroll: true }));
    });

    /**
     * @param {string} href
     */
    function getHostname(href) {
        try {
            return new URL(href).hostname;
        } catch {
            return href;
        }
    }
</script>

<!-- Always mounted, so screen readers track it before the first result, and
     holding only the short message, so each step is not read out with the
     whole panel (hint, buttons and every fallback link). -->
<p class="visually-hidden link-open-live" role="status">{summary?.message ?? ''}</p>

{#if $linkOpenState && summary}
    <div class="link-open-panel" data-tone={summary.tone}>
        <div class="link-open-panel-header">
            <strong class="link-open-panel-title">
                <span aria-hidden="true">🔗</span>
                {$linkOpenState.title || '링크 열기'}
            </strong>
            <button type="button" class="btn btn-small btn-ghost link-open-panel-close" onclick={dismissLinkOpen}>닫기</button>
        </div>

        <p class="link-open-panel-message">{summary.message}</p>
        {#if summary.hint}
            <p class="link-open-panel-hint">{summary.hint}</p>
        {/if}

        {#if summary.tone === 'confirm'}
            <div class="link-open-panel-actions">
                <button
                    type="button"
                    class="btn btn-small btn-open-links"
                    bind:this={confirmButton}
                    onclick={() => confirmOpen()}>
                    모두 열기
                </button>
                <button type="button" class="btn btn-small" onclick={dismissLinkOpen}>취소</button>
            </div>
        {:else}
            {#if summary.stepLabel || summary.remainingLabel}
                <div class="link-open-panel-actions">
                    {#if summary.stepLabel}
                        <button type="button" class="btn btn-small btn-open-links" onclick={() => openNextBlocked()}>
                            {summary.stepLabel}
                        </button>
                    {/if}
                    {#if summary.remainingLabel}
                        <button type="button" class="btn btn-small btn-open-links" onclick={() => openPendingLinks()}>
                            {summary.remainingLabel}
                        </button>
                    {/if}
                </div>
            {/if}

            {#if summary.unopened.length > 0}
                <ul class="link-open-panel-list">
                    {#each summary.unopened as link (link.href)}
                        {@const hostname = getHostname(link.href)}
                        <li>
                            <a href={link.href} target="_blank" rel="noopener noreferrer">
                                <span class="link-open-panel-label">{link.label}</span>
                                {#if link.label !== hostname}
                                    <span class="link-open-panel-host">{hostname}</span>
                                {/if}
                            </a>
                        </li>
                    {/each}
                </ul>
            {/if}
        {/if}
    </div>
{/if}
