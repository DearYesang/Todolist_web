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
    let expiresInDays = $state(30);

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
            const result = await createCalendarToken('전체 일정 비밀 링크', { expiresInDays });
            if (!result.ok) {
                message = result.message;
                return;
            }

            latestUrl = new URL(result.url, window.location.origin).toString();
            tokens = [result.record, ...tokens];
            message = '전체 일정 비밀 링크가 생성되었습니다. 이 주소를 아는 사람은 일정 내용을 볼 수 있습니다.';
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
            message = '전체 일정 비밀 링크가 해지되었습니다.';
        } finally {
            isWorking = false;
        }
    }

    async function copyLatestUrl() {
        if (!latestUrl) return;

        try {
            await navigator.clipboard.writeText(latestUrl);
            message = '전체 일정 비밀 링크를 복사했습니다.';
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
            class="btn calendar-feed-trigger primary-action"
            class:active={isOpen}
            onclick={() => isOpen = !isOpen}
            aria-label="전체 일정 동기화"
            title="전체 일정 동기화">
            <span class="action-icon" aria-hidden="true">📅</span>
            <span class="action-label action-label-full">전체 일정 동기화</span>
            <span class="action-label action-label-short">일정</span>
        </button>

        {#if isOpen}
            <div class="calendar-feed-popover">
                <div class="calendar-feed-actions">
                    <p class="calendar-feed-warning">
                        이 링크는 비밀번호 없이 전체 일정을 읽는 비밀 주소입니다. 캘린더 앱에 추가할 때만 복사하고, 의심되면 바로 중지하세요.
                    </p>
                    <select class="calendar-feed-select" bind:value={expiresInDays} aria-label="전체 일정 비밀 링크 만료">
                        <option value={7}>7일</option>
                        <option value={30}>30일</option>
                        <option value={90}>90일</option>
                        <option value={365}>1년</option>
                    </select>
                    <button class="btn btn-primary" onclick={handleCreate} disabled={isWorking}>비밀 링크 만들기</button>
                    {#if latestUrl}
                        <button class="btn" onclick={copyLatestUrl}>복사</button>
                    {/if}
                </div>

                {#if latestUrl}
                    <input class="calendar-feed-url" readonly value={latestUrl} aria-label="전체 일정 동기화 링크" />
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
                                    동기화 중지
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
