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
        summarizeOfflineConflict
    } from '$lib/client/offline-conflicts.js';
    import { enqueueOfflineMutation, setOfflineQueueOwner } from '$lib/client/offline-write-queue.js';
    import { exportServerTasks, importServerTasks, updateBoardPreferences } from '$lib/client/task-api.js';
    import { syncServerTasks } from '$lib/client/task-sync.js';
    import {
        clearDoneTasks,
        clearPendingDefaultView,
        currentView,
        deleteTaskCascade,
        markPendingDefaultView,
        readPendingDefaultView,
        replaceTasks,
        resetFilters,
        setCurrentView,
        setTaskStorageOwner,
        tasks,
        updateTask
    } from '$lib/client/task-store.js';
    import { extractBackupTasks } from '$lib/shared/task-backup.js';
    import { normalizeTaskList } from '$lib/shared/task-domain.js';
    import AuthPanel from './AuthPanel.svelte';
    import CalendarFeedPanel from './CalendarFeedPanel.svelte';
    import EisenhowerMatrix from './EisenhowerMatrix.svelte';
    import FilterBar from './FilterBar.svelte';
    import GanttTimeline from './GanttTimeline.svelte';
    import KanbanBoard from './KanbanBoard.svelte';
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
        if (!navigator.onLine && cachedAuthScope?.id) {
            applyStorageScope(cachedAuthScope.id);
        }

        let reloadedForServiceWorkerUpdate = false;
        const handleServiceWorkerUpdate = () => {
            if (reloadedForServiceWorkerUpdate) return;
            reloadedForServiceWorkerUpdate = true;
            window.location.reload();
        };

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
        const conflicts = Array.isArray(result.offlineConflicts) ? result.offlineConflicts : [];
        if (conflicts.length > 0) {
            syncConflicts = conflicts.map((conflict) => summarizeOfflineConflict(conflict, get(tasks)));
            conflictDetailsOpen = false;
            syncNotice = null;
        } else if (result.ok) {
            syncConflicts = [];
            syncNotice = showSuccess ? '최신 작업 목록으로 새로고침했습니다.' : null;
        } else if (showSuccess) {
            syncNotice = result.fallback
                ? '지금은 서버에 연결할 수 없어 이 기기의 작업 목록을 유지합니다.'
                : result.message;
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
        const mutation = conflict.mutation;
        if (mutation.type === 'task.patch') {
            const { expectedVersion: _expectedVersion, ...patch } = mutation.patch;
            if (!get(tasks).some((task) => task.id === mutation.taskId)) {
                syncNotice = '대상 작업을 찾지 못했습니다. 최신 상태를 확인해 주세요.';
                return;
            }

            updateTask(mutation.taskId, patch);
            dismissSyncConflict(conflict.id);
            syncNotice = '내 변경을 최신 서버 상태 위에 다시 적용했습니다.';
            return;
        }

        if (mutation.type === 'task.delete') {
            if (!get(tasks).some((task) => task.id === mutation.taskId)) {
                syncNotice = '대상 작업이 이미 없습니다. 서버 상태를 유지합니다.';
                dismissSyncConflict(conflict.id);
                return;
            }

            deleteTaskCascade(mutation.taskId);
            dismissSyncConflict(conflict.id);
            syncNotice = '삭제 변경을 최신 서버 상태 위에 다시 적용했습니다.';
            return;
        }

        syncNotice = '이 충돌은 자동 적용보다 내역 저장 후 수동 확인이 안전합니다.';
    }

    /**
     * @param {import('$lib/client/offline-conflicts.js').OfflineConflictSummary} conflict
     */
    function canApplyLocalConflict(conflict) {
        return conflict.mutation.type === 'task.patch' || conflict.mutation.type === 'task.delete';
    }

    function downloadConflictReport() {
        if (syncConflicts.length === 0) return;

        const data = JSON.stringify(createOfflineConflictReport(syncConflicts), null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `offline_conflicts_${new Date().toISOString().split('T')[0]}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
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
                const parsed = JSON.parse(fileText);
                const parsedTasks = extractBackupTasks(parsed);
                if (!parsedTasks) {
                    alert('올바른 칸반 데이터 형식이 아닙니다.');
                    return;
                }

                const importMode = get(tasks).length > 0 && confirm('현재 목록을 파일 내용으로 교체하시겠습니까? 취소하면 기존 목록에 추가합니다.')
                    ? 'replace'
                    : 'append';

                const result = await importServerTasks(parsedTasks, { mode: importMode });
                if (result.ok) {
                    replaceTasks(importMode === 'replace' ? result.tasks : [...get(tasks), ...result.tasks]);
                    resetFilters();
                    const replacedText = result.summary.replacedTasks ? ` 교체된 작업: ${result.summary.replacedTasks}개.` : '';
                    alert(`데이터를 성공적으로 불러왔습니다. 가져온 작업: ${result.summary.importedTasks}개.${replacedText}`);
                    return;
                }

                if (result.fallback) {
                    const fallbackTasks = normalizeTaskList(parsedTasks);
                    enqueueOfflineMutation({
                        type: 'import.tasks',
                        mode: importMode,
                        payload: parsedTasks,
                        localTaskIds: fallbackTasks.map((task) => task.id)
                    });
                    replaceTasks(importMode === 'replace' ? fallbackTasks : [...get(tasks), ...fallbackTasks]);
                    resetFilters();
                    alert('오프라인 상태라 이 기기에 먼저 불러왔습니다. 온라인이 되면 서버와 다른 기기에 자동 반영을 시도합니다.');
                    return;
                }

                alert(result.message);
            } catch (error) {
                alert('파일을 읽는 중 오류가 발생했습니다.');
            } finally {
                input.value = '';
            }
        };

        reader.readAsText(file);
    }

    async function exportData() {
        const result = await exportServerTasks();
        const sourceTasks = result.ok ? result.tasks : get(tasks);
        const data = JSON.stringify(sourceTasks, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `kanban_backup_${new Date().toISOString().split('T')[0]}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
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
            <button class="view-btn" class:active={$currentView === 'kanban'} onclick={() => selectView('kanban')}>
                📋 칸반 뷰
            </button>
            <button class="view-btn" class:active={$currentView === 'gantt'} onclick={() => selectView('gantt')}>
                📊 간트 뷰
            </button>
            <button class="view-btn" class:active={$currentView === 'matrix'} onclick={() => selectView('matrix')}>
                🧭 매트릭스
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
            <button class="btn refresh-btn" onclick={refreshAppData} disabled={isRefreshing}>
                {isRefreshing ? '⏳ 새로고침 중' : '🔄 새로고침'}
            </button>
            <CalendarFeedPanel />
            <input type="file" id="import-file" accept=".json" hidden onchange={importData} />
            <button class="btn" onclick={() => document.getElementById('import-file')?.click()}>📂 불러오기</button>
            <button class="btn" onclick={exportData}>💾 내보내기</button>
            <button class="btn" onclick={handleClearDone}>🧹 정리</button>
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
{:else}
    <main class="locked-app-state">
        <AuthPanel />
    </main>
{/if}
