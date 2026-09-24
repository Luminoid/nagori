import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dictionaries, t, setLanguage, sectionName, roleName, tuningName, keyName } from '../js/i18n.js';

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('the Chinese dictionary covers every English key with the same placeholders', () => {
  const en = Object.keys(dictionaries.en).sort();
  const zh = Object.keys(dictionaries.zh).sort();
  assert.deepEqual(zh, en);
  for (const key of en) assert.deepEqual(placeholders(dictionaries.zh[key]), placeholders(dictionaries.en[key]), key);
  for (const key of en) assert.ok(dictionaries.zh[key].trim().length > 0, `${key} is empty`);
});

test('t interpolates parameters and falls back to English or the key', () => {
  setLanguage('zh');
  assert.equal(t('home.tracks', { n: 3 }), '3 条音轨');
  assert.equal(t('capo.fret', { n: 2 }), '第 2 品');
  assert.equal(t('not.a.key'), 'not.a.key');
  setLanguage('en');
  assert.equal(t('home.tracks', { n: 3 }), '3 tracks');
  assert.equal(t('section.title', { name: 'Verse 1', from: 5, to: 12 }), 'Verse 1: bars 5–12');
});

test('song data words are translated in Chinese and untouched in English', () => {
  setLanguage('zh');
  assert.equal(sectionName('Verse 1'), '主歌 1');
  assert.equal(sectionName('Intro'), '前奏');
  assert.equal(sectionName('Pre-Verse'), '主歌前段');
  assert.equal(sectionName('Something odd'), 'Something odd');
  assert.equal(roleName('Lead guitar · Fender Telecaster'), '主音吉他 · Fender Telecaster');
  assert.equal(roleName('Bass'), '贝斯');
  assert.equal(roleName('Guitar 2 · Martin D-35'), '吉他 2 · Martin D-35');
  assert.equal(tuningName('Standard (E A D G B E)'), '标准调弦 (E A D G B E)');
  assert.equal(tuningName('Drop D (D A D G B E)'), '降 D 调弦 (D A D G B E)');
  assert.equal(tuningName('D A D F♯ B E'), 'D A D F♯ B E');
  assert.equal(keyName('C minor'), 'C 小调');
  assert.equal(keyName('A major'), 'A 大调');
  assert.equal(keyName('A♭ minor (G minor shapes, capo 1)'), 'A♭ 小调（G 小调指型，变调夹 1 品）');
  setLanguage('en');
  assert.equal(sectionName('Verse 1'), 'Verse 1');
  assert.equal(roleName('Lead guitar · Fender Telecaster'), 'Lead guitar · Fender Telecaster');
  assert.equal(keyName('C minor'), 'C minor');
});
