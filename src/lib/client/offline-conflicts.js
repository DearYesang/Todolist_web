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
	const serverTask = taskId ? (serverTasks.find((task) => task.id === taskId) ?? null) : null;
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
 * @typedef {{
 *   action: 'patch';
 *   taskId: string;
 *   patch: Record<string, unknown>;
 *   dismiss: true;
 *   notice: string;
 * } | {
 *   action: 'delete';
 *   taskId: string;
 *   dismiss: true;
 *   notice: string;
 * } | {
 *   action: 'none';
 *   dismiss: boolean;
 *   notice: string;
 * }} LocalConflictResolution
 */

/**
 * Only task edits and deletes can be re-applied on top of the server state;
 * the other conflicts are safer to save and check by hand.
 * @param {OfflineConflictSummary} conflict
 */
export function canApplyLocalConflict(conflict) {
	return conflict.mutation.type === 'task.patch' || conflict.mutation.type === 'task.delete';
}

/**
 * Decides what "내 변경 적용" does with a conflict, given the task list the
 * server sync left behind. The caller runs the action (`patch` or `delete`
 * on `taskId`), removes the conflict from the banner when `dismiss` is set,
 * and shows `notice`.
 * @param {OfflineConflictSummary} conflict
 * @param {import('../shared/task-domain.js').Task[]} currentTasks
 * @returns {LocalConflictResolution}
 */
export function resolveLocalConflict(conflict, currentTasks) {
	const mutation = conflict.mutation;
	if (mutation.type === 'task.patch') {
		const { expectedVersion: _expectedVersion, ...patch } = mutation.patch;
		if (!currentTasks.some((task) => task.id === mutation.taskId)) {
			return {
				action: 'none',
				dismiss: false,
				notice: '대상 작업을 찾지 못했습니다. 최신 상태를 확인해 주세요.'
			};
		}

		return {
			action: 'patch',
			taskId: mutation.taskId,
			patch,
			dismiss: true,
			notice: '내 변경을 최신 서버 상태 위에 다시 적용했습니다.'
		};
	}

	if (mutation.type === 'task.delete') {
		if (!currentTasks.some((task) => task.id === mutation.taskId)) {
			return {
				action: 'none',
				dismiss: true,
				notice: '대상 작업이 이미 없습니다. 서버 상태를 유지합니다.'
			};
		}

		return {
			action: 'delete',
			taskId: mutation.taskId,
			dismiss: true,
			notice: '삭제 변경을 최신 서버 상태 위에 다시 적용했습니다.'
		};
	}

	return {
		action: 'none',
		dismiss: false,
		notice: '이 충돌은 자동 적용보다 내역 저장 후 수동 확인이 안전합니다.'
	};
}

/**
 * What the sync banner shows after a server sync. A key that is present
 * replaces that part of the banner; a missing key leaves it as it was.
 * `conflicts` with entries means the conflict details start closed.
 * @param {Awaited<ReturnType<typeof import('./task-store.js').syncServerTasks>>} result
 * @param {import('../shared/task-domain.js').Task[]} currentTasks the list after the sync, for conflict targets
 * @param {{ showSuccess?: boolean }} [options] true for a manual 새로고침
 * @returns {{ conflicts?: OfflineConflictSummary[]; notice?: string | null }}
 */
export function describeServerSyncResult(result, currentTasks, { showSuccess = false } = {}) {
	const conflicts = Array.isArray(result.offlineConflicts) ? result.offlineConflicts : [];
	if (conflicts.length > 0) {
		return {
			conflicts: conflicts.map((conflict) => summarizeOfflineConflict(conflict, currentTasks)),
			notice: null
		};
	}

	if (result.ok) {
		return {
			conflicts: [],
			notice: showSuccess ? '최신 작업 목록으로 새로고침했습니다.' : null
		};
	}

	if (showSuccess) {
		return {
			notice: result.fallback ? '지금은 서버에 연결할 수 없어 이 기기의 작업 목록을 유지합니다.' : result.message
		};
	}

	return {};
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
		return fields.length > 0 ? `충돌 필드: ${fields.join(', ')}` : '서버 버전과 맞지 않아 수정이 적용되지 않았습니다.';
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
