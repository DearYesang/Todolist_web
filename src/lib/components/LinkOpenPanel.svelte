<script>
    import { tick, untrack } from 'svelte';
    import {
        confirmOpen,
        dismissLinkOpen,
        linkOpenState,
        openNextBlocked,
        openPendingLinks,
        summarizeLinkOpenState
    } from '$lib/client/link-opener.js';

    /** @type {HTMLDivElement | null} */
    let panelElement = $state(null);

    const summary = $derived($linkOpenState ? summarizeLinkOpenState($linkOpenState) : null);

    // Plain (non-reactive) bookkeeping for focus management.
    /** @type {HTMLElement | null} */
    let returnFocusTarget = null;
    let panelHasFocus = false;
    /** @type {import('$lib/shared/task-links.js').TaskLink[] | null} */
    let shownLinks = null;
    /** @type {string | null} */
    let shownTone = null;

    $effect(() => {
        const state = $linkOpenState;
        const tone = summary?.tone ?? null;
        const previousLinks = shownLinks;
        const previousTone = shownTone;
        shownLinks = state?.links ?? null;
        shownTone = tone;

        if (!state) {
            if (previousTone !== null) restoreFocus();
            return;
        }

        // Every request builds a new links array; later steps keep it.
        const isNewRequest = state.links !== previousLinks;
        if (isNewRequest) untrack(rememberTrigger);

        // The panel is mounted last in the page, so keyboard users are moved
        // into it whenever it asks for an answer (confirm) or offers the next
        // step (partial, blocked); a full success only announces itself.
        // When the focused control disappears (confirm, the last step), focus
        // moves to the next control instead of falling back to <body>.
        const needsAnswer = (isNewRequest || tone !== previousTone) && tone !== 'success';
        tick().then(() => {
            if (needsAnswer || lostFocusInPanel()) focusFirstControl();
        });
    });

    function rememberTrigger() {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || active === document.body) return;
        if (panelElement?.contains(active)) return;
        returnFocusTarget = active;
    }

    function lostFocusInPanel() {
        const active = document.activeElement;
        return panelHasFocus && (!active || active === document.body);
    }

    function focusFirstControl() {
        const target = panelElement?.querySelector('.link-open-panel-actions button')
            ?? panelElement?.querySelector('.link-open-panel-list a')
            ?? panelElement?.querySelector('.link-open-panel-close');
        if (target instanceof HTMLElement) {
            target.focus({ preventScroll: true });
        }
    }

    // Back to the button that opened the panel, but only when the panel held
    // focus and nothing else has taken it since.
    function restoreFocus() {
        const target = returnFocusTarget;
        const hadFocus = panelHasFocus;
        returnFocusTarget = null;
        panelHasFocus = false;
        if (!hadFocus || !target?.isConnected) return;

        const active = document.activeElement;
        if (active && active !== document.body) return;
        target.focus({ preventScroll: true });
    }

    function handleFocusIn() {
        panelHasFocus = true;
    }

    /**
     * A removed control reports no relatedTarget; only a move to another
     * element outside the panel means focus left it.
     * @param {FocusEvent} event
     */
    function handleFocusOut(event) {
        const next = event.relatedTarget;
        if (next instanceof Node && !panelElement?.contains(next)) {
            panelHasFocus = false;
        }
    }

    /**
     * @param {KeyboardEvent} event
     */
    function handleWindowKeydown(event) {
        if (event.key !== 'Escape' || !$linkOpenState) return;
        const target = event.target;
        if (!(target instanceof Node) || !panelElement?.contains(target)) return;
        event.preventDefault();
        dismissLinkOpen();
    }

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

<svelte:window onkeydown={handleWindowKeydown} />

<!-- Always mounted, so screen readers track it before the first result, and
     holding only the short message, so each step is not read out with the
     whole panel (hint, buttons and every fallback link). -->
<p class="visually-hidden link-open-live" role="status">{summary?.message ?? ''}</p>

{#if $linkOpenState && summary}
    <div
        class="link-open-panel"
        data-tone={summary.tone}
        bind:this={panelElement}
        onfocusin={handleFocusIn}
        onfocusout={handleFocusOut}>
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
