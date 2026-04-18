<script>
    import { tasks, getCategoryColor } from './store.js';
    import { fade, fly } from 'svelte/transition';

    let { taskId, onclose } = $props();
    
    // 선택된 태스크 구독 (Svelte 5 룬 사용)
    let task = $derived($tasks.find(t => t.id === taskId));

    function updateField(field, value) {
        tasks.update(ts => ts.map(t => t.id === taskId ? { ...t, [field]: value } : t));
    }

    function deleteTask() {
        if (confirm('이 작업을 삭제하시겠습니까?')) {
            tasks.update(ts => ts.filter(t => t.id !== taskId));
            onclose();
        }
    }
</script>

{#if task}
<div class="modal-backdrop" 
     role="button"
     tabindex="-1"
     onclick={onclose} 
     onkeydown={(e) => e.key === 'Escape' && onclose()}
     transition:fade={{duration: 200}}>
    <div class="side-panel" 
         role="dialog"
         aria-modal="true"
         onclick={(e) => e.stopPropagation()} 
         onkeydown={(e) => e.stopPropagation()}
         transition:fly={{ x: 400, duration: 300 }}>
        <div class="panel-header">
            <h2>작업 상세 정보</h2>
            <button class="close-btn" onclick={onclose}>✕</button>
        </div>

        <div class="panel-body">
            <div class="form-section">
                <label for="modal-task-text">작업명</label>
                <input id="modal-task-text" type="text" value={task.text} oninput={(e) => updateField('text', e.target.value)} />
            </div>

            <div class="form-grid">
                <div class="form-section">
                    <label for="modal-start-date">시작일</label>
                    <input id="modal-start-date" type="date" value={task.startDate} oninput={(e) => updateField('startDate', e.target.value)} />
                </div>
                <div class="form-section">
                    <label for="modal-end-date">마감일</label>
                    <input id="modal-end-date" type="date" value={task.endDate} oninput={(e) => updateField('endDate', e.target.value)} />
                </div>
            </div>

            <div class="form-section">
                <label for="modal-priority">중요도</label>
                <select id="modal-priority" value={task.priority} onchange={(e) => updateField('priority', e.target.value)}>
                    <option value="high">🔴 긴급</option>
                    <option value="medium">🟡 보통</option>
                    <option value="low">🟢 낮음</option>
                </select>
            </div>

            <div class="form-section">
                <label for="modal-category">카테고리</label>
                <input id="modal-category" type="text" value={task.category} oninput={(e) => updateField('category', e.target.value)} placeholder="예: 개발, 기획" />
            </div>

            <div class="form-section">
                <label for="modal-status">상태</label>
                <select id="modal-status" value={task.status} onchange={(e) => updateField('status', e.target.value)}>
                    <option value="todo">할 일</option>
                    <option value="doing">진행 중</option>
                    <option value="done">완료</option>
                </select>
            </div>
        </div>

        <div class="panel-footer">
            <button class="btn btn-danger" onclick={deleteTask}>🗑️ 작업 삭제</button>
            <button class="btn btn-primary" style="margin-left: auto;" onclick={onclose}>완료</button>
        </div>
    </div>
</div>
{/if}

<style>
    .modal-backdrop {
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px);
        z-index: 1000; display: flex; justify-content: flex-end;
    }
    .side-panel {
        width: 400px; height: 100%; background: var(--surface-raised);
        border-left: 1px solid var(--border); box-shadow: -10px 0 30px rgba(0,0,0,0.5);
        display: flex; flex-direction: column; overflow-y: auto;
    }
    .panel-header {
        padding: 24px; border-bottom: 1px solid var(--border);
        display: flex; justify-content: space-between; align-items: center;
    }
    .panel-header h2 { font-size: 18px; font-weight: 700; color: var(--text); }
    .close-btn { background: none; border: none; font-size: 20px; color: var(--text-muted); cursor: pointer; }
    .close-btn:hover { color: var(--text); }

    .panel-body { padding: 24px; flex: 1; display: flex; flex-direction: column; gap: 20px; }
    
    .form-section { display: flex; flex-direction: column; gap: 8px; }
    .form-section label { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; }
    .form-section input, .form-section select {
        padding: 12px; background: var(--bg); border: 1px solid var(--border);
        border-radius: var(--radius-sm); color: var(--text); font-size: 14px;
        transition: border-color 0.2s;
    }
    .form-section input:focus, .form-section select:focus { outline: none; border-color: var(--accent); }

    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

    .panel-footer {
        padding: 24px; border-top: 1px solid var(--border);
        display: flex; gap: 12px; margin-top: auto;
    }
    
    .btn {
        padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;
        display: inline-flex; align-items: center; gap: 8px; transition: all 0.2s;
    }
    .btn-danger { background: rgba(248, 81, 73, 0.1); color: var(--priority-high); border: 1px solid var(--border); }
    .btn-danger:hover { background: var(--priority-high); color: white; border-color: var(--priority-high); }
    .btn-primary { background: var(--accent); color: white; border: none; }
    .btn-primary:hover { filter: brightness(1.1); transform: translateY(-1px); }
</style>
