import { get } from 'svelte/store';
import { extractBackupTasks } from '../shared/task-backup.js';
import { createDatedFilename, downloadJson } from './download.js';
import { exportServerTasks } from './task-api.js';
import { importTasks, tasks } from './task-store.js';

const REPLACE_QUESTION = '현재 목록을 파일 내용으로 교체하시겠습니까? 취소하면 기존 목록에 추가합니다.';

/**
 * Imports the text of a backup file into the board through the task store's
 * importTasks. When the board already has tasks, `confirmReplace` asks
 * whether to replace them (true) or append (false).
 *
 * `notify` is called once with the message to show, also for a file that
 * is not JSON. After an import it runs once the board holds the imported
 * tasks, in the same event-loop task as the store writes.
 * @param {string} fileText
 * @param {{
 *   confirmReplace: (question: string) => boolean;
 *   notify: (message: string) => void;
 * }} dialogs
 */
export async function importTaskBackup(fileText, { confirmReplace, notify }) {
	try {
		const parsed = JSON.parse(fileText);
		const parsedTasks = extractBackupTasks(parsed);
		if (!parsedTasks) {
			notify('올바른 칸반 데이터 형식이 아닙니다.');
			return;
		}

		const importMode = get(tasks).length > 0 && confirmReplace(REPLACE_QUESTION)
			? 'replace'
			: 'append';

		const result = await importTasks(parsedTasks, importMode);
		if (!result.ok) {
			notify(result.message);
			return;
		}

		if (result.queued) {
			notify('오프라인 상태라 이 기기에 먼저 불러왔습니다. 온라인이 되면 서버와 다른 기기에 자동 반영을 시도합니다.');
			return;
		}

		const replacedText = result.summary.replacedTasks ? ` 교체된 작업: ${result.summary.replacedTasks}개.` : '';
		notify(`데이터를 성공적으로 불러왔습니다. 가져온 작업: ${result.summary.importedTasks}개.${replacedText}`);
	} catch {
		notify('파일을 읽는 중 오류가 발생했습니다.');
	}
}

/**
 * Downloads the board as `kanban_backup_YYYY-MM-DD.json` (local date): the
 * server's export when it answers, otherwise the tasks on this device.
 * @param {import('./download.js').DownloadEnvironment} [environment] injectable for tests
 */
export async function exportTaskBackup(environment) {
	const result = await exportServerTasks();
	const sourceTasks = result.ok ? result.tasks : get(tasks);
	downloadJson(sourceTasks, createDatedFilename('kanban_backup', 'json'), environment);
}
