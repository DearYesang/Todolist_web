<script>
    import {
        categorySummaries,
        clearCategory,
        mergeCategory,
        renameCategory,
        reorderCategories,
        setCategoryHidden,
        updateCategoryColor
    } from '$lib/client/task-store.js';
    import { getCategoryColor } from '$lib/shared/task-domain.js';

    let { onclose } = $props();

    /** @type {string | null} */
    let editingCategory = $state(null);
    let renameValue = $state('');
    let mergeSource = $state('');
    let mergeTarget = $state('');
    let message = $state('');
    let busy = $state(false);

    const mergeTargets = $derived($categorySummaries.filter((category) => getCategoryValue(category) !== mergeSource));

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

    /** @param {{ id: string | null; name: string }} category */
    async function saveRename(category) {
        const nextName = renameValue.trim().replace(/\s+/g, ' ');
        if (!nextName || nextName === category.name) {
            cancelRename();
            return;
        }

        const target = $categorySummaries.find((summary) => summary.name === nextName) ?? null;
        if (target && !confirm(`"${nextName}" 카테고리에 "${category.name}" 작업을 병합할까요?`)) {
            return;
        }

        busy = true;
        const result = target
            ? await mergeCategory(category, target)
            : await renameCategory(category, nextName);
        message = result.message;
        busy = false;
        cancelRename();
    }

    /** @param {{ id: string | null; name: string }} category */
    async function handleClearCategory(category) {
        if (!confirm(`"${category.name}" 카테고리를 삭제하고 해당 작업을 미분류로 옮길까요?`)) {
            return;
        }

        busy = true;
        const result = await clearCategory(category);
        message = result.message;
        busy = false;
    }

    async function handleMerge() {
        if (!mergeSource || !mergeTarget || mergeSource === mergeTarget) {
            return;
        }

        const source = findCategoryByValue(mergeSource);
        const target = findCategoryByValue(mergeTarget);
        if (!source || !target) {
            return;
        }

        if (!confirm(`"${source.name}" 작업 ${source.total}개를 "${target.name}" 카테고리로 병합할까요?`)) {
            return;
        }

        busy = true;
        const result = await mergeCategory(source, target);
        message = result.message;
        busy = false;
        mergeSource = '';
        mergeTarget = '';
    }

    /**
     * @param {{ id: string | null; name: string; color: string | null }} category
     * @param {Event} event
     */
    async function handleColorChange(category, event) {
        const color = /** @type {HTMLInputElement} */ (event.currentTarget).value;
        busy = true;
        const result = await updateCategoryColor(category, color);
        message = result.message;
        busy = false;
    }

    /**
     * @param {{ id: string | null; name: string; hiddenAt: string | null }} category
     */
    async function handleToggleHidden(category) {
        busy = true;
        const result = await setCategoryHidden(category, !category.hiddenAt);
        message = result.message;
        busy = false;
    }

    /**
     * @param {number} index
     * @param {-1 | 1} direction
     */
    async function moveCategory(index, direction) {
        const ordered = $categorySummaries
            .map((category) => category.id)
            .filter((id) => typeof id === 'string');
        const current = $categorySummaries[index];
        if (!current?.id) return;
        const currentIndex = ordered.indexOf(current.id);
        const nextIndex = currentIndex + direction;
        if (currentIndex < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;
        [ordered[currentIndex], ordered[nextIndex]] = [ordered[nextIndex], ordered[currentIndex]];

        busy = true;
        const result = await reorderCategories(ordered);
        message = result.message;
        busy = false;
    }

    /**
     * @param {{ id: string | null; name: string }} category
     */
    function getCategoryValue(category) {
        return category.id ?? category.name;
    }

    /** @param {string} value */
    function findCategoryByValue(value) {
        return $categorySummaries.find((category) => getCategoryValue(category) === value) ?? null;
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
                    {#each $categorySummaries as category, index (category.id ?? category.name)}
                        {@const color = getCategoryColor(category.name, category.color)}
                        <div class="category-manager-row">
                            <div class="category-manager-main">
                                {#if category.id}
                                    <input
                                        class="category-color-input"
                                        type="color"
                                        value={category.color ?? color.fg}
                                        aria-label={`${category.name} 색상`}
                                        disabled={busy}
                                        onchange={(event) => handleColorChange(category, event)} />
                                {:else}
                                    <span
                                        class="category-color-dot"
                                        style={`background:${color.fg}; box-shadow:0 0 14px ${color.bg};`}></span>
                                {/if}
                                {#if editingCategory === category.name}
                                    <input
                                        class="form-input category-rename-input"
                                        bind:value={renameValue}
                                        aria-label={`${category.name} 이름 수정`}
                                        onkeydown={(event) => {
                                            if (event.key === 'Enter') void saveRename(category);
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
                                    <button class="btn btn-small btn-primary" type="button" disabled={busy} onclick={() => saveRename(category)}>저장</button>
                                    <button class="btn btn-small" type="button" disabled={busy} onclick={cancelRename}>취소</button>
                                {:else}
                                    <button class="btn btn-small" type="button" disabled={busy || !category.id} onclick={() => moveCategory(index, -1)}>위</button>
                                    <button class="btn btn-small" type="button" disabled={busy || !category.id} onclick={() => moveCategory(index, 1)}>아래</button>
                                    <button class="btn btn-small" type="button" disabled={busy || !category.id} onclick={() => handleToggleHidden(category)}>
                                        {category.hiddenAt ? '표시' : '숨김'}
                                    </button>
                                    <button class="btn btn-small" type="button" disabled={busy} onclick={() => startRename(category.name)}>이름 변경</button>
                                    <button class="btn btn-small btn-danger" type="button" disabled={busy} onclick={() => handleClearCategory(category)}>삭제</button>
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
                                    <option value={getCategoryValue(category)}>{category.name}</option>
                                {/each}
                            </select>
                            <span class="merge-arrow">→</span>
                            <select class="form-select" bind:value={mergeTarget} disabled={!mergeSource} aria-label="대상 카테고리">
                                <option value="">대상 카테고리</option>
                                {#each mergeTargets as category}
                                    <option value={getCategoryValue(category)}>{category.name}</option>
                                {/each}
                            </select>
                            <button class="btn btn-primary" type="button" onclick={handleMerge} disabled={busy || !mergeSource || !mergeTarget}>병합</button>
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
