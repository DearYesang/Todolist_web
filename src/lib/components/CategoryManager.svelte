<script>
    import {
        categorySummaries,
        clearCategory,
        mergeCategory,
        renameCategory
    } from '$lib/client/task-store.js';
    import { getCategoryColor } from '$lib/shared/task-domain.js';

    let { onclose } = $props();

    /** @type {string | null} */
    let editingCategory = $state(null);
    let renameValue = $state('');
    let mergeSource = $state('');
    let mergeTarget = $state('');
    let message = $state('');

    const mergeTargets = $derived($categorySummaries.filter((category) => category.name !== mergeSource));

    /** @param {string} category */
    function startRename(category) {
        editingCategory = category;
        renameValue = category;
        message = '';
    }

    function cancelRename() {
        editingCategory = null;
        renameValue = '';
    }

    /** @param {string} category */
    function saveRename(category) {
        const nextName = renameValue.trim().replace(/\s+/g, ' ');
        if (!nextName || nextName === category) {
            cancelRename();
            return;
        }

        const exists = $categorySummaries.some((summary) => summary.name === nextName);
        if (exists && !confirm(`"${nextName}" 카테고리에 "${category}" 작업을 병합할까요?`)) {
            return;
        }

        const changed = renameCategory(category, nextName);
        message = `${changed}개 작업의 카테고리를 수정했습니다.`;
        cancelRename();
    }

    /** @param {string} category */
    function handleClearCategory(category) {
        if (!confirm(`"${category}" 카테고리를 삭제하고 해당 작업을 미분류로 옮길까요?`)) {
            return;
        }

        const changed = clearCategory(category);
        message = `${changed}개 작업을 미분류로 옮겼습니다.`;
    }

    function handleMerge() {
        if (!mergeSource || !mergeTarget || mergeSource === mergeTarget) {
            return;
        }

        const sourceCount = $categorySummaries.find((category) => category.name === mergeSource)?.total ?? 0;
        if (!confirm(`"${mergeSource}" 작업 ${sourceCount}개를 "${mergeTarget}" 카테고리로 병합할까요?`)) {
            return;
        }

        const changed = mergeCategory(mergeSource, mergeTarget);
        message = `${changed}개 작업을 "${mergeTarget}" 카테고리로 병합했습니다.`;
        mergeSource = '';
        mergeTarget = '';
    }

    /** @param {KeyboardEvent} event */
    function handleKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            onclose();
        }
    }
</script>

<div class="modal-backdrop category-manager-backdrop" role="button" tabindex="-1" onclick={onclose} onkeydown={handleKeydown}>
    <div
        class="category-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-manager-title"
        tabindex="0"
        onclick={(event) => event.stopPropagation()}
        onkeydown={handleKeydown}>
        <div class="category-manager-header">
            <div>
                <p class="panel-eyebrow">Category</p>
                <h2 id="category-manager-title">카테고리 관리</h2>
            </div>
            <button class="close-btn" type="button" onclick={onclose}>✕</button>
        </div>

        <div class="category-manager-body">
            {#if $categorySummaries.length === 0}
                <div class="empty-state compact">
                    <div class="icon">🏷️</div>
                    <p>아직 사용 중인 카테고리가 없습니다.</p>
                </div>
            {:else}
                <div class="category-manager-list">
                    {#each $categorySummaries as category (category.name)}
                        {@const color = getCategoryColor(category.name)}
                        <div class="category-manager-row">
                            <div class="category-manager-main">
                                <span
                                    class="category-color-dot"
                                    style={`background:${color.fg}; box-shadow:0 0 14px ${color.bg};`}></span>
                                {#if editingCategory === category.name}
                                    <input
                                        class="form-input category-rename-input"
                                        bind:value={renameValue}
                                        aria-label={`${category.name} 이름 수정`}
                                        onkeydown={(event) => {
                                            if (event.key === 'Enter') saveRename(category.name);
                                            if (event.key === 'Escape') {
                                                event.stopPropagation();
                                                cancelRename();
                                            }
                                        }} />
                                {:else}
                                    <div class="category-manager-name">
                                        <strong>{category.name}</strong>
                                        <span>{category.active} 진행 · {category.done} 완료 · {category.total} 전체</span>
                                    </div>
                                {/if}
                            </div>

                            <div class="category-manager-actions">
                                {#if editingCategory === category.name}
                                    <button class="btn btn-small btn-primary" type="button" onclick={() => saveRename(category.name)}>저장</button>
                                    <button class="btn btn-small" type="button" onclick={cancelRename}>취소</button>
                                {:else}
                                    <button class="btn btn-small" type="button" onclick={() => startRename(category.name)}>이름 변경</button>
                                    <button class="btn btn-small btn-danger" type="button" onclick={() => handleClearCategory(category.name)}>삭제</button>
                                {/if}
                            </div>
                        </div>
                    {/each}
                </div>

                {#if $categorySummaries.length > 1}
                    <div class="category-merge-panel">
                        <span class="form-label">카테고리 병합</span>
                        <div class="category-merge-row">
                            <select class="form-select" bind:value={mergeSource} aria-label="병합할 카테고리">
                                <option value="">병합할 카테고리</option>
                                {#each $categorySummaries as category}
                                    <option value={category.name}>{category.name}</option>
                                {/each}
                            </select>
                            <span class="merge-arrow">→</span>
                            <select class="form-select" bind:value={mergeTarget} disabled={!mergeSource} aria-label="대상 카테고리">
                                <option value="">대상 카테고리</option>
                                {#each mergeTargets as category}
                                    <option value={category.name}>{category.name}</option>
                                {/each}
                            </select>
                            <button class="btn btn-primary" type="button" onclick={handleMerge} disabled={!mergeSource || !mergeTarget}>병합</button>
                        </div>
                    </div>
                {/if}
            {/if}

            {#if message}
                <p class="category-manager-message" role="status">{message}</p>
            {/if}
        </div>
    </div>
</div>
