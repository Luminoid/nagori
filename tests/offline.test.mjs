// Offline support: the shell list must name real files (cache.addAll fails on a single 404),
// and the worker must leave other origins and non-GET requests alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { SHELL, CACHE, REFRESH_INTERVAL, strategyFor, pageKey, shellKeys } from '../js/offline.js';

const root = new URL('../', import.meta.url);

test('every shell entry exists on disk', async () => {
  for (const entry of SHELL) {
    const path = entry === './' ? 'index.html' : entry;
    await assert.doesNotReject(access(new URL(path, root)), `${entry} is missing`);
  }
  assert.ok(new Set(SHELL).size === SHELL.length, 'no duplicates');
  assert.match(CACHE, /^nagori-v\d+$/);
});

test('every script the pages load, every module those import, and every icon they link is in the shell', async () => {
  const pages = ['index.html', 'song.html', 'tools.html', '404.html'];
  const modules = new Set();
  const walk = async (path) => {
    if (modules.has(path)) return;
    modules.add(path);
    const text = await readFile(new URL(path, root), 'utf8');
    for (const [, dep] of text.matchAll(/^import\b[^'"]*['"]\.\/([^'"]+)['"]/gm)) await walk(`js/${dep}`);
  };
  for (const page of pages) {
    const html = await readFile(new URL(page, root), 'utf8');
    for (const [, src] of html.matchAll(/<script[^>]*src="([^"]+)"/g)) await walk(src);
    for (const [, href] of html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)) assert.ok(SHELL.includes(href), `${page} styles ${href}`);
    for (const [, href] of html.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)"[^>]*href="([^"]+)"/g)) assert.ok(SHELL.includes(href), `${page} links ${href}`);
  }
  assert.ok(modules.size > 20, `walked ${modules.size} modules`);
  for (const path of modules) assert.ok(SHELL.includes(path), `${path} is imported by a page's scripts but not in the shell`);
});

test('the worker handles same-origin GETs and nothing else', () => {
  const origin = 'https://tabs.example.com';
  assert.equal(strategyFor(`${origin}/`, 'GET', origin), 'page');
  assert.equal(strategyFor(`${origin}/song.html?id=knives-out`, 'GET', origin), 'page');
  assert.equal(strategyFor(`${origin}/song?id=knives-out`, 'GET', origin, 'navigate'), 'page', 'a host that drops .html still navigates to a page');
  assert.equal(strategyFor(`${origin}/songs/knives-out`, 'GET', origin, 'navigate'), 'page');
  assert.equal(strategyFor(`${origin}/data/songs/x/song.json`, 'GET', origin, 'cors'), 'asset');
  assert.equal(strategyFor(`${origin}/data/songs/x/song.json`, 'GET', origin), 'asset');
  assert.equal(strategyFor(`${origin}/js/tools.js`, 'GET', origin), 'asset');
  assert.equal(strategyFor('https://www.youtube.com/iframe_api', 'GET', origin), null);
  assert.equal(strategyFor(`${origin}/data/site.json`, 'POST', origin), null);
  assert.equal(strategyFor('not a url', 'GET', origin), null);
});

test('a page is keyed by its path alone, in the form without .html that some hosts serve', () => {
  const origin = 'https://tabs.example.com';
  assert.equal(pageKey(`${origin}/song.html?id=knives-out&view=tab`), `${origin}/song`);
  assert.equal(pageKey(`${origin}/song?id=knives-out#app`), `${origin}/song`);
  assert.equal(pageKey(`${origin}/songs/knives-out.html?view=chords`), `${origin}/songs/knives-out`);
  assert.equal(pageKey(`${origin}/index.html?lang=zh`), `${origin}/`);
  assert.equal(pageKey(`${origin}/`), `${origin}/`);
  assert.equal(pageKey(`${origin}/tabs/index.html`), `${origin}/tabs/`);
  assert.equal(pageKey(`${origin}/404.html`), `${origin}/404`);
});

test('the shell served cache first is every shell file but the data, keyed like the requests', () => {
  const keys = shellKeys('https://tabs.example.com/tabs/');
  assert.ok(keys.has('https://tabs.example.com/tabs/'), 'the home page');
  assert.ok(keys.has('https://tabs.example.com/tabs/song'), 'song.html under its short key');
  assert.ok(keys.has('https://tabs.example.com/tabs/404'));
  assert.ok(keys.has('https://tabs.example.com/tabs/js/util.js'));
  assert.ok(keys.has('https://tabs.example.com/tabs/css/styles.css'));
  assert.ok(!keys.has('https://tabs.example.com/tabs/song.html'));
  assert.ok(!keys.has('https://tabs.example.com/tabs/data/songs.json'), 'the song index is fetched first');
  assert.ok(!keys.has('https://tabs.example.com/tabs/data/site.json'));
  assert.equal(keys.size, SHELL.filter((e) => !e.startsWith('data/')).length - 1, "'./' and index.html share a key");
  assert.ok(REFRESH_INTERVAL >= 60 * 1000 && REFRESH_INTERVAL <= 60 * 60 * 1000, 'refreshed within the hour, not on every navigation');
});

test('sw.js imports its list from js/offline.js', async () => {
  const worker = await readFile(new URL('sw.js', root), 'utf8');
  assert.match(worker, /import \{ CACHE, SHELL, REFRESH_INTERVAL, strategyFor, pageKey, shellKeys \} from '\.\/js\/offline\.js'/);
});
