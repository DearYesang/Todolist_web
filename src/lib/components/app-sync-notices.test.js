import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The notices App.svelte's refresh and conflict handlers write into the
// sync banner, byte for byte. The next commit moves that code to
// client/sync-status.js, whose tests expect the same strings; this pins
// them before the move. The other notices come from offline-conflicts.js
// and are pinned by its tests.
const APP_NOTICES = [
	'오프라인 상태입니다. 온라인으로 돌아오면 새로고침할 수 있습니다.',
	'로그인 상태를 다시 확인한 뒤 새로고침해 주세요.',
	'새로고침을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.',
	'서버의 최신 상태를 유지했습니다.'
];

describe('App.svelte sync notices', () => {
	it('writes exactly these notice strings', () => {
		const source = readFileSync(new URL('./App.svelte', import.meta.url), 'utf8');
		const written = [...source.matchAll(/\bsyncNotice = '([^']*)'/g)].map((match) => match[1]);

		expect(written).toEqual(APP_NOTICES);
		expect(written.map((notice) => Buffer.from(notice, 'utf8').length)).toEqual([92, 67, 84, 46]);
	});
});
