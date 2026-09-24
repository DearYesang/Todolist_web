import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatedFilename, downloadBlob, downloadJson } from './download.js';

const originalTimeZone = process.env.TZ;

afterEach(() => {
	vi.useRealTimers();
	if (originalTimeZone === undefined) {
		delete process.env.TZ;
	} else {
		process.env.TZ = originalTimeZone;
	}
});

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

describe('createDatedFilename', () => {
	it('stamps the local date of an injected time', () => {
		// Local components, so this holds in every time zone.
		expect(createDatedFilename('kanban_backup', 'json', new Date(2026, 8, 24, 8, 30)))
			.toBe('kanban_backup_2026-09-24.json');
	});

	it('uses the Korean date at 08:30 KST, while UTC is still on the previous day', () => {
		process.env.TZ = 'Asia/Seoul';
		const kstMorning = new Date('2026-09-23T23:30:00.000Z');

		expect(kstMorning.toISOString().split('T')[0]).toBe('2026-09-23');
		expect(createDatedFilename('kanban_backup', 'json', kstMorning)).toBe('kanban_backup_2026-09-24.json');
		expect(createDatedFilename('offline_conflicts', 'json', kstMorning)).toBe('offline_conflicts_2026-09-24.json');
	});

	it('defaults to the current time', () => {
		process.env.TZ = 'Asia/Seoul';
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-09-23T23:30:00.000Z'));

		expect(createDatedFilename('kanban_backup', 'json')).toBe('kanban_backup_2026-09-24.json');
	});
});
