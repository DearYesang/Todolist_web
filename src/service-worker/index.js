import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';
import { asset, resolve } from '$app/paths';
import { self as sw } from '$app/service-worker';

const CACHE_PREFIX = 'todolist-cache';
const CACHE_NAME = `${CACHE_PREFIX}-${version}`;
const APP_SHELL = resolve('/');
// resolve('/') is the base path followed by '/', so this is the base path:
// '' unless paths.base is configured.
const BASE = APP_SHELL.slice(0, -1);
// Kit 2's $service-worker left .DS_Store out of `files`; Kit 3's manifest lists
// every file under static/, dotfiles included.
const PRECACHED_ASSETS = assets.filter((file) => !/(^|\/)\./.test(file.path));
const STATIC_ASSETS = [
	...new Set([
		...immutable.map((file) => `${BASE}/${file.path}`),
		...PRECACHED_ASSETS.map((file) => asset(file.path)),
		APP_SHELL
	])
];
/**
 * The static files a deploy may replace under the same name, so the network
 * is asked before the cache.
 * @type {import('$app/types').AssetPath[]}
 */
const REFRESHED_STATIC_FILES = [
	'manifest.webmanifest',
	'favicon.svg',
	'apple-touch-icon.png',
	'apple-touch-icon-20260504.png',
	'pwa-icon-192.png',
	'pwa-icon-192-20260504.png',
	'pwa-icon-512.png',
	'pwa-icon-512-20260504.png'
];
const REFRESHED_STATIC_ASSETS = REFRESHED_STATIC_FILES.map((file) => asset(file));

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE_NAME)
			.then((cache) => cache.addAll(STATIC_ASSETS.map((asset) => new Request(asset, { cache: 'reload' }))))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))
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
	return url.origin !== sw.location.origin || url.pathname.startsWith(`${BASE}/api/`);
}

/**
 * @param {Request} request
 */
function shouldRefreshStaticAsset(request) {
	return REFRESHED_STATIC_ASSETS.includes(new URL(request.url).pathname);
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
