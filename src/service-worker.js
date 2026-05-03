/// <reference lib="webworker" />

import { base, build, files, version } from '$service-worker';

const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));
const CACHE_PREFIX = 'todolist-cache';
const CACHE_NAME = `${CACHE_PREFIX}-${version}`;
const APP_SHELL = `${base}/`;
const STATIC_ASSETS = [...new Set([...build, ...files, APP_SHELL])];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE_NAME)
			.then((cache) => cache.addAll(
				STATIC_ASSETS.map((asset) => new Request(asset, { cache: 'reload' }))
			))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
						.map((key) => caches.delete(key))
				)
			)
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;

	if (request.method !== 'GET' || shouldBypass(request)) {
		return;
	}

	if (request.mode === 'navigate') {
		event.respondWith(networkFirst(request, APP_SHELL));
		return;
	}

	if (shouldRefreshStaticAsset(request)) {
		event.respondWith(networkFirst(request, request.url));
		return;
	}

	event.respondWith(cacheFirst(request));
});

/**
 * @param {Request} request
 */
function shouldBypass(request) {
	const url = new URL(request.url);
	return url.origin !== sw.location.origin || url.pathname.startsWith(`${base}/api/`);
}

/**
 * @param {Request} request
 */
function shouldRefreshStaticAsset(request) {
	const url = new URL(request.url);
	if (!url.pathname.startsWith(`${base}/`) || url.pathname.includes('/_app/immutable/')) {
		return false;
	}

	return [
		'/manifest.webmanifest',
		'/favicon.svg',
		'/apple-touch-icon.png',
		'/apple-touch-icon-20260504.png',
		'/pwa-icon-192.png',
		'/pwa-icon-192-20260504.png',
		'/pwa-icon-512.png',
		'/pwa-icon-512-20260504.png'
	].some((path) => url.pathname === `${base}${path}`);
}

/**
 * @param {Request} request
 * @param {string} fallbackUrl
 */
async function networkFirst(request, fallbackUrl) {
	const cache = await caches.open(CACHE_NAME);

	try {
		const response = await fetch(request);
		if (response.ok) {
			await cache.put(request, response.clone());
		}
		return response;
	} catch {
		return (await cache.match(request)) ?? (await cache.match(fallbackUrl)) ?? Response.error();
	}
}

/**
 * @param {Request} request
 */
async function cacheFirst(request) {
	const cached = await caches.match(request);
	if (cached) {
		return cached;
	}

	const response = await fetch(request);
	if (response.ok) {
		const cache = await caches.open(CACHE_NAME);
		await cache.put(request, response.clone());
	}

	return response;
}
