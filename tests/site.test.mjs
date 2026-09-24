// data/site.json is what a fork edits first: it has to parse and use known keys and languages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { matchSongs } from '../js/home.js';

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
  assert.deepEqual(Object.keys(site).filter((k) => !['name', 'defaultLang', 'url', 'copyright', 'title', 'intro', 'collection', 'footer'].includes(k)), []);
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
