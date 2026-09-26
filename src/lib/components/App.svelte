<script>
    import { onMount } from 'svelte';
    import { get } from 'svelte/store';
    import { authClient } from '$lib/client/auth-client.js';
    import {
        cacheAuthScope,
        clearCachedAuthScope,
        readCachedAuthScope
    } from '$lib/client/auth-session-scope.js';
    import {
        createOfflineConflictReport,
        describeServerSyncResult,
        resolveLocalConflict
    } from '$lib/client/offline-conflicts.js';
    import { createDatedFilename, downloadJson } from '$lib/client/download.js';
    import { setLinkOpenOwner } from '$lib/client/link-opener.js';
    import { setOfflineQueueOwner } from '$lib/client/offline-write-queue.js';
    import { setupPageLifecycle } from '$lib/client/page-lifecycle.js';
    import { updateBoardPreferences } from '$lib/client/task-api.js';
    import { syncServerTasks } from '$lib/client/task-sync.js';
    import {
        applyServerCategoryCatalog,
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
    import AppHeader from './AppHeader.svelte';
    import AuthPanel from './AuthPanel.svelte';
    import EisenhowerMatrix from './EisenhowerMatrix.svelte';
    import FilterBar from './FilterBar.svelte';
    import GanttTimeline from './GanttTimeline.svelte';
    import KanbanBoard from './KanbanBoard.svelte';
    import LinkOpenPanel from './LinkOpenPanel.svelte';
    import SyncNoticeBanner from './SyncNoticeBanner.svelte';
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
        const teardownPageLifecycle = setupPageLifecycle(window, drainPendingTaskSyncsToOfflineQueue);

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
            teardownPageLifecycle();
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
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
        // The catalog belongs to the previous user's board until the next
        // finished sync loads this one (a blocked queue skips it). Kept, it
        // would list their categories and give the task panel their ids.
        applyServerCategoryCatalog([]);
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
     * @param {import('$lib/shared/task-rules.js').AppView} view
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

<AppHeader
    appUnlocked={appUnlocked}
    showOfflineStatus={!$session.data?.user && !isOnline}
    isRefreshing={isRefreshing}
    onselectview={selectView}
    onrefresh={refreshAppData}
    oncleardone={handleClearDone} />

{#if appUnlocked}
    <SyncNoticeBanner
        conflicts={syncConflicts}
        notice={syncNotice}
        bind:detailsOpen={conflictDetailsOpen}
        ondownloadreport={downloadConflictReport}
        ondismissconflicts={dismissSyncConflicts}
        onapplylocal={applyLocalConflict}
        onkeepserver={keepServerConflict}
        ondismissnotice={() => syncNotice = null} />

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
