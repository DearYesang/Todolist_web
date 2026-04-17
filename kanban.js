// ==========================================
        // 데이터 관리
        // ==========================================
        let tasks = JSON.parse(localStorage.getItem('kanbanTasks')) || [];
        let selectedPriority = 'medium';
        let draggedTaskId = null;
        let selectedUrgency = 'normal';
        let filters = { priority: 'all', urgency: 'all', category: 'all' };

        // 기존 데이터 마이그레이션
        tasks = tasks.map(t => ({
            id: t.id || Date.now().toString(),
            text: t.text || '',
            status: t.status || 'todo',
            priority: t.priority || 'medium',
            urgency: t.urgency || 'normal',
            category: t.category || '',
            parentId: t.parentId || null,
            subtasks: t.subtasks || [],
            collapsed: t.collapsed || false,
            createdAt: t.createdAt || Date.now()
        }));
        saveTasks();

        function saveTasks() {
            localStorage.setItem('kanbanTasks', JSON.stringify(tasks));
        }

        // ==========================================
        // 카테고리 관련 유틸리티
        // ==========================================
        const CATEGORY_COLORS = [
            { bg: 'rgba(88,166,255,0.15)', fg: '#58a6ff', border: '#58a6ff' },
            { bg: 'rgba(63,185,80,0.15)', fg: '#3fb950', border: '#3fb950' },
            { bg: 'rgba(210,153,34,0.15)', fg: '#d29922', border: '#d29922' },
            { bg: 'rgba(188,76,255,0.15)', fg: '#bc4cff', border: '#bc4cff' },
            { bg: 'rgba(255,123,114,0.15)', fg: '#ff7b72', border: '#ff7b72' },
            { bg: 'rgba(121,192,255,0.15)', fg: '#79c0ff', border: '#79c0ff' },
            { bg: 'rgba(210,106,155,0.15)', fg: '#d26a9b', border: '#d26a9b' },
            { bg: 'rgba(255,166,87,0.15)', fg: '#ffa657', border: '#ffa657' },
        ];

        function getCategoryColor(category) {
            if (!category) return null;
            let hash = 0;
            for (let i = 0; i < category.length; i++) {
                hash = category.charCodeAt(i) + ((hash << 5) - hash);
            }
            return CATEGORY_COLORS[Math.abs(hash) % CATEGORY_COLORS.length];
        }

        function getCategories() {
            const cats = new Set(tasks.map(t => t.category).filter(Boolean));
            return [...cats].sort();
        }

        // ==========================================
        // 폼 관련
        // ==========================================
        function toggleAddForm() {
            const toggle = document.getElementById('add-toggle');
            const form = document.getElementById('add-form');
            const isOpen = form.classList.contains('active');
            toggle.classList.toggle('active', !isOpen);
            form.classList.toggle('active', !isOpen);
            if (!isOpen) {
                document.getElementById('new-task-input').focus();
                updateParentSelect();
                updateCategoryDatalist();
            }
        }

        function selectPriority(p) {
            selectedPriority = p;
            document.querySelectorAll('.priority-pill').forEach(pill => {
                pill.classList.toggle('active', pill.dataset.p === p);
            });
        }

        function selectUrgency(u) {
            selectedUrgency = u;
            document.querySelectorAll('.urgency-pill').forEach(pill => {
                pill.classList.toggle('active', pill.dataset.u === u);
            });
        }

        function updateParentSelect() {
            const sel = document.getElementById('parent-select');
            sel.innerHTML = '<option value="">없음 (최상위)</option>';
            tasks.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                const statusIcon = t.status === 'todo' ? '📋' : t.status === 'doing' ? '🔄' : '✅';
                opt.textContent = `${statusIcon} ${t.text.substring(0, 30)}${t.text.length > 30 ? '...' : ''}`;
                sel.appendChild(opt);
            });
        }

        function updateCategoryDatalist() {
            const dl = document.getElementById('category-list');
            dl.innerHTML = '';
            getCategories().forEach(c => {
                const opt = document.createElement('option');
                opt.value = c;
                dl.appendChild(opt);
            });
        }

        // ==========================================
        // 필터
        // ==========================================
        function setFilter(type, value) {
            filters[type] = value;
            document.querySelectorAll(`.filter-chip[data-filter="${type}"]`).forEach(chip => {
                chip.classList.toggle('active', chip.dataset.value === value);
            });
            renderBoard();
        }

        function updateCategoryFilters() {
            const container = document.getElementById('category-filters');
            container.innerHTML = '';
            getCategories().forEach(cat => {
                const chip = document.createElement('button');
                chip.className = 'filter-chip' + (filters.category === cat ? ' active' : '');
                chip.dataset.filter = 'category';
                chip.dataset.value = cat;
                chip.onclick = () => setFilter('category', cat);
                const color = getCategoryColor(cat);
                if (filters.category === cat && color) {
                    chip.style.background = color.bg;
                    chip.style.color = color.fg;
                    chip.style.borderColor = color.border;
                }
                chip.textContent = cat;
                container.appendChild(chip);
            });
        }

        function passesFilter(task) {
            if (filters.priority !== 'all' && task.priority !== filters.priority) return false;
            if (filters.urgency !== 'all' && task.urgency !== filters.urgency) return false;
            if (filters.category !== 'all' && task.category !== filters.category) return false;
            return true;
        }

        // ==========================================
        // 드래그 앤 드롭 로직
        // ==========================================
        function handleDragStart(e, taskId) {
            draggedTaskId = taskId;
            setTimeout(() => e.target.classList.add('dragging'), 0);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', taskId);
        }

        function handleDragEnd(e) {
            e.target.classList.remove('dragging');
            document.querySelectorAll('.drag-over-col, .drag-over-card').forEach(el => {
                el.classList.remove('drag-over-col', 'drag-over-card');
            });
            draggedTaskId = null;
        }

        function handleDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }

        function handleDragEnterCol(e) {
            e.preventDefault();
            if (e.currentTarget.classList.contains('task-list')) {
                e.currentTarget.classList.add('drag-over-col');
            }
        }

        function handleDragLeaveCol(e) {
            if (e.currentTarget.classList.contains('task-list')) {
                e.currentTarget.classList.remove('drag-over-col');
            }
        }

        function handleDragEnterCard(e) {
            e.preventDefault();
            e.stopPropagation();
            if (e.currentTarget.dataset.taskId !== draggedTaskId) {
                e.currentTarget.classList.add('drag-over-card');
            }
        }

        function handleDragLeaveCard(e) {
            e.stopPropagation();
            e.currentTarget.classList.remove('drag-over-card');
        }

        function handleDropOnCol(e, newStatus) {
            e.preventDefault();
            e.currentTarget.classList.remove('drag-over-col');
            const taskId = e.dataTransfer.getData('text/plain');
            if (taskId) {
                const task = tasks.find(t => t.id === taskId);
                if (task) {
                    task.status = newStatus;
                    task.parentId = null; // 루트로 분리
                    renderBoard();
                }
            }
        }

        function handleDropOnCard(e, targetTaskId) {
            e.preventDefault();
            e.stopPropagation(); // 칼럼 드롭 이벤트 방지
            e.currentTarget.classList.remove('drag-over-card');
            const taskId = e.dataTransfer.getData('text/plain');
            
            if (taskId && taskId !== targetTaskId) {
                // 순환 참조 방지
                let isDescendant = false;
                let current = tasks.find(t => t.id === targetTaskId);
                while (current) {
                    if (current.parentId === taskId) {
                        isDescendant = true; break;
                    }
                    current = tasks.find(t => t.id === current.parentId);
                }

                if (!isDescendant) {
                    const task = tasks.find(t => t.id === taskId);
                    const parentTask = tasks.find(t => t.id === targetTaskId);
                    if (task && parentTask) {
                        task.parentId = targetTaskId;
                        task.status = parentTask.status; // 부모 상태 동기화
                        renderBoard();
                    }
                } else {
                    alert('하위 작업을 해당 작업의 부모로 설정할 수 없습니다.');
                }
            }
        }

        // ==========================================
        // 렌더링
        // ==========================================
        function renderBoard() {
            const statuses = ['todo', 'doing', 'done'];
            statuses.forEach(status => {
                const list = document.getElementById(`list-${status}`);
                list.innerHTML = '';
                
                // 드래그 앤 드롭 이벤트 적용
                list.ondragover = handleDragOver;
                list.ondragenter = handleDragEnterCol;
                list.ondragleave = handleDragLeaveCol;
                list.ondrop = (e) => handleDropOnCol(e, status);

                const columnTasks = tasks.filter(t => t.status === status && passesFilter(t));

                // 트리 구조 분리: 부모 / 자식
                const childrenMap = {};
                const rootTasks = [];

                columnTasks.forEach(t => {
                    if (t.parentId) {
                        const parentInCol = columnTasks.find(p => p.id === t.parentId);
                        if (parentInCol) {
                            if (!childrenMap[t.parentId]) childrenMap[t.parentId] = [];
                            childrenMap[t.parentId].push(t);
                        } else {
                            rootTasks.push(t);
                        }
                    } else {
                        rootTasks.push(t);
                    }
                });

                if (rootTasks.length === 0 && Object.keys(childrenMap).length === 0) {
                    const empty = document.createElement('div');
                    empty.className = 'empty-state';
                    const icons = { todo: '📋', doing: '⚡', done: '🎉' };
                    empty.innerHTML = `<div class="icon">${icons[status]}</div><div>작업이 없습니다</div>`;
                    list.appendChild(empty);
                }

                // 재귀적 렌더링
                function renderTaskTree(task, depth) {
                    const card = createCardElement(task, depth);
                    list.appendChild(card);

                    if (childrenMap[task.id] && !task.collapsed) {
                        childrenMap[task.id].forEach(child => renderTaskTree(child, depth + 1));
                    }
                }

                rootTasks.forEach(t => renderTaskTree(t, 0));

                // 카운트 업데이트
                document.getElementById(`count-${status}`).textContent = columnTasks.length;
            });

            updateCategoryFilters();
            saveTasks();
        }

        function createCardElement(task, depth) {
            const card = document.createElement('div');
            card.className = 'task-card' + (depth > 0 ? ' child-card' : '');
            card.dataset.priority = task.priority;
            if (depth > 0) card.style.marginLeft = `${depth * 32}px`;

            // 드래그 앤 드롭 이벤트 적용
            card.setAttribute('draggable', 'true');
            card.dataset.taskId = task.id;
            card.ondragstart = (e) => handleDragStart(e, task.id);
            card.ondragend = handleDragEnd;
            card.ondragover = handleDragOver;
            card.ondragenter = handleDragEnterCard;
            card.ondragleave = handleDragLeaveCard;
            card.ondrop = (e) => handleDropOnCard(e, task.id);

            // 자식 수 계산 (모든 칼럼 걸쳐)
            const allChildren = tasks.filter(t => t.parentId === task.id);
            const hasChildren = allChildren.length > 0;

            // 부모 참조 (다른 칼럼에 있는 경우)
            let parentRef = '';
            if (task.parentId) {
                const parent = tasks.find(t => t.id === task.parentId);
                if (parent && parent.status !== task.status) {
                    const statusName = { todo: '할 일', doing: '진행 중', done: '완료' };
                    parentRef = `<span class="parent-indicator">${parent.text.substring(0, 15)}${parent.text.length > 15 ? '...' : ''} <span style="color:var(--text-muted);font-size:9px">(${statusName[parent.status]})</span></span>`;
                }
            }

            // 메타 바 (우선순위 + 시급성 + 카테고리 + 부모)
            const priorityLabels = { high: '높음', medium: '보통', low: '낮음' };
            const urgencyLabels = { urgent: '🔥 시급', normal: '⏳ 여유' };
            let metaHTML = `<div class="card-meta">`;
            metaHTML += `<span class="priority-badge ${task.priority}">${priorityLabels[task.priority]}</span>`;
            metaHTML += `<span class="urgency-badge ${task.urgency}">${urgencyLabels[task.urgency]}</span>`;
            if (task.category) {
                const cc = getCategoryColor(task.category);
                metaHTML += `<span class="category-tag" style="background:${cc.bg};color:${cc.fg};border-color:${cc.border};cursor:pointer" onclick="editTaskCategory('${task.id}')" title="카테고리 수정">${task.category}</span>`;
            } else {
                metaHTML += `<span class="category-tag add-category" style="cursor:pointer;border:1px dashed var(--border);color:var(--text-muted);background:transparent" onclick="editTaskCategory('${task.id}')" title="카테고리 추가">+ 카테고리</span>`;
            }
            if (parentRef) metaHTML += parentRef;
            if (hasChildren) {
                metaHTML += `<button class="collapse-toggle ${task.collapsed ? 'collapsed' : ''}" onclick="toggleCollapse('${task.id}')" title="${task.collapsed ? '펼치기' : '접기'}">▼</button>`;
            }
            metaHTML += `</div>`;

            // 작업 텍스트
            let textHTML = `<div class="card-text" style="cursor:pointer" onclick="editTaskName('${task.id}')" title="작업명 수정">${escapeHTML(task.text)}</div>`;

            // 자식 정보 (다른 칼럼 포함)
            let childrenInfoHTML = '';
            if (hasChildren) {
                const doneChildren = allChildren.filter(c => c.status === 'done').length;
                childrenInfoHTML = `
                    <div class="children-info">
                        📎 하위 작업 ${allChildren.length}개 (완료 ${doneChildren}/${allChildren.length})
                    </div>`;
            }

            // 체크리스트 (서브태스크)
            let subtaskHTML = '';
            if (task.subtasks.length > 0 || true) {
                const doneCount = task.subtasks.filter(s => s.done).length;
                const total = task.subtasks.length;
                const pct = total > 0 ? (doneCount / total * 100) : 0;

                subtaskHTML = `<div class="subtask-section">`;
                if (total > 0) {
                    subtaskHTML += `
                        <div class="subtask-header">
                            <span class="subtask-progress-info">체크리스트 ${doneCount}/${total}</span>
                        </div>
                        <div class="progress-bar-container">
                            <div class="progress-bar-fill" style="width:${pct}%"></div>
                        </div>
                        <div class="subtask-list">`;

                    task.subtasks.forEach(st => {
                        subtaskHTML += `
                            <div class="subtask-item">
                                <input type="checkbox" ${st.done ? 'checked' : ''} onchange="toggleSubtask('${task.id}','${st.id}')">
                                <span class="subtask-text ${st.done ? 'done' : ''}">${escapeHTML(st.text)}</span>
                                <button class="subtask-action edit" onclick="editSubtask('${task.id}','${st.id}')" title="수정">✏️</button>
                                <button class="subtask-action delete" onclick="deleteSubtask('${task.id}','${st.id}')" title="삭제">×</button>
                            </div>`;
                    });
                    subtaskHTML += `</div>`;
                }

                subtaskHTML += `
                    <div class="add-subtask-row">
                        <input type="text" class="add-subtask-input" placeholder="+ 체크리스트 추가..." onkeypress="if(event.key==='Enter')addSubtask('${task.id}',this)">
                        <button class="btn btn-ghost" onclick="addSubtask('${task.id}',this.previousElementSibling)" style="font-size:14px">+</button>
                    </div>
                </div>`;
            }

            // 이동 버튼
            let moveHTML = '<div class="move-btns">';
            if (task.status === 'todo') {
                moveHTML += `<button class="btn btn-move" onclick="moveTask('${task.id}','doing')">진행 중으로 →</button>`;
            } else if (task.status === 'doing') {
                moveHTML += `<button class="btn btn-move" onclick="moveTask('${task.id}','todo')">← 할 일</button>`;
                moveHTML += `<button class="btn btn-move" onclick="moveTask('${task.id}','done')">완료 →</button>`;
            } else {
                moveHTML += `<button class="btn btn-move" onclick="moveTask('${task.id}','doing')">← 진행 중</button>`;
            }
            moveHTML += '</div>';

            card.innerHTML = `
                ${metaHTML}
                ${textHTML}
                ${childrenInfoHTML}
                ${subtaskHTML}
                <div class="card-actions">
                    ${moveHTML}
                    <button class="btn btn-danger" onclick="deleteTask('${task.id}')" title="삭제">🗑</button>
                </div>
            `;

            // 이벤트 리스너: 텍스트 선택 (드래그) 허용을 위해 시스템 드래그 임시 비활성화
            card.addEventListener('mousedown', (e) => {
                if (e.target.closest('.card-text') || e.target.closest('.subtask-text') || e.target.tagName.toLowerCase() === 'a') {
                    card.setAttribute('draggable', 'false');
                }
            });
            card.addEventListener('mouseup', () => card.setAttribute('draggable', 'true'));
            card.addEventListener('mouseleave', () => card.setAttribute('draggable', 'true'));

            return card;
        }

        // ==========================================
        // CRUD
        // ==========================================
        function addTask() {
            const input = document.getElementById('new-task-input');
            const text = input.value.trim();
            if (!text) { input.focus(); return; }

            const category = document.getElementById('category-input').value.trim();
            const parentId = document.getElementById('parent-select').value || null;

            const newTask = {
                id: Date.now().toString(),
                text,
                status: parentId ? (tasks.find(t => t.id === parentId)?.status || 'todo') : 'todo',
                priority: selectedPriority,
                urgency: selectedUrgency,
                category,
                parentId,
                subtasks: [],
                collapsed: false,
                createdAt: Date.now()
            };

            tasks.push(newTask);
            input.value = '';
            document.getElementById('category-input').value = '';
            document.getElementById('parent-select').value = '';
            selectPriority('medium');
            selectUrgency('normal');

            renderBoard();
            toggleAddForm();
        }

        function moveTask(id, newStatus) {
            const idx = tasks.findIndex(t => t.id === id);
            if (idx !== -1) {
                tasks[idx].status = newStatus;
                renderBoard();
            }
        }

        function deleteTask(id) {
            // 자식 작업도 함께 삭제할지 확인
            const children = tasks.filter(t => t.parentId === id);
            if (children.length > 0) {
                if (!confirm(`이 작업에는 ${children.length}개의 하위 작업이 있습니다.\n모두 함께 삭제하시겠습니까?`)) return;
                // 재귀적으로 모든 자식 삭제
                function removeDescendants(parentId) {
                    const kids = tasks.filter(t => t.parentId === parentId);
                    kids.forEach(k => removeDescendants(k.id));
                    tasks = tasks.filter(t => t.parentId !== parentId);
                }
                removeDescendants(id);
            }
            tasks = tasks.filter(t => t.id !== id);
            renderBoard();
        }

        function clearAllDone() {
            const doneTasks = tasks.filter(t => t.status === 'done');
            if (doneTasks.length === 0) return;
            if (!confirm(`완료된 작업 ${doneTasks.length}개를 모두 삭제하시겠습니까?`)) return;
            const doneIds = new Set(doneTasks.map(t => t.id));
            tasks = tasks.filter(t => !doneIds.has(t.id));
            // 삭제된 부모를 참조하는 자식의 parentId 초기화
            tasks.forEach(t => { if (t.parentId && doneIds.has(t.parentId)) t.parentId = null; });
            renderBoard();
        }

        // ==========================================
        // 서브태스크 (체크리스트)
        // ==========================================
        function addSubtask(taskId, inputEl) {
            const text = inputEl.value.trim();
            if (!text) return;
            const task = tasks.find(t => t.id === taskId);
            if (!task) return;
            task.subtasks.push({ id: Date.now().toString(), text, done: false });
            inputEl.value = '';
            renderBoard();
        }

        function editTaskName(taskId) {
            if (window.getSelection().toString().trim() !== '') return; // 드래그 텍스트 선택 시 동작 방지
            const task = tasks.find(t => t.id === taskId);
            if (!task) return;
            const newText = prompt('작업명을 수정하세요:', task.text);
            if (newText !== null && newText.trim() !== '') {
                task.text = newText.trim();
                renderBoard();
            }
        }

        function editTaskCategory(taskId) {
            const task = tasks.find(t => t.id === taskId);
            if (!task) return;
            const newCat = prompt(`카테고리를 수정/입력하세요 (삭제하려면 비워두세요):\n(현재: ${task.category || '없음'})`, task.category || '');
            if (newCat !== null) {
                task.category = newCat.trim();
                renderBoard();
            }
        }

        function toggleSubtask(taskId, subtaskId) {
            const task = tasks.find(t => t.id === taskId);
            if (!task) return;
            const st = task.subtasks.find(s => s.id === subtaskId);
            if (st) st.done = !st.done;
            renderBoard();
        }

        function editSubtask(taskId, subtaskId) {
            const task = tasks.find(t => t.id === taskId);
            if (!task) return;
            const st = task.subtasks.find(s => s.id === subtaskId);
            if (!st) return;
            const newText = prompt('체크리스트 내용을 수정하세요:', st.text);
            if (newText !== null && newText.trim() !== '') {
                st.text = newText.trim();
                renderBoard();
            }
        }

        function deleteSubtask(taskId, subtaskId) {
            const task = tasks.find(t => t.id === taskId);
            if (!task) return;
            task.subtasks = task.subtasks.filter(s => s.id !== subtaskId);
            renderBoard();
        }

        // ==========================================
        // 트리 접기/펼치기
        // ==========================================
        function toggleCollapse(taskId) {
            const task = tasks.find(t => t.id === taskId);
            if (task) {
                task.collapsed = !task.collapsed;
                renderBoard();
            }
        }

        // ==========================================
        // 유틸리티
        // ==========================================
        function escapeHTML(str) {
            const div = document.createElement('div');
            div.textContent = str;
            let escaped = div.innerHTML;
            
            // 하이퍼링크 변환 (http:// 또는 https://)
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            return escaped.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:var(--accent); text-decoration:underline; font-weight:600;" onclick="event.stopPropagation()">$1</a>');
        }

        // ==========================================
        // 데이터 내보내기 / 불러오기
        // ==========================================
        function exportData() {
            const dataStr = JSON.stringify(tasks, null, 2);
            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `kanban_backup_${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
        }

        function importData(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const importedTasks = JSON.parse(e.target.result);
                    if (Array.isArray(importedTasks)) {
                        if (confirm('기존 데이터를 덮어쓰고 불러오시겠습니까? (이 작업은 되돌릴 수 없습니다.)')) {
                            tasks = importedTasks;
                            saveTasks();
                            renderBoard();
                            alert('데이터가 성공적으로 불러와졌습니다.');
                        }
                    } else {
                        alert('올바른 칸반 데이터 형식이 아닙니다.');
                    }
                } catch (error) {
                    alert('파일을 읽는 중 오류가 발생했습니다.');
                }
                event.target.value = ''; // Input 초기화
            };
            reader.readAsText(file);
        }

        // ==========================================
        // 이벤트 리스너
        // ==========================================
        document.getElementById('new-task-input').addEventListener('keypress', e => {
            if (e.key === 'Enter') addTask();
        });

        // ==========================================
        // 초기 렌더링
        // ==========================================
        renderBoard();
