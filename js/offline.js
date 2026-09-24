// Offline support: a service worker (sw.js) keeps the app shell and every
// page and song the visitor has opened, so the tools and tab playback work
// without a connection. On a live host the shell (pages, scripts, styles,
// icons) is served from the worker's cache, which it fills past the browser's
// HTTP cache when it installs and refreshes as a whole after a navigation, at
// most once per REFRESH_INTERVAL: a visitor always runs one complete version,
// whatever cache lifetime the host gives the files, and a deploy reaches them
// on the navigation after the next refresh. Song data and the song index are
// fetched from the network first, the cache answering when that fails. On
// localhost everything is network first, so an edit shows on the next reload.

export const CACHE = 'nagori-v4';
export const REFRESH_INTERVAL = 5 * 60 * 1000;

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
  'js/local-songs.js',
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
 * How the worker treats a request: 'page' for same-origin navigations and
 * HTML paths (stored under pageKey, so song.html?id=x, song?id=x and song are
 * one file), 'asset' for other same-origin GETs, null for anything the worker
 * leaves alone (other origins such as YouTube, non-GET). `mode` is the
 * request's mode: 'navigate' marks a page whatever its path looks like, since
 * hosts such as Cloudflare Pages serve song.html at /song.
 */
export function strategyFor(url, method, origin, mode = '') {
  if (method !== 'GET') return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== origin) return null;
  const path = parsed.pathname;
  return mode === 'navigate' || path.endsWith('/') || path.endsWith('.html') ? 'page' : 'asset';
}

/** The key a page is cached under: its URL with no query or fragment, no `.html` and no `index` (`/song.html?id=x`, `/song?id=x` and `/song` are one file; `/` and `/index.html` too). */
export function pageKey(url) {
  const parsed = new URL(url);
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = parsed.pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
  return parsed.href;
}

/** The cache keys of the shell files served cache first on a live host: pages under pageKey, other files under their URL; the data files stay network first. */
export function shellKeys(scope) {
  const keys = new Set();
  for (const entry of SHELL) {
    if (entry.startsWith('data/')) continue;
    const url = new URL(entry, scope).href;
    keys.add(entry.endsWith('/') || entry.endsWith('.html') ? pageKey(url) : url);
  }
  return keys;
}

/** Register the worker from a page; silently does nothing where workers are unavailable (file:, plain http on a remote host, older browsers). */
export function registerOffline() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js', { type: 'module', updateViaCache: 'none' }).catch(() => {
    /* an insecure origin, a browser without module workers, or a blocked registration: the site works online as before */
  });
}
