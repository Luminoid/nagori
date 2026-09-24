// The home page's sort modes and grouping (js/song-sort.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SORTS, DEFAULT_SORT, parseDuration, sortName, sortSongs, groupSongs, keyLabel } from '../js/song-sort.js';

const rows = [
  { id: 'op-60-no-3', title: 'Op. 60 No. 3', artist: 'Fernando Sor', artistSort: 'Sor, Fernando', key: 'C major', bpm: 160, duration: '0:41', added: '2026-09-22' },
  { id: 'the-water', title: 'The Water Is Wide', artist: 'Traditional', key: 'G major', bpm: 80, duration: '1:30', added: '2026-09-23' },
  { id: 'op-60-no-10', title: 'Op. 60 No. 10', artist: 'Fernando Sor', artistSort: 'Sor, Fernando', key: 'A minor', bpm: 120, duration: null, added: '2026-09-23' },
  { id: 'bourree', title: 'Bourrée in E minor', artist: 'Johann Sebastian Bach', artistSort: 'Bach, Johann Sebastian', key: 'E minor', bpm: 120, duration: '0:48', added: '2026-09-23' },
  { id: 'a-song', title: 'A Song', artist: 'Anonymous', key: null, bpm: null, duration: '0:10' },
];
const ids = (list) => list.map((s) => s.id);

test('parseDuration and sortName', () => {
  assert.equal(parseDuration('1:30'), 90);
  assert.equal(parseDuration('1:02:03'), 3723);
  assert.equal(parseDuration('long'), null);
  assert.equal(parseDuration(null), null);
  assert.equal(sortName('The Water Is Wide'), 'Water Is Wide');
  assert.equal(sortName('A Song'), 'Song');
  assert.equal(sortName('Anonymous'), 'Anonymous');
});

test('artist order uses the curated sort name, then the title with numbers in order', () => {
  assert.equal(DEFAULT_SORT, 'artist');
  assert.deepEqual(ids(sortSongs(rows)), ['a-song', 'bourree', 'op-60-no-3', 'op-60-no-10', 'the-water']);
  assert.deepEqual(ids(rows), ['op-60-no-3', 'the-water', 'op-60-no-10', 'bourree', 'a-song'], 'the input is untouched');
  assert.deepEqual(ids(sortSongs(rows, 'nonsense')), ids(sortSongs(rows, 'artist')));
});

test('the other modes: title without articles, newest by date then position, key from C, tempo and length with unknowns last', () => {
  assert.deepEqual(ids(sortSongs(rows, 'title')), ['bourree', 'op-60-no-3', 'op-60-no-10', 'a-song', 'the-water']);
  assert.deepEqual(ids(sortSongs(rows, 'newest')), ['bourree', 'op-60-no-10', 'the-water', 'op-60-no-3', 'a-song']);
  assert.deepEqual(ids(sortSongs(rows, 'key')), ['op-60-no-3', 'bourree', 'the-water', 'op-60-no-10', 'a-song']);
  assert.deepEqual(ids(sortSongs(rows, 'tempo')), ['the-water', 'bourree', 'op-60-no-10', 'op-60-no-3', 'a-song']);
  assert.deepEqual(ids(sortSongs(rows, 'length')), ['a-song', 'op-60-no-3', 'bourree', 'the-water', 'op-60-no-10']);
  assert.deepEqual(SORTS, ['artist', 'title', 'newest', 'key', 'tempo', 'length']);
});

test('groups form over runs of the same artist or key, and never for a single run or the flat modes', () => {
  const label = (song, mode) => (mode === 'key' ? song.key || 'none' : song.artist);
  const byArtist = groupSongs(sortSongs(rows, 'artist'), 'artist', label);
  assert.deepEqual(
    byArtist.map((g) => [g.label, g.songs.length]),
    [
      ['Anonymous', 1],
      ['Johann Sebastian Bach', 1],
      ['Fernando Sor', 2],
      ['Traditional', 1],
    ],
  );
  const byKey = groupSongs(sortSongs(rows, 'key'), 'key', label);
  assert.deepEqual(byKey.map((g) => g.label), ['C major', 'E minor', 'G major', 'A minor', 'none']);
  assert.deepEqual(groupSongs(sortSongs(rows, 'title'), 'title', label).map((g) => g.label), [null]);
  assert.deepEqual(groupSongs(rows.slice(0, 1), 'artist', label), [{ label: null, songs: rows.slice(0, 1) }]);
});

test('keyLabel gives one heading per key however it is spelled', () => {
  assert.equal(keyLabel('E'), 'E major');
  assert.equal(keyLabel('E major'), 'E major');
  assert.equal(keyLabel('Em'), 'E minor');
  assert.equal(keyLabel('A♭ minor (G minor shapes, capo 1)'), 'A♭ minor');
  assert.equal(keyLabel('Bb'), 'Bb major');
  assert.equal(keyLabel('modal'), 'modal');
  assert.equal(keyLabel(null), null);
  const label = (song, mode) => (mode === 'key' ? keyLabel(song.key) : song.artist);
  const rows = [{ id: 'a', title: 'A', key: 'E' }, { id: 'b', title: 'B', key: 'E major' }, { id: 'c', title: 'C', key: 'E minor' }];
  assert.deepEqual(groupSongs(sortSongs(rows, 'key'), 'key', label).map((g) => [g.label, g.songs.length]), [['E major', 2], ['E minor', 1]]);
});
