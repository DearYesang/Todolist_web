import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installMemoryStorage } from '$lib/test-support/browser-globals.js';
import { jsonResponse } from '$lib/test-support/http.js';
import {
    currentView,
    flushPendingViewPreference,
    markPendingDefaultView,
    readPendingDefaultView,
    selectView,
    setCurrentView
} from './view-preference.js';

/**
 * A fetch stub that answers every request with `respond()` and records the
 * board preference writes it receives.
 * @param {() => Response} respond
 */
function createFetcher(respond) {
    /** @type {Array<{ url: unknown; method: unknown; body: unknown }>} */
    const requests = [];
    const fetcher = vi.fn(async (/** @type {unknown} */ url, /** @type {RequestInit | undefined} */ init) => {
        requests.push({ url, method: init?.method, body: JSON.parse(String(init?.body)) });
        return respond();
    });
    return { fetcher, requests };
}

/** @param {boolean} onLine */
function setBrowserOnline(onLine) {
    vi.stubGlobal('navigator', { onLine });
}

describe('selecting a view', () => {
    beforeEach(() => {
        installMemoryStorage();
        setCurrentView('kanban');
        setBrowserOnline(true);
    });

    it('only shows the view when no one is signed in', async () => {
        const { fetcher } = createFetcher(() => jsonResponse({ defaultView: 'gantt' }));

        const message = await selectView('gantt', { signedIn: false, fetcher });

        expect(message).toBeNull();
        expect(get(currentView)).toBe('gantt');
        expect(fetcher).not.toHaveBeenCalled();
        expect(readPendingDefaultView()).toBeNull();
    });

    it('keeps the view pending for the next sync while offline', async () => {
        setBrowserOnline(false);
        const { fetcher } = createFetcher(() => jsonResponse({ defaultView: 'gantt' }));

        const message = await selectView('gantt', { signedIn: true, fetcher });

        expect(message).toBeNull();
        expect(get(currentView)).toBe('gantt');
        expect(fetcher).not.toHaveBeenCalled();
        expect(readPendingDefaultView()).toBe('gantt');
    });

    it('saves the view as the default view and clears a pending one', async () => {
        markPendingDefaultView('matrix');
        const { fetcher, requests } = createFetcher(() => jsonResponse({ defaultView: 'gantt' }));

        const message = await selectView('gantt', { signedIn: true, fetcher });

        expect(message).toBeNull();
        expect(get(currentView)).toBe('gantt');
        expect(requests).toEqual([{ url: '/api/board/preferences', method: 'PATCH', body: { defaultView: 'gantt' } }]);
        expect(readPendingDefaultView()).toBeNull();
    });

    it('keeps the view pending when the server cannot take it now', async () => {
        const { fetcher } = createFetcher(() => jsonResponse({ message: 'Database unavailable.' }, { status: 503 }));

        const message = await selectView('matrix', { signedIn: true, fetcher });

        expect(message).toBeNull();
        expect(get(currentView)).toBe('matrix');
        expect(readPendingDefaultView()).toBe('matrix');
    });

    it('keeps the view pending when the request fails', async () => {
        const fetcher = vi.fn(async () => {
            throw new TypeError('Failed to fetch');
        });

        const message = await selectView('matrix', { signedIn: true, fetcher });

        expect(message).toBeNull();
        expect(readPendingDefaultView()).toBe('matrix');
    });

    it('returns the server\'s message when it refuses the view, and leaves a pending view alone', async () => {
        markPendingDefaultView('gantt');
        const { fetcher } = createFetcher(() => jsonResponse({ message: 'Default view is invalid.' }, { status: 400 }));

        const message = await selectView('matrix', { signedIn: true, fetcher });

        expect(message).toBe('Default view is invalid.');
        expect(get(currentView)).toBe('matrix');
        expect(readPendingDefaultView()).toBe('gantt');
    });
});

describe('sending a pending view', () => {
    beforeEach(() => {
        installMemoryStorage();
        setBrowserOnline(true);
    });

    it('sends nothing when no view is pending', async () => {
        const { fetcher } = createFetcher(() => jsonResponse({ defaultView: 'gantt' }));

        await flushPendingViewPreference({ signedIn: true, fetcher });

        expect(fetcher).not.toHaveBeenCalled();
    });

    it('keeps the view pending while no one is signed in or the browser is offline', async () => {
        markPendingDefaultView('gantt');
        const { fetcher } = createFetcher(() => jsonResponse({ defaultView: 'gantt' }));

        await flushPendingViewPreference({ signedIn: false, fetcher });
        setBrowserOnline(false);
        await flushPendingViewPreference({ signedIn: true, fetcher });

        expect(fetcher).not.toHaveBeenCalled();
        expect(readPendingDefaultView()).toBe('gantt');
    });

    it('sends the pending view and clears it once the server takes it', async () => {
        markPendingDefaultView('gantt');
        const { fetcher, requests } = createFetcher(() => jsonResponse({ defaultView: 'gantt' }));

        await flushPendingViewPreference({ signedIn: true, fetcher });

        expect(requests).toEqual([{ url: '/api/board/preferences', method: 'PATCH', body: { defaultView: 'gantt' } }]);
        expect(readPendingDefaultView()).toBeNull();
    });

    it('keeps the view pending when the server does not take it', async () => {
        markPendingDefaultView('gantt');
        const refused = createFetcher(() => jsonResponse({ message: 'Default view is invalid.' }, { status: 400 }));
        const unavailable = createFetcher(() => jsonResponse({ message: 'Database unavailable.' }, { status: 503 }));

        await flushPendingViewPreference({ signedIn: true, fetcher: refused.fetcher });
        await flushPendingViewPreference({ signedIn: true, fetcher: unavailable.fetcher });

        expect(refused.requests).toHaveLength(1);
        expect(unavailable.requests).toHaveLength(1);
        expect(readPendingDefaultView()).toBe('gantt');
    });
});
