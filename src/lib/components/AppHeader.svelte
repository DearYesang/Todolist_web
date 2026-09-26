<script>
    import { authClient } from '$lib/client/auth-client.js';
    import { exportTaskBackup, importTaskBackup } from '$lib/client/backup-transfer.js';
    import { refreshAppData, showNotice, syncStatus } from '$lib/client/sync-status.js';
    import { currentView, selectView } from '$lib/client/task-store.js';
    import { APP_VIEWS } from '$lib/shared/task-rules.js';
    import AuthPanel from './AuthPanel.svelte';
    import CalendarFeedPanel from './CalendarFeedPanel.svelte';

    /** @type {{
     *   appUnlocked: boolean;
     *   showOfflineStatus: boolean;
     *   oncleardone: () => void;
     * }} */
    let {
        appUnlocked,
        showOfflineStatus,
        oncleardone
    } = $props();

    /** @typedef {import('$lib/shared/task-rules.js').AppView} AppView */

    /** @type {Record<AppView, { icon: string; label: string }>} */
    const VIEW_BUTTONS = {
        kanban: { icon: '📋', label: '칸반' },
        gantt: { icon: '📊', label: '간트' },
        matrix: { icon: '🧭', label: '매트릭스' }
    };

    const session = authClient.useSession();
    const isRefreshing = $derived($syncStatus.isRefreshing);

    /**
     * @param {AppView} view
     */
    async function chooseView(view) {
        const message = await selectView(view, { signedIn: Boolean($session.data?.user?.id) });
        if (message !== null) {
            showNotice(message);
        }
    }

    function refresh() {
        return refreshAppData({
            refetchSession: () => $session.refetch(),
            getUserId: () => $session.data?.user?.id
        });
    }

    /**
     * @param {Event} event
     */
    function importData(event) {
        const input = /** @type {HTMLInputElement} */ (event.currentTarget);
        const file = input.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (loadEvent) => {
            const fileText = loadEvent.target?.result;
            if (typeof fileText !== 'string') return;

            try {
                await importTaskBackup(fileText, {
                    confirmReplace: (question) => confirm(question),
                    notify: (message) => alert(message)
                });
            } finally {
                input.value = '';
            }
        };

        reader.readAsText(file);
    }
</script>

<div class="header">
    <h1>🚀 나의 칸반 보드</h1>

    {#if appUnlocked}
        <div class="view-toggle">
            {#each APP_VIEWS as view (view)}
                <button class="view-btn" class:active={$currentView === view} onclick={() => chooseView(view)} aria-label="{VIEW_BUTTONS[view].label} 뷰">
                    <span class="view-icon" aria-hidden="true">{VIEW_BUTTONS[view].icon}</span>
                    <span class="view-label">{VIEW_BUTTONS[view].label}</span>
                </button>
            {/each}
        </div>
    {/if}

    <div class="header-actions">
        {#if appUnlocked}
            {#if showOfflineStatus}
                <span class="auth-status">오프라인</span>
            {:else}
                <AuthPanel />
            {/if}
            <button
                class="btn refresh-btn primary-action"
                onclick={refresh}
                disabled={isRefreshing}
                aria-label={isRefreshing ? '새로고침 중' : '새로고침'}
                title={isRefreshing ? '새로고침 중' : '새로고침'}>
                <span class="action-icon" aria-hidden="true">{isRefreshing ? '⏳' : '🔄'}</span>
                <span class="action-label">{isRefreshing ? '새로고침 중' : '새로고침'}</span>
            </button>
            <CalendarFeedPanel />
            <input type="file" id="import-file" accept=".json" hidden onchange={importData} />
            <button
                class="btn utility-action"
                onclick={() => document.getElementById('import-file')?.click()}
                aria-label="백업 JSON 불러오기"
                title="백업 JSON 불러오기">
                <span class="action-icon" aria-hidden="true">📂</span>
                <span class="action-label">불러오기</span>
            </button>
            <button class="btn utility-action" onclick={() => exportTaskBackup()} aria-label="백업 JSON 내보내기" title="백업 JSON 내보내기">
                <span class="action-icon" aria-hidden="true">💾</span>
                <span class="action-label">내보내기</span>
            </button>
            <button class="btn utility-action" onclick={oncleardone} aria-label="완료 작업 정리" title="완료 작업 정리">
                <span class="action-icon" aria-hidden="true">🧹</span>
                <span class="action-label">정리</span>
            </button>
        {/if}
    </div>
</div>
