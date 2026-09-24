// Service worker: see js/offline.js for the shell list and the strategy.
// Registered by every page with { type: 'module' }; scope is the folder it sits in.

import { CACHE, SHELL, REFRESH_INTERVAL, strategyFor, pageKey, shellKeys } from './js/offline.js';

const SCOPE = new URL('./', self.location.href).href;
const ORIGIN = self.location.origin;
const KEYS = shellKeys(SCOPE);
const STAMP = new URL('.shell-refreshed', SCOPE).href; // when the shell was last refreshed, kept in the cache with it
// On localhost every file is fetched from the network first, so an edit shows on the next reload.
const LIVE = !['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const strategy = strategyFor(event.request.url, event.request.method, ORIGIN, event.request.mode);
  if (!strategy) return;
  const page = strategy === 'page';
  const key = page ? pageKey(event.request.url) : event.request.url;
  if (LIVE && KEYS.has(key)) {
    event.respondWith(cacheFirst(event.request, key, page));
    if (page) event.waitUntil(refreshShell().catch(() => {}));
  } else {
    event.respondWith(networkFirst(event.request, key, page));
  }
});

/**
 * Every shell file as [key, response], read in full: pages under pageKey, so
 * a host that serves song.html at /song (Cloudflare Pages redirects the .html
 * form there) and one that does not keep one copy each page can be answered
 * from. `mode` is the fetch cache mode: 'reload' goes past the browser's HTTP
 * cache, 'no-cache' revalidates with the server. Throws when a file is missing.
 */
async function fetchShell(mode) {
  return Promise.all(
    SHELL.map(async (path) => {
      const url = new URL(path, SCOPE).href;
      const response = await fetch(url, { cache: mode });
      if (!response.ok) throw new Error(`${path}: ${response.status}`);
      const page = strategyFor(url, 'GET', ORIGIN) === 'page';
      return [page ? pageKey(url) : url, await buffered(response)];
    }),
  );
}

async function precache() {
  const cache = await caches.open(CACHE);
  for (const [key, response] of await fetchShell('reload')) await cache.put(key, response);
  await cache.put(STAMP, new Response(String(Date.now())));
}

/**
 * Bring the cached shell up to date after a navigation, at most once per
 * REFRESH_INTERVAL: every file is fetched again and the set is written
 * together, so a visitor moves from one complete version to the next whatever
 * lifetime the host gave the files in the browser's cache.
 */
async function refreshShell() {
  const cache = await caches.open(CACHE);
  const stamp = await cache.match(STAMP);
  if (stamp && Date.now() - Number(await stamp.text()) < REFRESH_INTERVAL) return;
  await cache.put(STAMP, new Response(String(Date.now())));
  for (const [key, response] of await fetchShell('no-cache')) await cache.put(key, response);
}

/** The response read in full: its body no longer holds a connection (a batch of fetches would otherwise stall once the browser's connections are all waiting on unread bodies), and it has no redirect history. */
async function buffered(response) {
  return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers: response.headers });
}

/** A response fit to answer a navigation: a redirected one is copied without its history. */
function plain(response) {
  return response.redirected ? buffered(response) : Promise.resolve(response);
}

/** The cached shell file; the network when the cache has none yet. */
async function cacheFirst(request, key, page) {
  const cached = await (await caches.open(CACHE)).match(key);
  return cached || networkFirst(request, key, page);
}

/** The network, with the fresh copy kept for later; the cache when the network fails. */
async function networkFirst(request, key, page) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      (page ? plain(copy) : Promise.resolve(copy)).then((stored) => cache.put(key, stored)).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = await cache.match(key);
    if (cached) return cached;
    if (page) {
      const fallback = await cache.match(pageKey(new URL('404.html', SCOPE).href));
      if (fallback) return fallback;
    }
    throw error;
  }
}
