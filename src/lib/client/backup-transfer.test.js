import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMemoryStorage } from '$lib/test-support/browser-globals.js';
import { jsonResponse } from '$lib/test-support/http.js';
import { exportTaskBackup, importTaskBackup } from './backup-transfer.js';
import { loadOfflineQueue, setOfflineQueueOwner } from './offline-write-queue.js';
import { filters, replaceTasks, setPriorityFilter, tasks } from './task-store.js';

const REPLACE_QUESTION = '현재 목록을 파일 내용으로 교체하시겠습니까? 취소하면 기존 목록에 추가합니다.';
const EXISTING = { id: 'existing-task', text: 'Existing task', status: 'todo' };
const SERVER_TASK = { id: '33333333-3333-4333-8333-333333333333', text: 'Server imported task', status: 'todo' };
const FILE_TEXT = JSON.stringify([{ id: 'file-task', text: 'File task', status: 'doing' }]);

/**
 * @param {Partial<import('./task-api.js').TaskImportSummary>} [summary]
 */
function importedResponse(summary = {}) {
	return jsonResponse({
		tasks: [SERVER_TASK],
		summary: {
			receivedTasks: 1,
			importedTasks: 1,
			skippedTasks: 0,
			importedChecklistItems: 0,
			skippedChecklistItems: 0,
			repairedParentLinks: 0,
			...summary
		}
	});
}

/**
 * @param {{ replace?: boolean }} [options]
 */
function createDialogs({ replace = false } = {}) {
	/** @type {string[]} */
	const events = [];
	return {
		events,
		confirmReplace: vi.fn((/** @type {string} */ question) => {
			events.push(`confirm:${question}`);
			return replace;
		}),
		notify: vi.fn((/** @type {string} */ message) => {
			// The board is already updated when the message is shown.
			events.push(`notify:${message} [${get(tasks).map((task) => task.text).join(', ')}]`);
		})
	};
}

