// Offline support: the shell list must name real files (cache.addAll fails on a single 404),
// and the worker must leave other origins and non-GET requests alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { SHELL, CACHE, strategyFor } from '../js/offline.js';

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
  assert.equal(strategyFor(`${origin}/data/songs/x/song.json`, 'GET', origin), 'asset');
  assert.equal(strategyFor(`${origin}/js/tools.js`, 'GET', origin), 'asset');
  assert.equal(strategyFor('https://www.youtube.com/iframe_api', 'GET', origin), null);
  assert.equal(strategyFor(`${origin}/data/site.json`, 'POST', origin), null);
  assert.equal(strategyFor('not a url', 'GET', origin), null);
});

test('sw.js imports its list from js/offline.js', async () => {
  const worker = await readFile(new URL('sw.js', root), 'utf8');
  assert.match(worker, /import \{ CACHE, SHELL, strategyFor \} from '\.\/js\/offline\.js'/);
});
