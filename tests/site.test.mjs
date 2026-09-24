// data/site.json is what a fork edits first: it has to parse and use known keys and languages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { matchSongs } from '../js/home.js';
import { pageHref } from '../js/site.js';

test('site.json has the documented shape', async () => {
  const site = JSON.parse(await readFile(new URL('../data/site.json', import.meta.url), 'utf8'));
  assert.equal(typeof site.name, 'string');
  assert.ok(site.name.trim());
  assert.ok(['auto', 'en', 'zh'].includes(site.defaultLang));
  assert.equal(typeof site.url, 'string');
  assert.equal(typeof site.copyright, 'string');
  for (const key of ['title', 'intro', 'collection', 'footer']) {
    assert.equal(typeof site[key], 'object', key);
    for (const lang of Object.keys(site[key])) assert.ok(['en', 'zh'].includes(lang), `${key}.${lang}`);
  }
  if ('cleanUrls' in site) assert.equal(typeof site.cleanUrls, 'boolean');
  assert.deepEqual(Object.keys(site).filter((k) => !['name', 'defaultLang', 'url', 'cleanUrls', 'copyright', 'title', 'intro', 'collection', 'footer'].includes(k)), []);
});

test('page links drop .html only when the site says its host serves pages without it', () => {
  assert.equal(pageHref('song.html?id=x&view=tab', false), 'song.html?id=x&view=tab');
  assert.equal(pageHref('song.html?id=x&view=tab', true), 'song?id=x&view=tab');
  assert.equal(pageHref('songs/lagrima.html#app', true), 'songs/lagrima#app');
  assert.equal(pageHref('tools.html#tuner', true), 'tools#tuner');
  assert.equal(pageHref('index.html?lang=zh', true), './?lang=zh');
  assert.equal(pageHref('index.html', true), './');
  assert.equal(pageHref('./', true), './');
  assert.equal(pageHref('tools.html.bak', true), 'tools.html.bak');
  assert.equal(pageHref('https://example.com/page.html', true), 'https://example.com/page.html');
  assert.equal(pageHref('mailto:x@example.com', true), 'mailto:x@example.com');
});

test('the home page filter matches every word against title, artist and album', () => {
  const songs = [
    { id: 'a', title: 'Knives Out', artist: 'Radiohead', album: 'Amnesiac' },
    { id: 'b', title: 'Let Down', artist: 'Radiohead', album: 'OK Computer', year: 1997 },
    { id: 'c', title: 'Twelve-Bar Blues in E', artist: 'Traditional' },
  ];
  assert.deepEqual(matchSongs(songs, '').map((s) => s.id), ['a', 'b', 'c']);
  assert.deepEqual(matchSongs(songs, 'radiohead ok').map((s) => s.id), ['b']);
  assert.deepEqual(matchSongs(songs, '1997').map((s) => s.id), ['b']);
  assert.deepEqual(matchSongs(songs, 'BLUES').map((s) => s.id), ['c']);
  assert.deepEqual(matchSongs(songs, 'nothing here'), []);
});

test('the filter ignores accents and searches the sort name too', () => {
  const songs = [
    { id: 'lagrima', title: 'Lágrima', artist: 'Francisco Tárrega', artistSort: 'Tárrega, Francisco' },
    { id: 'bourree', title: 'Bourrée in E minor', artist: 'Johann Sebastian Bach', artistSort: 'Bach, Johann Sebastian' },
  ];
  assert.deepEqual(matchSongs(songs, 'tarrega').map((s) => s.id), ['lagrima']);
  assert.deepEqual(matchSongs(songs, 'Tárrega lagrima').map((s) => s.id), ['lagrima']);
  assert.deepEqual(matchSongs(songs, 'bourree').map((s) => s.id), ['bourree']);
  assert.deepEqual(matchSongs(songs, 'bach, johann').map((s) => s.id), ['bourree']);
});
