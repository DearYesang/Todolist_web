<script>
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

    async function refresh() {
        if (!$session.data?.user) return;

        const result = await listCalendarProviders();
        if (result.ok) {
            providers = result.providers;
            connections = result.connections;
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
            message = `동기화 완료: 연결 ${result.connections}개, 작업 ${result.tasks}개${failed ? `, 실패 ${failed}개` : ''}`;
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
</script>

{#if $session.data?.user}
    <div class="calendar-sync-panel">
        <button class="btn" onclick={toggleOpen}>🔄 Sync</button>

        {#if isOpen}
            <div class="calendar-sync-popover">
                <div class="calendar-sync-actions">
                    {#each providers as provider}
                        <button class="btn" onclick={() => connect(provider.id)} disabled={isWorking || !provider.configured}>
                            {provider.name}
                        </button>
                    {/each}
                    <button class="btn btn-primary" onclick={syncNow} disabled={isWorking || connections.length === 0}>동기화</button>
                </div>

                {#if connections.length > 0}
                    <div class="calendar-connection-list">
                        {#each connections as connection}
                            <div class="calendar-connection-row">
                                <span>{getProviderName(connection.provider)}</span>
                                <button class="btn btn-small" onclick={() => disconnect(connection.id)} disabled={isWorking}>해제</button>
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
