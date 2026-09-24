// Songs a visitor adds from a folder (js/local-songs.js): grouping a folder's files into songs, the checks, the rows and the store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readSongFolders, checkSong, indexRow, makeRecord, songLength, slugify, memoryStore, entriesFromFileList } from '../js/local-songs.js';

const root = new URL('../', import.meta.url);
const example = async (prefix = 'twelve-bar-blues') => {
  const files = ['song.json', 'tracks/guitar.json', 'tracks/bass.json'];
  const entries = [];
  for (const file of files) {
    const text = await readFile(new URL(`examples/twelve-bar-blues/${file}`, root), 'utf8');
    entries.push({ path: `${prefix}/${file}`, text: async () => text });
  }
  return entries;
};

test('a song folder becomes a song with its track files, a collection of folders several', async () => {
  const one = await readSongFolders(await example());
  assert.equal(one.problems.length, 0);
  assert.equal(one.songs.length, 1);
  const { folder, song, files, curation } = one.songs[0];
  assert.equal(folder, 'twelve-bar-blues');
  assert.equal(song.id, 'twelve-bar-blues');
  assert.deepEqual(Object.keys(files).sort(), ['tracks/bass.json', 'tracks/guitar.json']);
  assert.equal(files['tracks/guitar.json'].measures.length, song.bars);
  assert.equal(curation, null);

  const many = await readSongFolders([...(await example('collection/twelve-bar-blues')), ...(await example('collection/other')), { path: 'collection/notes.txt', text: async () => 'hi' }]);
  assert.equal(many.songs.length, 2);
  assert.deepEqual(many.songs.map((s) => s.folder).sort(), ['other', 'twelve-bar-blues']);
});

test('a curation.json beside the song supplies its duration and sort name; a missing id takes the folder name', async () => {
  const entries = await example('My Blues Folder');
  const song = JSON.parse(await entries[0].text());
  delete song.id;
  entries[0] = { path: entries[0].path, text: async () => JSON.stringify(song) };
  entries.push({ path: 'My Blues Folder/curation.json', text: async () => JSON.stringify({ duration: '0:29', sortArtist: 'Traditional, The' }) });
  const { songs, problems } = await readSongFolders(entries);
  assert.equal(problems.length, 0);
  assert.equal(songs[0].song.id, 'my-blues-folder');
  const record = await makeRecord(songs[0], '2026-09-24');
  assert.equal(record.id, 'my-blues-folder');
  assert.equal(record.row.duration, '0:29');
  assert.equal(record.row.artistSort, 'Traditional, The');
  assert.equal(record.row.added, '2026-09-24');
  assert.equal(record.row.tracks, 2);
  assert.equal(record.row.video, false);
});

test('without a curated duration the record takes the length the tempo map gives', async () => {
  const { songs } = await readSongFolders(await example());
  assert.equal(await songLength(songs[0].song, songs[0].files), '0:29');
  const record = await makeRecord(songs[0], '2026-09-24');
  assert.equal(record.row.duration, '0:29');
  assert.deepEqual(Object.keys(record).sort(), ['added', 'files', 'id', 'row', 'song']);
});

test('broken folders are reported, not added', async () => {
  const entries = await example();
  const song = JSON.parse(await entries[0].text());
  song.bars = 13;
  song.tracks.push({ id: 'drums', kind: 'drums', file: 'tracks/drums.json' });
  const broken = [{ path: entries[0].path, text: async () => JSON.stringify(song) }, ...entries.slice(1), { path: 'bad/song.json', text: async () => '{not json' }, { path: 'empty/song.json', text: async () => '{}' }, { path: 'odd/song.json', text: async () => '{"id":"Bad ID"}' }];
  const { songs, problems } = await readSongFolders(broken);
  assert.equal(songs.length, 0);
  const keys = problems.map((p) => `${p.folder}:${p.key}`).sort();
  assert.ok(keys.includes('twelve-bar-blues:local.check.bars'), keys.join(' '));
  assert.ok(keys.includes('twelve-bar-blues:local.check.track'));
  assert.ok(keys.includes('twelve-bar-blues:local.check.kind'));
  assert.ok(keys.includes('bad:local.check.json'));
  assert.ok(!keys.includes('empty:local.check.id'), 'an empty song takes its folder name as id');
  assert.ok(keys.includes('empty:local.check.field'));
  assert.ok(keys.includes('odd:local.check.id'), 'an id the site cannot use is reported');
  assert.deepEqual(checkSong(null, {}), [{ key: 'local.check.json', params: { file: 'song.json' } }]);
  assert.deepEqual(checkSong({ id: 'x', title: 'T', artist: 'A', bars: 1, timeSignature: [4, 4], tracks: [] }, {}), [{ key: 'local.check.field', params: { field: 'tracks' } }]);
});

test('indexRow has the shape of a data/songs.json row, and slugify makes ids', () => {
  const row = indexRow({ id: 'a', title: 'A', artist: 'B', tracks: [{}, {}], key: 'E', bpm: 100, video: { id: 'x' } }, { added: '2026-09-24' });
  assert.deepEqual(row, { id: 'a', title: 'A', artist: 'B', album: null, year: null, key: 'E', bpm: 100, tuning: null, duration: null, tracks: 2, video: true, added: '2026-09-24' });
  assert.equal(slugify('Tárrega: Lágrima (duo)'), 'tarrega-lagrima-duo');
  assert.equal(slugify('  '), '');
});

test('the memory store round-trips records like the IndexedDB one, and file lists become entries', async () => {
  const store = memoryStore();
  await store.put({ id: 'a', row: { id: 'a' } });
  await store.put({ id: 'b', row: { id: 'b' } });
  assert.deepEqual((await store.list()).map((r) => r.id), ['a', 'b']);
  assert.equal((await store.get('a')).id, 'a');
  await store.remove('a');
  assert.equal(await store.get('a'), undefined);
  await store.clear();
  assert.deepEqual(await store.list(), []);
  const entries = entriesFromFileList([{ webkitRelativePath: 'folder/song.json', text: async () => '{}' }, { name: 'loose.json', text: async () => '[]' }]);
  assert.deepEqual(entries.map((e) => e.path), ['folder/song.json', 'loose.json']);
  assert.equal(await entries[1].text(), '[]');
});
