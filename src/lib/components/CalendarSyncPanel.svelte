<script>
    import { onMount } from 'svelte';
    import { authClient } from '$lib/client/auth-client.js';
    import {
        deleteCalendarConnection,
        listCalendarProviders,
        syncCalendarProviders
    } from '$lib/client/calendar-provider-api.js';

    const session = authClient.useSession();

    let isOpen = $state(false);
    let isWorking = $state(false);
    let message = $state('');
    let providers = $state(/** @type {import('$lib/client/calendar-provider-api.js').CalendarProviderRecord[]} */ ([]));
    let connections = $state(/** @type {import('$lib/client/calendar-provider-api.js').CalendarConnectionRecord[]} */ ([]));
    let syncRuns = $state(/** @type {import('$lib/client/calendar-provider-api.js').CalendarSyncRunRecord[]} */ ([]));

    onMount(() => {
        const oauthStatus = readCalendarSyncStatus();
        if (!oauthStatus) return;

        isOpen = true;
        message = oauthStatus.message;
        void refresh();
    });

    async function refresh() {
        if (!$session.data?.user) return;

        const result = await listCalendarProviders();
        if (result.ok) {
            providers = result.providers;
            connections = result.connections;
            syncRuns = result.syncRuns;
        } else {
            message = result.message;
        }
    }

    async function toggleOpen() {
        isOpen = !isOpen;
        if (isOpen) {
            await refresh();
        }
    }

    /**
     * @param {string} provider
     */
    function connect(provider) {
        window.location.href = `/api/calendar/providers/${provider}/connect`;
    }

    async function syncNow() {
        if (isWorking) return;

        isWorking = true;
        message = '';
        try {
            const result = await syncCalendarProviders();
            if (!result.ok) {
                message = result.message;
                return;
            }

            const failed = result.summaries.reduce((total, summary) => total + summary.failed, 0);
            const upserted = result.summaries.reduce((total, summary) => total + summary.upserted, 0);
            const deleted = result.summaries.reduce((total, summary) => total + summary.deleted, 0);
            message = `외부 캘린더 동기화 완료: 연결 ${result.connections}개, 반영 ${upserted}개, 삭제 ${deleted}개${failed ? `, 실패 ${failed}개` : ''}`;
            await refresh();
        } finally {
            isWorking = false;
        }
    }

    /**
     * @param {string} connectionId
     */
    async function disconnect(connectionId) {
        if (isWorking) return;

        isWorking = true;
        message = '';
        try {
            const result = await deleteCalendarConnection(connectionId);
            if (!result.ok) {
                message = result.message;
                return;
            }

            connections = connections.filter((connection) => connection.id !== connectionId);
            message = '캘린더 연결을 해제했습니다.';
        } finally {
            isWorking = false;
        }
    }

    /**
     * @param {string} provider
     */
    function getProviderName(provider) {
        return providers.find((item) => item.id === provider)?.name ?? provider;
    }

    /**
     * @param {string | null} provider
     */
    function getStaticProviderName(provider) {
        if (provider === 'google') return 'Google Calendar';
        if (provider === 'microsoft') return 'Microsoft Calendar';
        return '외부 캘린더';
    }

    /**
     * @param {import('$lib/client/calendar-provider-api.js').CalendarProviderRecord} provider
     */
    function getProviderSetupHint(provider) {
        if (provider.configured) return '';
        if (provider.id === 'google') {
            return 'Google Calendar 연결 설정이 필요합니다.';
        }
        if (provider.id === 'microsoft') {
            return 'Microsoft Calendar 연결 설정이 필요합니다.';
        }
        return 'OAuth 환경 변수가 필요합니다.';
    }

    /**
     * @param {string} value
     */
    function formatDateTime(value) {
        return new Date(value).toLocaleString('ko-KR');
    }

    function readCalendarSyncStatus() {
        if (typeof window === 'undefined') return null;

        const url = new URL(window.location.href);
        const status = url.searchParams.get('calendarSync');
        if (!status) return null;

        const provider = url.searchParams.get('calendarSyncProvider');
        const rawMessage = url.searchParams.get('calendarSyncMessage');
        let nextMessage = rawMessage;
        if (!nextMessage) {
            nextMessage = status === 'connected'
                ? `${getStaticProviderName(provider)} 연결이 완료되었습니다. 지금 동기화로 작업 일정을 반영할 수 있습니다.`
                : `${getStaticProviderName(provider)} 연결을 완료하지 못했습니다.`;
        }

        url.searchParams.delete('calendarSync');
        url.searchParams.delete('calendarSyncProvider');
        url.searchParams.delete('calendarSyncMessage');
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);

        return { status, provider, message: nextMessage };
    }
</script>

{#if $session.data?.user}
    <div class="calendar-sync-panel">
        <button class="btn" onclick={toggleOpen}>🌐 외부 캘린더</button>

        {#if isOpen}
            <div class="calendar-sync-popover">
                <div class="calendar-sync-actions">
                    {#each providers as provider}
                        <div class="calendar-provider-action">
                            <button
                                class="btn"
                                title={getProviderSetupHint(provider)}
                                onclick={() => connect(provider.id)}
                                disabled={isWorking || !provider.configured}>
                                {provider.name}
                            </button>
                            {#if !provider.configured}
                                <span>{getProviderSetupHint(provider)}</span>
                            {/if}
                        </div>
                    {/each}
                    <button class="btn btn-primary" onclick={syncNow} disabled={isWorking || connections.length === 0}>지금 동기화</button>
                </div>

                <details class="calendar-oauth-help">
                    <summary>Google 연결 도움말</summary>
                    <p>
                        Google OAuth 앱이 Testing 상태이면 현재 로그인한 Google 계정을 Google Cloud의 Test users에 추가해야 합니다.
                        개인 장기 동기화는 앱을 In production으로 전환해야 7일 후 재승인 문제를 줄일 수 있습니다.
                    </p>
                </details>

                {#if connections.length > 0}
                    <div class="calendar-connection-list">
                        {#each connections as connection}
                            <div class="calendar-connection-row">
                                <span>
                                    {getProviderName(connection.provider)}
                                    {#if connection.latestSync}
                                        · {connection.latestSync.status} · {formatDateTime(connection.latestSync.startedAt)}
                                    {/if}
                                </span>
                                <button class="btn btn-small" onclick={() => disconnect(connection.id)} disabled={isWorking}>연결 해제</button>
                            </div>
                        {/each}
                    </div>
                {/if}

                {#if syncRuns.length > 0}
                    <div class="calendar-sync-run-list">
                        {#each syncRuns.slice(0, 3) as run}
                            <div class="calendar-sync-run-row">
                                <span>{getProviderName(run.provider)} · {run.status}</span>
                                <span>{run.upserted}/{run.taskCount} · 삭제 {run.deleted} · 실패 {run.failed}</span>
                            </div>
                        {/each}
                    </div>
                {/if}

                {#if message}
                    <p class="calendar-sync-message">{message}</p>
                {/if}
            </div>
        {/if}
    </div>
{/if}
