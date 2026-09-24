import { describe, expect, it, vi } from 'vitest';
import { downloadBlob, downloadJson } from './download.js';

function createFakeEnvironment() {
	/** @type {string[]} */
	const events = [];
	const anchor = {
		href: '',
		download: '',
		click: vi.fn(() => {
			events.push(`click ${anchor.href} as ${anchor.download}`);
		})
	};
	/** @type {Blob[]} */
	const blobs = [];
	const environment = {
		document: {
			createElement: vi.fn(() => /** @type {any} */ (anchor))
		},
		url: {
			createObjectURL: vi.fn((/** @type {Blob} */ blob) => {
				blobs.push(blob);
				events.push('create blob:1');
				return 'blob:1';
			}),
			revokeObjectURL: vi.fn((/** @type {string} */ url) => {
				events.push(`revoke ${url}`);
			})
		}
	};

	return { anchor, blobs, environment: /** @type {any} */ (environment), events };
}

describe('downloadBlob', () => {
	it('clicks a temporary download link and revokes the object URL afterwards', () => {
		const { anchor, blobs, environment, events } = createFakeEnvironment();
		const blob = new Blob(['hello'], { type: 'text/plain' });

		downloadBlob(blob, 'hello.txt', environment);

		expect(environment.document.createElement).toHaveBeenCalledWith('a');
		expect(blobs).toEqual([blob]);
		expect(anchor.click).toHaveBeenCalledTimes(1);
		expect(events).toEqual(['create blob:1', 'click blob:1 as hello.txt', 'revoke blob:1']);
	});
});

describe('downloadJson', () => {
	it('saves pretty-printed JSON with the application/json type', async () => {
		const { blobs, environment, events } = createFakeEnvironment();

		downloadJson([{ id: 'a', text: '백업' }], 'kanban_backup_2026-09-24.json', environment);

		expect(events).toEqual([
			'create blob:1',
			'click blob:1 as kanban_backup_2026-09-24.json',
			'revoke blob:1'
		]);
		expect(blobs[0].type).toBe('application/json');
		expect(await blobs[0].text()).toBe(JSON.stringify([{ id: 'a', text: '백업' }], null, 2));
	});
});
