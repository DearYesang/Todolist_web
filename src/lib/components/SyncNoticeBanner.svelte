<script>
    import { canApplyLocalConflict } from '$lib/client/offline-conflicts.js';
    import {
        applyLocalConflict,
        dismissConflicts,
        dismissNotice,
        downloadConflictReport,
        keepServerConflict,
        syncStatus,
        toggleConflictDetails
    } from '$lib/client/sync-status.js';

    const conflicts = $derived($syncStatus.conflicts);
    const notice = $derived($syncStatus.notice);
    const detailsOpen = $derived($syncStatus.detailsOpen);
</script>

{#if conflicts.length > 0}
    <div class="sync-notice conflict-notice" role="status">
        <div class="sync-notice-main">
            <span>오프라인 변경 {conflicts.length}건이 서버의 최신 상태와 충돌했습니다.</span>
            <div class="sync-notice-actions">
                <button class="btn btn-small" onclick={toggleConflictDetails}>
                    {detailsOpen ? '내역 닫기' : '내역 보기'}
                </button>
                <button class="btn btn-small" onclick={() => downloadConflictReport()}>내역 저장</button>
                <button class="btn btn-small" onclick={dismissConflicts}>확인</button>
            </div>
        </div>

        {#if detailsOpen}
            <div class="sync-conflict-list">
                {#each conflicts as conflict (conflict.id)}
                    <div class="sync-conflict-row">
                        <strong>{conflict.title}</strong>
                        <span>{conflict.target}</span>
                        <small>{conflict.detail}</small>
                        <div class="sync-conflict-row-actions">
                            <button
                                class="btn btn-small"
                                onclick={() => applyLocalConflict(conflict)}
                                disabled={!canApplyLocalConflict(conflict)}
                                title={canApplyLocalConflict(conflict)
                                    ? '내 오프라인 변경을 최신 서버 상태 위에 다시 적용합니다.'
                                    : '이 충돌은 내역 저장 후 수동 확인이 안전합니다.'}>
                                내 변경 적용
                            </button>
                            <button class="btn btn-small" onclick={() => keepServerConflict(conflict)}
                                >서버 유지</button>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>
{:else if notice}
    <div class="sync-notice" role="status">
        <div class="sync-notice-main">
            <span>{notice}</span>
            <button class="btn btn-small" onclick={dismissNotice}>확인</button>
        </div>
    </div>
{/if}
