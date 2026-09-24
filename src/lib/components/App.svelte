<script>
    import { onMount } from 'svelte';
    import { get } from 'svelte/store';
    import { authClient } from '$lib/client/auth-client.js';
    import {
        cacheAuthScope,
        clearCachedAuthScope,
        readCachedAuthScope
    } from '$lib/client/auth-session-scope.js';
    import { exportTaskBackup, importTaskBackup } from '$lib/client/backup-transfer.js';
    import {
        canApplyLocalConflict,
        createOfflineConflictReport,
        describeServerSyncResult,
        resolveLocalConflict
    } from '$lib/client/offline-conflicts.js';
    import { createDatedFilename, downloadJson } from '$lib/client/download.js';
    import { setLinkOpenOwner } from '$lib/client/link-opener.js';
    import { setOfflineQueueOwner } from '$lib/client/offline-write-queue.js';
    import { updateBoardPreferences } from '$lib/client/task-api.js';
    import { syncServerTasks } from '$lib/client/task-sync.js';
    import {
        clearDoneTasks,
        clearPendingDefaultView,
        currentView,
        deleteTaskCascade,
        markPendingDefaultView,
        readPendingDefaultView,
        drainPendingTaskSyncsToOfflineQueue,
        setCurrentView,
        setTaskStorageOwner,
        setupCrossTabTaskSync,
        tasks,
        updateTask
    } from '$lib/client/task-store.js';
    import AuthPanel from './AuthPanel.svelte';
    import CalendarFeedPanel from './CalendarFeedPanel.svelte';
    import EisenhowerMatrix from './EisenhowerMatrix.svelte';
    import FilterBar from './FilterBar.svelte';
    import GanttTimeline from './GanttTimeline.svelte';
    import KanbanBoard from './KanbanBoard.svelte';
    import LinkOpenPanel from './LinkOpenPanel.svelte';
    import TaskForm from './TaskForm.svelte';
    import TaskModal from './TaskModal.svelte';

    /** @type {string | null} */
    let selectedTaskId = $state(null);
    const session = authClient.useSession();
    let cachedAuthScope = $state(readCachedAuthScope());
    let isOnline = $state(true);
    /** @type {string | null} */
    let scopedUserId = null;
    /** @type {string | null} */
    let syncedSessionUserId = null;
    /** @type {string | null} */
    let syncNotice = $state(null);
    let isRefreshing = $state(false);
    let conflictDetailsOpen = $state(false);
    let syncConflicts = $state(/** @type {import('$lib/client/offline-conflicts.js').OfflineConflictSummary[]} */ ([]));
    const appUnlocked = $derived(Boolean($session.data?.user?.id || (!isOnline && cachedAuthScope?.id)));

    $effect(() => {
        const sessionUser = $session.data?.user;
        if (sessionUser?.id) {
            const nextScope = cacheAuthScope(sessionUser);
            cachedAuthScope = nextScope;
            applyStorageScope(nextScope?.id ?? null);
            if (nextScope?.id && syncedSessionUserId !== nextScope.id) {
                syncedSessionUserId = nextScope.id;
                void runServerSync();
            }
            return;
        }

        if ($session.isPending) {
            return;
        }

        if (!isOnline && cachedAuthScope?.id) {
            applyStorageScope(cachedAuthScope.id);
            return;
        }

        clearCachedAuthScope();
        cachedAuthScope = null;
        syncedSessionUserId = null;
        applyStorageScope(null);
    });

    onMount(() => {
        isOnline = navigator.onLine;
        // Scope storage to the cached owner immediately: mutations made before
        // the session resolves must not be stamped with the anonymous owner,
        // or they become invisible once the user scope applies.
        if (cachedAuthScope?.id) {
            applyStorageScope(cachedAuthScope.id);
        }

        const teardownCrossTabSync = setupCrossTabTaskSync(window);

        let reloadedForServiceWorkerUpdate = false;
        const handleServiceWorkerUpdate = () => {
            if (reloadedForServiceWorkerUpdate) return;
            reloadedForServiceWorkerUpdate = true;
            // Queued-but-unsent writes must survive this programmatic reload.
            drainPendingTaskSyncsToOfflineQueue();
            window.location.reload();
        };
        const handlePageHide = () => {
            drainPendingTaskSyncsToOfflineQueue();
        };
        window.addEventListener('pagehide', handlePageHide);

        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready
                .then((registration) => registration.update())
                .catch(() => {});
            navigator.serviceWorker.addEventListener('controllerchange', handleServiceWorkerUpdate);
        }

        const handleOnline = () => {
            isOnline = true;
            void $session.refetch();
            if ($session.data?.user) {
                void runServerSync();
            }
        };
        const handleOffline = () => {
            isOnline = false;
        };
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            teardownCrossTabSync();
            window.removeEventListener('pagehide', handlePageHide);
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            navigator.serviceWorker?.removeEventListener('controllerchange', handleServiceWorkerUpdate);
        };
    });

    /**
     * @param {string | null} userId
     */
    function applyStorageScope(userId) {
        if (userId === scopedUserId) {
            return;
        }

        scopedUserId = userId;
        setTaskStorageOwner(userId);
        setOfflineQueueOwner(userId);
        setLinkOpenOwner(userId);
    }

    /**
     * @param {string} id
     */
    function openTask(id) {
        selectedTaskId = id;
    }

    async function runServerSync({ showSuccess = false } = {}) {
        await flushPendingViewPreference();
        const result = await syncServerTasks();
        handleServerSyncResult(result, { showSuccess });
    }

    async function flushPendingViewPreference() {
        const pendingView = readPendingDefaultView();
        if (!pendingView || !$session.data?.user?.id || !navigator.onLine) {
            return;
        }

        const result = await updateBoardPreferences({ defaultView: pendingView });
        if (result.ok) {
            clearPendingDefaultView();
        }
    }

    /**
     * @param {Awaited<ReturnType<typeof syncServerTasks>>} result
     * @param {{ showSuccess?: boolean }} options
     */
    function handleServerSyncResult(result, { showSuccess = false } = {}) {
        const update = describeServerSyncResult(result, get(tasks), { showSuccess });
        if (update.conflicts) {
            syncConflicts = update.conflicts;
            if (update.conflicts.length > 0) {
                conflictDetailsOpen = false;
            }
        }
        if ('notice' in update) {
            syncNotice = update.notice ?? null;
        }
    }

    async function refreshAppData() {
        if (isRefreshing) return;

        if (!navigator.onLine) {
            isOnline = false;
            syncNotice = '오프라인 상태입니다. 온라인으로 돌아오면 새로고침할 수 있습니다.';
            return;
        }

        isRefreshing = true;
        syncNotice = null;

        try {
            isOnline = true;
            await $session.refetch();

            if (!$session.data?.user?.id) {
                syncNotice = '로그인 상태를 다시 확인한 뒤 새로고침해 주세요.';
                return;
            }

            await runServerSync({ showSuccess: true });
        } catch (error) {
            syncNotice = '새로고침을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.';
        } finally {
            isRefreshing = false;
        }
    }

    function dismissSyncConflicts() {
        syncConflicts = [];
        conflictDetailsOpen = false;
    }

    /**
     * @param {string} conflictId
     */
    function dismissSyncConflict(conflictId) {
        syncConflicts = syncConflicts.filter((conflict) => conflict.id !== conflictId);
        if (syncConflicts.length === 0) {
            conflictDetailsOpen = false;
        }
    }

    /**
     * @param {import('$lib/client/offline-conflicts.js').OfflineConflictSummary} conflict
     */
    function keepServerConflict(conflict) {
        dismissSyncConflict(conflict.id);
        syncNotice = '서버의 최신 상태를 유지했습니다.';
    }

    /**
     * @param {import('$lib/client/offline-conflicts.js').OfflineConflictSummary} conflict
     */
    function applyLocalConflict(conflict) {
        const resolution = resolveLocalConflict(conflict, get(tasks));
        if (resolution.action === 'patch') {
            updateTask(resolution.taskId, resolution.patch);
        } else if (resolution.action === 'delete') {
            deleteTaskCascade(resolution.taskId);
        }
        if (resolution.dismiss) {
            dismissSyncConflict(conflict.id);
        }
        syncNotice = resolution.notice;
    }

    function downloadConflictReport() {
        if (syncConflicts.length === 0) return;

        downloadJson(createOfflineConflictReport(syncConflicts), createDatedFilename('offline_conflicts', 'json'));
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

    function handleClearDone() {
        const doneCount = get(tasks).filter((task) => task.status === 'done').length;
        if (doneCount === 0) return;

        if (confirm(`완료된 작업 ${doneCount}개를 모두 삭제하시겠습니까?`)) {
            clearDoneTasks();
            if (selectedTaskId && !get(tasks).some((task) => task.id === selectedTaskId)) {
                selectedTaskId = null;
            }
        }
    }

    /**
     * @param {'kanban' | 'gantt' | 'matrix'} view
     */
    async function selectView(view) {
        setCurrentView(view);

        if (!$session.data?.user?.id) {
            return;
        }

        if (!navigator.onLine) {
            markPendingDefaultView(view);
            return;
        }

        const result = await updateBoardPreferences({ defaultView: view });
        if (result.ok) {
            clearPendingDefaultView();
        } else if (result.fallback) {
            markPendingDefaultView(view);
        } else {
            syncNotice = result.message;
        }
    }
</script>

<div class="header">
    <h1>🚀 나의 칸반 보드</h1>

    {#if appUnlocked}
        <div class="view-toggle">
            <button class="view-btn" class:active={$currentView === 'kanban'} onclick={() => selectView('kanban')} aria-label="칸반 뷰">
                <span class="view-icon" aria-hidden="true">📋</span>
                <span class="view-label">칸반</span>
            </button>
            <button class="view-btn" class:active={$currentView === 'gantt'} onclick={() => selectView('gantt')} aria-label="간트 뷰">
                <span class="view-icon" aria-hidden="true">📊</span>
                <span class="view-label">간트</span>
            </button>
            <button class="view-btn" class:active={$currentView === 'matrix'} onclick={() => selectView('matrix')} aria-label="매트릭스 뷰">
                <span class="view-icon" aria-hidden="true">🧭</span>
                <span class="view-label">매트릭스</span>
            </button>
        </div>
    {/if}

    <div class="header-actions">
        {#if appUnlocked}
            {#if !$session.data?.user && !isOnline}
                <span class="auth-status">오프라인</span>
            {:else}
                <AuthPanel />
            {/if}
            <button
                class="btn refresh-btn primary-action"
                onclick={refreshAppData}
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
            <button class="btn utility-action" onclick={handleClearDone} aria-label="완료 작업 정리" title="완료 작업 정리">
                <span class="action-icon" aria-hidden="true">🧹</span>
                <span class="action-label">정리</span>
            </button>
        {/if}
    </div>
</div>

{#if appUnlocked}
    {#if syncConflicts.length > 0}
        <div class="sync-notice conflict-notice" role="status">
            <div class="sync-notice-main">
                <span>오프라인 변경 {syncConflicts.length}건이 서버의 최신 상태와 충돌했습니다.</span>
                <div class="sync-notice-actions">
                    <button class="btn btn-small" onclick={() => conflictDetailsOpen = !conflictDetailsOpen}>
                        {conflictDetailsOpen ? '내역 닫기' : '내역 보기'}
                    </button>
                    <button class="btn btn-small" onclick={downloadConflictReport}>내역 저장</button>
                    <button class="btn btn-small" onclick={dismissSyncConflicts}>확인</button>
                </div>
            </div>

            {#if conflictDetailsOpen}
                <div class="sync-conflict-list">
                    {#each syncConflicts as conflict (conflict.id)}
                        <div class="sync-conflict-row">
                            <strong>{conflict.title}</strong>
                            <span>{conflict.target}</span>
                            <small>{conflict.detail}</small>
                            <div class="sync-conflict-row-actions">
                                <button
                                    class="btn btn-small"
                                    onclick={() => applyLocalConflict(conflict)}
                                    disabled={!canApplyLocalConflict(conflict)}
                                    title={canApplyLocalConflict(conflict) ? '내 오프라인 변경을 최신 서버 상태 위에 다시 적용합니다.' : '이 충돌은 내역 저장 후 수동 확인이 안전합니다.'}>
                                    내 변경 적용
                                </button>
                                <button class="btn btn-small" onclick={() => keepServerConflict(conflict)}>서버 유지</button>
                            </div>
                        </div>
                    {/each}
                </div>
            {/if}
        </div>
    {:else if syncNotice}
        <div class="sync-notice" role="status">
            <div class="sync-notice-main">
                <span>{syncNotice}</span>
                <button class="btn btn-small" onclick={() => syncNotice = null}>확인</button>
            </div>
        </div>
    {/if}

    <TaskForm />
    <FilterBar />

    {#if $currentView === 'kanban'}
        <KanbanBoard openTask={openTask} />
    {:else if $currentView === 'gantt'}
        <GanttTimeline openTask={openTask} />
    {:else}
        <EisenhowerMatrix openTask={openTask} />
    {/if}

    {#if selectedTaskId}
        <TaskModal taskId={selectedTaskId} onclose={() => selectedTaskId = null} />
    {/if}

    <LinkOpenPanel />
{:else}
    <main class="locked-app-state">
        <AuthPanel />
    </main>
{/if}