describe('importing a backup file', () => {
	/** @type {import('vitest').Mock} */
	let fetcher;

	beforeEach(() => {
		installMemoryStorage();
		fetcher = vi.fn();
		vi.stubGlobal('fetch', fetcher);
		replaceTasks([EXISTING]);
		setPriorityFilter('high');
	});

	afterEach(() => {
		setOfflineQueueOwner(null);
		replaceTasks([]);
	});

	it('replaces the board with the server import when the question is accepted', async () => {
		fetcher.mockResolvedValue(importedResponse({ replacedTasks: 1 }));
		const dialogs = createDialogs({ replace: true });

		await importTaskBackup(FILE_TEXT, dialogs);

		expect(dialogs.events).toEqual([
			`confirm:${REPLACE_QUESTION}`,
			'notify:데이터를 성공적으로 불러왔습니다. 가져온 작업: 1개. 교체된 작업: 1개. [Server imported task]'
		]);
		expect(fetcher).toHaveBeenCalledWith('/api/import?mode=replace', expect.objectContaining({ method: 'POST' }));
		expect(get(filters).priority).toBe('all');
	});

	it('appends the server import when the question is declined', async () => {
		fetcher.mockResolvedValue(importedResponse());
		const dialogs = createDialogs({ replace: false });

		await importTaskBackup(FILE_TEXT, dialogs);

		expect(dialogs.events).toEqual([
			`confirm:${REPLACE_QUESTION}`,
			'notify:데이터를 성공적으로 불러왔습니다. 가져온 작업: 1개. [Existing task, Server imported task]'
		]);
		expect(fetcher).toHaveBeenCalledWith('/api/import', expect.anything());
	});

	it('does not ask on an empty board', async () => {
		replaceTasks([]);
		fetcher.mockResolvedValue(importedResponse());
		const dialogs = createDialogs({ replace: true });

		await importTaskBackup(JSON.stringify({ tasks: [{ text: 'Wrapped task' }] }), dialogs);

		expect(dialogs.confirmReplace).not.toHaveBeenCalled();
		expect(fetcher).toHaveBeenCalledWith('/api/import', expect.anything());
		expect(dialogs.events).toEqual(['notify:데이터를 성공적으로 불러왔습니다. 가져온 작업: 1개. [Server imported task]']);
	});

	it('imports on this device and queues the import when the server is unavailable', async () => {
		fetcher.mockResolvedValue(jsonResponse({ message: 'Database unavailable.' }, { status: 503 }));
		const dialogs = createDialogs({ replace: true });

		await importTaskBackup(FILE_TEXT, dialogs);

		expect(dialogs.events).toEqual([
			`confirm:${REPLACE_QUESTION}`,
			'notify:오프라인 상태라 이 기기에 먼저 불러왔습니다. 온라인이 되면 서버와 다른 기기에 자동 반영을 시도합니다. [File task]'
		]);
		expect(loadOfflineQueue()).toEqual([expect.objectContaining({
			type: 'import.tasks',
			mode: 'replace',
			payload: [{ id: 'file-task', text: 'File task', status: 'doing' }],
			localTaskIds: ['file-task']
		})]);
		expect(get(filters).priority).toBe('all');
	});

	it('shows the server message and leaves the board alone when the import is refused', async () => {
		fetcher.mockResolvedValue(jsonResponse({ message: 'Too many tasks.' }, { status: 400 }));
		const dialogs = createDialogs();

		await importTaskBackup(FILE_TEXT, dialogs);

		expect(dialogs.notify).toHaveBeenCalledWith('Too many tasks.');
		expect(get(tasks).map((task) => task.id)).toEqual(['existing-task']);
		expect(loadOfflineQueue()).toEqual([]);
		expect(get(filters).priority).toBe('high');
	});

	it('rejects a file with no task list, or no JSON, before asking or sending', async () => {
		const dialogs = createDialogs({ replace: true });

		await importTaskBackup(JSON.stringify({ notTasks: true }), dialogs);
		await importTaskBackup('{ not json', dialogs);

		expect(dialogs.events).toEqual([
			'notify:올바른 칸반 데이터 형식이 아닙니다. [Existing task]',
			'notify:파일을 읽는 중 오류가 발생했습니다. [Existing task]'
		]);
		expect(fetcher).not.toHaveBeenCalled();
	});
});

describe('exporting a backup file', () => {
	afterEach(() => {
		vi.useRealTimers();
		replaceTasks([]);
	});

	function createFakeEnvironment() {
		const anchor = { href: '', download: '', click: vi.fn() };
		/** @type {Blob[]} */
		const blobs = [];
		return {
			anchor,
			blobs,
			environment: {
				document: { createElement: vi.fn(() => /** @type {any} */ (anchor)) },
				url: {
					createObjectURL: vi.fn((/** @type {Blob} */ blob) => {
						blobs.push(blob);
						return 'blob:backup';
					}),
					revokeObjectURL: vi.fn()
				}
			}
		};
	}

	it('saves the server export under the local date', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 8, 24, 8, 30));
		vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([SERVER_TASK])));
		const fake = createFakeEnvironment();

		await exportTaskBackup(fake.environment);

		expect(fake.anchor.download).toBe('kanban_backup_2026-09-24.json');
		expect(fake.anchor.click).toHaveBeenCalledOnce();
		const saved = JSON.parse(await fake.blobs[0].text());
		expect(saved.map((/** @type {{ text: string }} */ task) => task.text)).toEqual(['Server imported task']);
	});

	it('saves the tasks on this device when the server export fails', async () => {
		replaceTasks([EXISTING]);
		vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'Database unavailable.' }, { status: 503 })));
		const fake = createFakeEnvironment();

		await exportTaskBackup(fake.environment);

		const saved = JSON.parse(await fake.blobs[0].text());
		expect(saved.map((/** @type {{ id: string }} */ task) => task.id)).toEqual(['existing-task']);
	});
});
