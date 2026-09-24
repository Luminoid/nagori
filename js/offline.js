// Offline support: a service worker (sw.js) keeps the app shell and every
// page and song the visitor has opened, so the tools and tab playback work
// without a connection. Network first, so online visitors always get the
// current files; the cache is what answers when the network fails.

export const CACHE = 'nagori-v2';

/** Files cached at install, relative to the site root (sw.js lives there): every page, every module they import (directly or through another module) and the icons the pages link. */
export const SHELL = [
  './',
  'index.html',
  'song.html',
  'tools.html',
  '404.html',
  'css/styles.css',
  'js/theme.js',
  'js/util.js',
  'js/i18n.js',
  'js/site.js',
  'js/offline.js',
  'js/home.js',
  'js/not-found.js',
  'js/song-page.js',
  'js/song-sort.js',
  'js/tab-renderer.js',
  'js/fingering.js',
  'js/chord-library.js',
  'js/chord-diagram.js',
  'js/chord-sheet.js',
  'js/video-sync.js',
  'js/tab-audio.js',
  'js/dsp.js',
  'js/tools.js',
  'js/metronome.js',
  'js/theory.js',
  'js/fretboard.js',
  'js/pitch.js',
  'icons/favicon.svg',
  'icons/icon-16.png',
  'icons/icon-32.png',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'manifest.webmanifest',
  'data/site.json',
  'data/songs.json',
];

/**
 * How the worker treats a request: 'page' for same-origin HTML navigations
 * (matched ignoring the query string, so song.html?id=x is served from the
 * cached song.html), 'asset' for other same-origin GETs, null for anything
 * the worker leaves alone (other origins such as YouTube, non-GET).
 */
export function strategyFor(url, method, origin) {
  if (method !== 'GET') return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== origin) return null;
  const path = parsed.pathname;
  return path.endsWith('/') || path.endsWith('.html') ? 'page' : 'asset';
}

/** Register the worker from a page; silently does nothing where workers are unavailable (file:, plain http). */
export function registerOffline() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || typeof location === 'undefined') return;
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (location.protocol !== 'https:' && !(location.protocol === 'http:' && local)) return;
  navigator.serviceWorker.register('sw.js', { type: 'module' }).catch(() => {
    /* an older browser without module workers, or a blocked registration: the site works online as before */
  });
}
