<script>
    import { onMount } from 'svelte';
    import { get } from 'svelte/store';
    import { authClient } from '$lib/client/auth-client.js';
    import {
        applyUserScope,
        cacheAuthScope,
        clearCachedAuthScope,
        readCachedAuthScope
    } from '$lib/client/user-scope.js';
    import { setupPageLifecycle } from '$lib/client/page-lifecycle.js';
    import { isOnline, runServerSync, setOnline } from '$lib/client/sync-status.js';
    import {
        clearDoneTasks,
        currentView,
        drainPendingTaskSyncsToOfflineQueue,
        setupCrossTabTaskSync,
        tasks
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
    /** @type {string | null} */
    let syncedSessionUserId = null;
    const appUnlocked = $derived(Boolean($session.data?.user?.id || (!$isOnline && cachedAuthScope?.id)));

    $effect(() => {
        const sessionUser = $session.data?.user;
        if (sessionUser?.id) {
            const nextScope = cacheAuthScope(sessionUser);
            cachedAuthScope = nextScope;
            applyUserScope(nextScope?.id ?? null);
            if (nextScope?.id && syncedSessionUserId !== nextScope.id) {
                syncedSessionUserId = nextScope.id;
                void runServerSync();
            }
            return;
        }

        if ($session.isPending) {
            return;
        }

        if (!$isOnline && cachedAuthScope?.id) {
            applyUserScope(cachedAuthScope.id);
            return;
        }

        clearCachedAuthScope();
        cachedAuthScope = null;
        syncedSessionUserId = null;
        applyUserScope(null);
    });

    onMount(() => {
        setOnline(navigator.onLine);
        // Scope storage to the cached owner immediately: mutations made before
        // the session resolves must not be stamped with the anonymous owner,
        // or they become invisible once the user scope applies.
        if (cachedAuthScope?.id) {
            applyUserScope(cachedAuthScope.id);
        }

        const teardownCrossTabSync = setupCrossTabTaskSync(window);
        const teardownPageLifecycle = setupPageLifecycle(window, drainPendingTaskSyncsToOfflineQueue);

        const handleOnline = () => {
            setOnline(true);
            void $session.refetch();
            if ($session.data?.user) {
                void runServerSync();
            }
        };
        const handleOffline = () => {
            setOnline(false);
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
     * @param {string} id
     */
    function openTask(id) {
        selectedTaskId = id;
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
</script>

<AppHeader
    appUnlocked={appUnlocked}
    showOfflineStatus={!$session.data?.user && !$isOnline}
    oncleardone={handleClearDone} />

{#if appUnlocked}
    <SyncNoticeBanner />

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
        <TaskModal taskId={selectedTaskId} onclose={() => (selectedTaskId = null)} />
    {/if}

    <LinkOpenPanel />
{:else}
    <main class="locked-app-state">
        <AuthPanel />
    </main>
{/if}
