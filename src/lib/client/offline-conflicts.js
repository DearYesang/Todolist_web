/** @type {Record<string, string>} */
const FIELD_LABELS = {
	text: '작업명',
	status: '상태',
	startDate: '시작일',
	endDate: '마감일',
	priority: '중요도',
	urgency: '시급성',
	category: '카테고리',
	parentId: '상위 작업',
	expectedVersion: '버전'
};

/**
 * @typedef {{
 *   id: string;
 *   type: string;
 *   title: string;
 *   target: string;
 *   detail: string;
 *   fields: string[];
 *   createdAt: string | null;
 *   taskId: string | null;
 *   mutation: import('./offline-write-queue.js').OfflineMutation;
 * }} OfflineConflictSummary
 */

/**
 * @param {import('./offline-write-queue.js').OfflineMutation} mutation
 * @param {import('../shared/task-domain.js').Task[]} [serverTasks]
 * @returns {OfflineConflictSummary}
 */
export function summarizeOfflineConflict(mutation, serverTasks = []) {
	const taskId = 'taskId' in mutation ? mutation.taskId : null;
	const serverTask = taskId ? serverTasks.find((task) => task.id === taskId) ?? null : null;
	const target = getConflictTarget(mutation, serverTask);
	const fields = getConflictFields(mutation);

	return {
		id: mutation.id,
		type: mutation.type,
		title: getConflictTitle(mutation),
		target,
		detail: getConflictDetail(mutation, fields),
		fields,
		createdAt: Number.isFinite(mutation.createdAt) ? new Date(mutation.createdAt).toISOString() : null,
		taskId,
		mutation
	};
}

/**
 * @param {OfflineConflictSummary[]} conflicts
 */
export function createOfflineConflictReport(conflicts) {
	return {
		exportedAt: new Date().toISOString(),
		conflicts: conflicts.map((conflict) => ({
			id: conflict.id,
			type: conflict.type,
			title: conflict.title,
			target: conflict.target,
			detail: conflict.detail,
			fields: conflict.fields,
			createdAt: conflict.createdAt,
			taskId: conflict.taskId,
			mutation: conflict.mutation
		}))
	};
}

/**
 * @param {import('./offline-write-queue.js').OfflineMutation} mutation
 */
function getConflictTitle(mutation) {
	switch (mutation.type) {
		case 'task.create':
			return '작업 생성';
		case 'task.patch':
			return '작업 수정';
		case 'task.delete':
			return '작업 삭제';
		case 'import.tasks':
			return mutation.mode === 'replace' ? '목록 교체 불러오기' : '목록 추가 불러오기';
		case 'checklist.create':
			return '체크리스트 추가';
		case 'checklist.patch':
			return '체크리스트 수정';
		case 'checklist.delete':
			return '체크리스트 삭제';
		default:
			return '오프라인 변경';
	}
}

/**
 * @param {import('./offline-write-queue.js').OfflineMutation} mutation
 * @param {import('../shared/task-domain.js').Task | null} serverTask
 */
function getConflictTarget(mutation, serverTask) {
	if (serverTask?.text) {
		return serverTask.text;
	}

	if (mutation.type === 'task.create') {
		const payload = getObject(mutation.payload);
		return readString(payload, 'text') || '새 작업';
	}

	if (mutation.type === 'task.patch') {
		return readString(mutation.patch, 'text') || mutation.taskId;
	}

	if (mutation.type === 'import.tasks') {
		return mutation.mode === 'replace' ? '전체 목록' : '가져온 목록';
	}

	if (mutation.type === 'checklist.create') {
		return mutation.text;
	}

	return '오프라인 변경';
}

/**
 * @param {import('./offline-write-queue.js').OfflineMutation} mutation
 */
function getConflictFields(mutation) {
	if (mutation.type !== 'task.patch') {
		return [];
	}

	return Object.keys(mutation.patch)
		.filter((field) => field !== 'expectedVersion')
		.map((field) => FIELD_LABELS[field] ?? field);
}

/**
 * @param {import('./offline-write-queue.js').OfflineMutation} mutation
 * @param {string[]} fields
 */
function getConflictDetail(mutation, fields) {
	if (mutation.type === 'task.patch') {
		return fields.length > 0
			? `충돌 필드: ${fields.join(', ')}`
			: '서버 버전과 맞지 않아 수정이 적용되지 않았습니다.';
	}

	if (mutation.type === 'task.delete') {
		return '서버의 최신 버전과 맞지 않아 삭제가 적용되지 않았습니다.';
	}

	if (mutation.type === 'import.tasks') {
		return '오프라인 불러오기를 서버에 적용하지 못했습니다.';
	}

	if (mutation.type.startsWith('checklist.')) {
		return '체크리스트 변경을 서버에 적용하지 못했습니다.';
	}

	return '오프라인 변경을 서버에 적용하지 못했습니다.';
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function getObject(value) {
	return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : null;
}

/**
 * @param {Record<string, unknown> | null} value
 * @param {string} key
 */
function readString(value, key) {
	const result = value?.[key];
	return typeof result === 'string' && result.trim() ? result.trim() : null;
}
