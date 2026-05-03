<script>
    import { authClient } from '$lib/client/auth-client.js';
    import {
        createCalendarToken,
        listCalendarTokens,
        revokeCalendarToken
    } from '$lib/client/calendar-token-api.js';

    const session = authClient.useSession();

    let tokens = $state(/** @type {import('$lib/client/calendar-token-api.js').CalendarTokenRecord[]} */ ([]));
    let latestUrl = $state('');
    let isOpen = $state(false);
    let isWorking = $state(false);
    let message = $state('');
    let expiresInDays = $state(90);

    $effect(() => {
        if ($session.data?.user && isOpen) {
            void refreshTokens();
        }
    });

    async function refreshTokens() {
        const result = await listCalendarTokens();
        if (result.ok) {
            tokens = result.tokens;
        }
    }

    async function handleCreate() {
        if (isWorking) return;

        message = '';
        isWorking = true;
        try {
            const result = await createCalendarToken('iCal feed', { expiresInDays });
            if (!result.ok) {
                message = result.message;
                return;
            }

            latestUrl = new URL(result.url, window.location.origin).toString();
            tokens = [result.record, ...tokens];
            message = 'iCal 링크가 생성되었습니다.';
        } finally {
            isWorking = false;
        }
    }

    /**
     * @param {string} tokenId
     */
    async function handleRevoke(tokenId) {
        if (isWorking) return;

        message = '';
        isWorking = true;
        try {
            const result = await revokeCalendarToken(tokenId);
            if (!result.ok) {
                message = result.message;
                return;
            }

            tokens = tokens.map((token) => token.id === tokenId && result.token ? result.token : token);
            message = 'iCal 링크가 해지되었습니다.';
        } finally {
            isWorking = false;
        }
    }

    async function copyLatestUrl() {
        if (!latestUrl) return;

        try {
            await navigator.clipboard.writeText(latestUrl);
            message = 'iCal 링크를 복사했습니다.';
        } catch {
            message = '복사하지 못했습니다.';
        }
    }

    /**
     * @param {string | Date | null} value
     */
    function formatDate(value) {
        if (!value) return '만료 없음';
        return new Date(value).toLocaleDateString('ko-KR');
    }

    /**
     * @param {import('$lib/client/calendar-token-api.js').CalendarTokenRecord} token
     */
    function getTokenState(token) {
        if (token.revokedAt) return '해지됨';
        if (!token.expiresAt) return '만료 없음';

        const expiresAt = new Date(token.expiresAt).getTime();
        const days = Math.ceil((expiresAt - Date.now()) / 86_400_000);
        if (days < 0) return '만료됨';
        if (days <= 14) return `${days}일 남음`;
        return `${formatDate(token.expiresAt)} 만료`;
    }
</script>

{#if $session.data?.user}
    <div class="calendar-feed-panel">
        <button
            class="btn"
            class:active={isOpen}
            onclick={() => isOpen = !isOpen}>
            📅 iCal 링크
        </button>

        {#if isOpen}
            <div class="calendar-feed-popover">
                <div class="calendar-feed-actions">
                    <select class="calendar-feed-select" bind:value={expiresInDays} aria-label="iCal 링크 만료">
                        <option value={30}>30일</option>
                        <option value={90}>90일</option>
                        <option value={180}>180일</option>
                        <option value={365}>1년</option>
                    </select>
                    <button class="btn btn-primary" onclick={handleCreate} disabled={isWorking}>iCal 링크 만들기</button>
                    {#if latestUrl}
                        <button class="btn" onclick={copyLatestUrl}>복사</button>
                    {/if}
                </div>

                {#if latestUrl}
                    <input class="calendar-feed-url" readonly value={latestUrl} aria-label="캘린더 구독 링크" />
                {/if}

                {#if tokens.length > 0}
                    <div class="calendar-token-list">
                        {#each tokens as token (token.id)}
                            <div class="calendar-token-row">
                                <span class:revoked={Boolean(token.revokedAt)}>
                                    {token.name} · {token.tokenPrefix} · {getTokenState(token)}
                                    {#if token.lastUsedAt}
                                        · 사용 {formatDate(token.lastUsedAt)}
                                    {/if}
                                </span>
                                <button
                                    class="btn btn-ghost"
                                    disabled={Boolean(token.revokedAt) || isWorking}
                                    onclick={() => handleRevoke(token.id)}>
                                    링크 해지
                                </button>
                            </div>
                        {/each}
                    </div>
                {/if}

                {#if message}
                    <p class="calendar-feed-message">{message}</p>
                {/if}
            </div>
        {/if}
    </div>
{/if}
