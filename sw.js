// Service worker: see js/offline.js for the shell list and the strategy.
// Registered by every page with { type: 'module' }; scope is the folder it sits in.

import { CACHE, SHELL, strategyFor } from './js/offline.js';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
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
  const strategy = strategyFor(event.request.url, event.request.method, self.location.origin);
  if (!strategy) return;
  event.respondWith(networkFirst(event.request, strategy === 'page'));
});

/** A page is stored under its path alone: song.html?id=x and song.html?view=tab are one file. */
function pageKey(request) {
  const url = new URL(request.url);
  url.search = '';
  return url.href;
}

/** The network, with the fresh copy kept for later; the cache when the network fails. */
async function networkFirst(request, page) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(page ? pageKey(request) : request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: page });
    if (cached) return cached;
    if (page) {
      const fallback = await cache.match('404.html');
      if (fallback) return fallback;
    }
    throw error;
  }
}
