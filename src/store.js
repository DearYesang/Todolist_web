import { writable } from 'svelte/store';

// 초기 데이터 로드 + 마이그레이션 (날짜 데이터 보정)
let initialTasks = [];
try {
    const raw = localStorage.getItem('kanbanTasks');
    if (raw) {
        initialTasks = JSON.parse(raw);
    }
} catch(e) {
    console.error('Failed to parse kanban tasks', e);
}

const todayStr = new Date().toISOString().split('T')[0];
const endDayObj = new Date();
endDayObj.setDate(endDayObj.getDate() + 2);
const endStr = endDayObj.toISOString().split('T')[0];

initialTasks = initialTasks.map((/** @type {any} */ t) => ({
    id: t.id || Date.now().toString() + Math.random().toString(36).substring(2, 7),
    text: t.text || '',
    status: t.status || 'todo',
    startDate: t.startDate || todayStr,
    endDate: t.endDate || endStr,
    priority: t.priority || 'medium',
    urgency: t.urgency || 'normal',
    category: t.category || '',
    parentId: t.parentId || null,
    subtasks: t.subtasks || [],
    collapsed: t.collapsed || false,
    createdAt: t.createdAt || Date.now()
}));

export const tasks = writable(initialTasks);

// 데이터 변경 시 로컬 스토리지 자동 반영
tasks.subscribe(value => {
    localStorage.setItem('kanbanTasks', JSON.stringify(value));
});

// 화면 모드 제어
export const currentView = writable('kanban'); // 'kanban' | 'gantt'

// 글로벌 유틸리티
export const CATEGORY_COLORS = [
    { bg: 'rgba(88,166,255,0.15)', fg: '#58a6ff', border: '#58a6ff' },
    { bg: 'rgba(63,185,80,0.15)', fg: '#3fb950', border: '#3fb950' },
    { bg: 'rgba(210,153,34,0.15)', fg: '#d29922', border: '#d29922' },
    { bg: 'rgba(188,76,255,0.15)', fg: '#bc4cff', border: '#bc4cff' },
    { bg: 'rgba(255,123,114,0.15)', fg: '#ff7b72', border: '#ff7b72' },
    { bg: 'rgba(121,192,255,0.15)', fg: '#79c0ff', border: '#79c0ff' },
    { bg: 'rgba(210,106,155,0.15)', fg: '#d26a9b', border: '#d26a9b' },
    { bg: 'rgba(255,166,87,0.15)', fg: '#ffa657', border: '#ffa657' },
];

/** @param {string} category */
export function getCategoryColor(category) {
    if (!category) return { bg: 'rgba(110, 118, 129, 0.1)', fg: '#8b949e', border: '#30363d' };
    let hash = 0;
    for (let i = 0; i < category.length; i++) hash = category.charCodeAt(i) + ((hash << 5) - hash);
    return CATEGORY_COLORS[Math.abs(hash) % CATEGORY_COLORS.length];
}
