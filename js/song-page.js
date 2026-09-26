// Song page controller: header, chords/tab views, video sync, positions.

import { h, clear, loadJSON, storage, formatChord, chordKey, formatTime, formatBarList, setupThemeToggle, setupPrintTheme, debounce, stringNames, isEditing } from './util.js';
import { layoutTrack, renderSystem, beatIndexAt } from './tab-renderer.js';
import { analyzeTrack, positionsBySection, fingerString } from './fingering.js';
import { libraryFor, STANDARD_TUNING } from './chord-library.js';
import { loadSite, applySite, pageTitle, siteText, pageHref } from './site.js';
import { registerOffline } from './offline.js';
import { openStore } from './local-songs.js';
import { parseKey, tuningFor } from './theory.js';
import { diagramSVG } from './chord-diagram.js';
import { renderChordSheet } from './chord-sheet.js';
import { BarClock, VideoSync } from './video-sync.js';
import { TabPlayer, tabClock, SOUNDS, SOUND_AUTO } from './tab-audio.js';
import { t, applyLang, setupLanguageToggle, sectionName, roleName, tuningName, keyName, parens } from './i18n.js';

const params = new URLSearchParams(location.search);
/** songs/<id>.html names its song on <main data-song>; song.html takes ?id=. */
const PAGE_SONG = document.getElementById('app')?.dataset.song || '';
let songId = params.get('id') || PAGE_SONG;
/** `base=private` opens a song from private/songs (a collection git never sees) instead of data/songs; `base=local` one the visitor added from a folder, kept in this browser's store. */
const BASE = params.get('base') === 'private' ? 'private' : params.get('base') === 'local' ? 'local' : 'public';
const SONG_ROOT = BASE === 'private' ? 'private/songs/' : 'data/songs/';
let DATA_BASE = '';
let localRecord = null; // the store record of a visitor's own song: its song.json and track files

/** The song.json for an id, from the site's files or from the browser's store. */
async function loadSongJSON(id) {
  if (BASE !== 'local') return loadJSON(`${SONG_ROOT}${id}/song.json`);
  const store = await openStore();
  localRecord = store ? await store.get(id) : null;
  if (!localRecord) throw new Error(t('local.missing'));
  return localRecord.song;
}

/** A sound picker value: a SOUNDS key, or "auto" for each part's own sound. */
function soundChoice(name) {
  return name === SOUND_AUTO || !name ? SOUND_AUTO : SOUNDS[name] ? name : SOUND_AUTO;
}

const state = {
  song: null,
  view: params.get('view') === 'chords' ? 'chords' : 'tab',
  trackId: params.get('track'),
  tracks: new Map(), // id -> { track, analysis }
  layout: null,
  systemEls: [],
  barToSystem: [],
  showFingers: storage.get('nagori:fingers', true),
  showLyrics: storage.get('nagori:lyrics', true),
  lyricIndex: -1, // the syllable lit under the playhead, and its element
  lyricEl: null,
  autoscroll: storage.get('nagori:autoscroll', true),
  sync: null, // the active player: state.video or state.tab
  video: null,
  tab: null,
  tabPromise: null,
  source: params.get('source') === 'tab' || params.get('source') === 'video' ? params.get('source') : storage.get('nagori:source', 'video'),
  sound: soundChoice(params.get('sound') || storage.get('nagori:sound', SOUND_AUTO)),
  files: new Map(), // track file -> promise of its JSON
  pos: { bar: -1, beat: -1, system: -1 },
  sectionIndex: -1,
  chordIndex: -1,
  sheet: null,
  positions: null, // [{ name, cards }]
  cardBySegment: new Map(),
  sidebarCards: new Map(),
  lastSecond: -1,
  lastScrolledSection: null,
  activeCardEl: null,
  layoutWidth: 0,
};

const els = {};

// --- Helpers ------------------------------------------------------------------

function sectionIndexFor(bar) {
  const sections = state.song.sections;
  let idx = -1;
  for (let i = 0; i < sections.length; i++) if (sections[i].bar <= bar) idx = i;
  return idx;
}

/** "Verse 1" -> "V1", "Intro" -> "In": labels short enough for the section bar. */
function shortSectionName(name) {
  const number = (name.match(/\d+/) || [''])[0];
  const letters = name.replace(/\d+/g, '').trim();
  return number ? `${letters[0] || ''}${number}` : letters.slice(0, 2);
}

function sectionRange(i) {
  const sections = state.song.sections;
  const start = sections[i].bar;
  const end = i + 1 < sections.length ? sections[i + 1].bar - 1 : state.song.bars - 1;
  return { startBar: start, endBar: end };
}

function chordIndexAt(bar, frac) {
  const timeline = state.song.chordTimeline;
  const key = bar + frac;
  let lo = 0;
  let hi = timeline.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid].bar + timeline[mid].pos <= key + 1e-6) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

function updateUrl() {
  const next = new URLSearchParams(location.search); // a shared link's lang, source and sound stay in the address
  for (const key of ['id', 'base', 'view', 'track']) next.delete(key);
  if (next.get('source') && next.get('source') !== state.source) next.delete('source'); // the visitor chose otherwise; storage remembers it
  if (next.get('sound') && next.get('sound') !== state.sound) next.delete('sound');
  if (songId !== PAGE_SONG) next.set('id', songId);
  if (BASE !== 'public') next.set('base', BASE);
  next.set('view', state.view);
  if (state.view === 'tab' && state.trackId) next.set('track', state.trackId);
  const query = `${location.pathname}?${next}`;
  history.replaceState(null, '', query);
  // The skip link names this address: a bare "#app" would resolve against the song pages' <base> and reload the page.
  const skip = document.querySelector('.skip-link');
  if (skip) skip.setAttribute('href', `${query}#app`);
}

function loadTrackFile(meta) {
  if (!state.files.has(meta.file)) {
    const promise = BASE === 'local' ? (localRecord?.files?.[meta.file] ? Promise.resolve(localRecord.files[meta.file]) : Promise.reject(new Error(t('local.missing')))) : loadJSON(DATA_BASE + meta.file);
    promise.catch(() => state.files.delete(meta.file)); // a failed fetch is retried next time, not remembered
    state.files.set(meta.file, promise);
  }
  return state.files.get(meta.file);
}

async function getTrack(trackId) {
  if (state.tracks.has(trackId)) return state.tracks.get(trackId);
  const meta = state.song.tracks.find((tr) => tr.id === trackId);
  const track = await loadTrackFile(meta);
  track.id = meta.id;
  const analysis = analyzeTrack(track, {
    library: libraryFor(state.song, meta),
    overrides: state.song.fingeringOverrides,
    chordTimeline: state.song.chordTimeline,
    trackId: meta.id,
    ...(meta.fingering?.maxSpan ? { maxSpan: meta.fingering.maxSpan } : {}),
  });
  const entry = { meta, track, analysis };
  state.tracks.set(trackId, entry);
  return entry;
}

// --- Header -------------------------------------------------------------------

/** "138 BPM", "92 BPM (half notes)" for cut time, "169–164 BPM" when the tempo map changes. */
function tempoLabel(song) {
  const tempo = song.tempo || [];
  if (!tempo.length) return song.bpm ? `${song.bpm} ${t('meta.bpm')}` : null;
  const first = tempo[0];
  const last = tempo[tempo.length - 1];
  const unit = first.unit && first.unit !== 4 ? ` (${t(`tempo.unit.${first.unit}`)})` : '';
  return `${first.bpm}${last.bpm !== first.bpm ? `–${last.bpm}` : ''} ${t('meta.bpm')}${unit}`;
}

function renderHead(song) {
  // The key and tuning chips open the fretboard with that scale and tuning selected.
  const key = parseKey(song.key);
  const guitar = [song.tracks.find((tr) => tr.id === song.defaultTrack), ...song.tracks].find((tr) => tr && tr.kind === 'guitar') || song.tracks[0];
  const tuning = tuningFor(guitar?.tuning);
  const fretboardLink = (extra) => pageHref(`tools.html?${new URLSearchParams({ ...(tuning ? { tuning: tuning.id } : {}), ...extra })}#fretboard`);
  const chips = [
    [t('meta.key'), keyName(song.key), key ? { href: fretboardLink({ root: key.root, scale: key.scale, names: key.flats ? 'flats' : 'sharps' }), title: t('meta.keyLink') } : null],
    [t('meta.tempo'), tempoLabel(song)],
    [t('meta.time'), (song.timeSignatures && song.timeSignatures.length ? song.timeSignatures : [song.timeSignature]).filter(Boolean).map((sig) => sig.join('/')).join(' · ') || null],
    [t('meta.tuning'), tuningName(song.tuning), tuning ? { href: fretboardLink({}), title: t('meta.tuningLink') } : null],
    [t('meta.capo'), song.capo ? t('capo.fret', { n: song.capo }) : song.tracks.some((tr) => tr.capo) ? t('capo.perPart') : t('capo.none')],
    [t('meta.bars'), song.bars],
  ].filter(([, v]) => v !== null && v !== undefined);
  const subtitle = [song.artist, song.album ? `${song.album}${song.year ? parens(song.year) : ''}` : null].filter(Boolean).join(' · ');
  return h(
    'div',
    { class: 'song-head' },
    h(
      'div',
      { class: 'song-title' },
      h('h1', {}, song.title),
      h('div', { class: 'artist' }, subtitle),
      h('div', { class: 'meta' }, chips.map(([k, v, link]) => h(link ? 'a' : 'span', { class: 'meta-chip', ...(link || {}) }, `${k} `, h('b', {}, String(v))))),
    ),
  );
}

// --- Sidebar: video, transport, now playing ------------------------------------

function renderSidebar() {
  const song = state.song;
  const sections = song.sections;
  els.ytMount = h('div', { id: 'yt-mount' });
  els.videoFrame = h('div', { class: 'video-frame' }, els.ytMount, h('div', { class: 'video-placeholder' }, song.video ? t('video.loading') : t('video.none')));
  els.playBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => state.sync?.toggle() }, playIcon(false), t('transport.play'));
  els.timeLabel = h('span', { class: 'meta-chip' }, h('b', {}, '0:00'), h('span', {}, ' / 0:00'));
  els.speed = h(
    'select',
    { class: 'select', 'aria-label': t('transport.speed'), onchange: (e) => state.sync?.setRate(parseFloat(e.target.value)) },
    ...[0.5, 0.75, 1].map((r) => h('option', { value: r, selected: r === 1 }, `${r}×`)),
  );
  els.loop = h(
    'select',
    { class: 'select', 'aria-label': t('transport.loopLabel'), onchange: (e) => setLoop(e.target.value) },
    h('option', { value: '' }, t('transport.loopNone')),
    ...sections.map((s, i) => h('option', { value: i }, t('transport.loop', { name: sectionName(s.name) }))),
  );
  els.autoscroll = h('input', { type: 'checkbox', checked: state.autoscroll ? true : null, onchange: (e) => {
    state.autoscroll = e.target.checked;
    storage.set('nagori:autoscroll', state.autoscroll);
  } });
  const transport = h(
    'div',
    { class: 'transport' },
    els.playBtn,
    els.timeLabel,
    h('span', { class: 'spacer' }),
    els.speed,
    els.loop,
    h('label', { class: 'toggle' }, els.autoscroll, t('transport.follow')),
  );

  els.sourceVideo = h('button', { type: 'button', 'aria-pressed': 'true', onclick: () => setSource('video') }, t('source.video'));
  els.sourceTab = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => setSource('tab') }, t('source.tab'));
  els.clickToggle = h('input', { type: 'checkbox', onchange: (e) => state.tab?.setClick(e.target.checked) });
  els.clickLabel = h('label', { class: 'toggle', title: t('source.clickTitle'), style: { display: 'none' } }, els.clickToggle, t('source.click'));
  els.mixer = h('div', { class: 'mixer', role: 'group', 'aria-label': t('source.parts'), style: { display: 'none' } });
  els.playerError = h('p', { class: 'status error', hidden: true });
  els.soundSelect = h(
    'select',
    { 'aria-label': t('sound.label'), onchange: (e) => setSound(e.target.value) },
    h('option', { value: SOUND_AUTO }, t('sound.auto')),
    ...Object.keys(SOUNDS).map((name) => h('option', { value: name }, t(`sound.${name}`))),
  );
  els.soundSelect.value = state.sound;
  els.soundLabel = h('label', { class: 'sound-field', title: t('sound.title'), style: { display: 'none' } }, h('span', {}, t('sound.label')), els.soundSelect);
  // Without a video there is nothing to switch from, so the row starts with the sound picker instead of a one-option switch.
  els.sourceRow = song.video
    ? h('div', { class: 'source-row' }, h('div', { class: 'segmented small', role: 'group', 'aria-label': t('source.label') }, els.sourceVideo, els.sourceTab), els.clickLabel, els.soundLabel, els.mixer, els.playerError)
    : h('div', { class: 'source-row no-video' }, els.soundLabel, els.mixer, els.clickLabel, els.playerError); // the click toggle ends the part chips' row

  els.nowChord = h('div', { class: 'chord idle' }, '—');
  els.nowWhere = h('div', { class: 'where' }, t('now.idle'));
  els.nowNext = h('div', { class: 'next' }, '');
  els.nowStatus = h('div', { class: 'sr-only', role: 'status' }); // section changes and pauses, for screen readers
  const now = h('div', { class: 'now-playing' }, els.nowChord, els.nowWhere, els.nowNext, els.nowStatus);

  els.sectionBar = h('div', { class: 'section-bar', role: 'group', 'aria-label': t('sections.label') });
  sections.forEach((s, i) => {
    const { startBar, endBar } = sectionRange(i);
    const name = sectionName(s.name);
    const btn = h('button', { type: 'button', title: t('section.title', { name, from: startBar + 1, to: endBar + 1 }), 'aria-label': t('section.title', { name, from: startBar + 1, to: endBar + 1 }), style: { '--w': String(endBar - startBar + 1) }, onclick: () => seekBar(startBar) }, h('span', { class: 'fill' }), shortSectionName(name));
    els.sectionBar.append(btn);
  });

  els.offsetLabel = h('span', { class: 'offset' }, t('sync.seconds', { n: '+0.00' }));
  els.syncRow = h(
    'div',
    { class: 'sync-row' },
    t('sync.offset'),
    h('button', { class: 'btn small', type: 'button', onclick: () => nudgeOffset(-0.05), 'aria-label': t('sync.earlier') }, '−'),
    els.offsetLabel,
    h('button', { class: 'btn small', type: 'button', onclick: () => nudgeOffset(0.05), 'aria-label': t('sync.later') }, '+'),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn small', type: 'button', onclick: () => setOffset(0) }, t('sync.reset')),
  );

  const videoPanel = h('div', { class: 'panel video-sticky' }, ...(song.video ? [els.videoFrame] : []), transport, els.sourceRow, now, els.sectionBar, els.syncRow);

  els.positionsPanelTitle = h('h2', {}, t('positions.title')); // the sidebar comes before the content's h2s in reading order
  els.positionsPanelGrid = h('div', { class: 'position-grid' });
  els.positionsPanel = h('div', { class: 'panel positions-panel' }, h('div', { class: 'panel-body' }, els.positionsPanelTitle, els.positionsPanelGrid));

  return h('aside', { class: 'sidebar' }, videoPanel, els.positionsPanel);
}

function playIcon(playing) {
  return h('span', { html: playing
    ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>' });
}

function setPlaying(playing) {
  if (els.nowStatus && !playing && state.pos.bar >= 0) els.nowStatus.textContent = t('now.paused');
  clear(els.playBtn).append(playIcon(playing), playing ? t('transport.pause') : t('transport.play'));
}

function setLoop(value) {
  if (!state.sync) return;
  if (value === '') {
    state.sync.setLoop(null);
    return;
  }
  const range = sectionRange(Number(value));
  state.sync.setLoop(range);
  state.sync.seekBar(range.startBar);
  state.sync.play();
}

function offsetKey() {
  return `nagori:offset:${songId}`;
}

function setOffset(value) {
  const v = Math.round(value * 100) / 100;
  if (state.video) state.video.offset = v;
  storage.set(offsetKey(), v);
  els.offsetLabel.textContent = t('sync.seconds', { n: `${v >= 0 ? '+' : ''}${v.toFixed(2)}` });
}

function nudgeOffset(delta) {
  setOffset((state.video ? state.video.offset : 0) + delta);
}

function seekBar(bar, frac = 0) {
  if (!state.sync) return;
  state.sync.seekBar(bar, frac);
}

// --- Players: the video, or the tab synthesized in the browser ------------------

/** A player that could not be built (a track file missing, audio refused): say so in the sidebar. */
function showPlayerError(err) {
  if (!els.playerError) return;
  els.playerError.textContent = t('player.error', { message: err.message });
  els.playerError.hidden = false;
}

async function initPlayers() {
  const song = state.song;
  if (song.video && song.video.provider === 'youtube') {
    const clock = new BarClock(song.video.barTimes, { bpm: song.bpm, timeSignature: song.timeSignature });
    const video = new VideoSync({ mount: els.ytMount, videoId: song.video.id, clock, offset: storage.get(offsetKey(), 0) });
    state.video = video;
    setOffset(video.offset);
    video.addEventListener('tick', (e) => {
      if (state.sync === video) onTick(e.detail);
    });
    video.addEventListener('state', (e) => {
      // Pressing play inside the YouTube frame makes the video the source again.
      if (e.detail.playing && state.sync !== video) setSource('video', { fromPlayer: true });
      else if (state.sync === video) setPlaying(e.detail.playing);
    });
    video
      .init()
      .then(() => {
        els.videoFrame.querySelector('.video-placeholder')?.remove();
        if (state.sync === video) els.timeLabel.lastChild.textContent = ` / ${formatTime(clock.end)}`;
      })
      .catch((err) => {
        const placeholder = els.videoFrame.querySelector('.video-placeholder');
        if (placeholder) placeholder.textContent = t('video.unavailable', { message: err.message });
        els.sourceVideo.disabled = true;
        if (state.sync === video) setSource('tab', { remember: false }).catch(showPlayerError);
      });
  } else {
    els.sourceVideo.disabled = true;
  }
  await setSource(state.video && state.source !== 'tab' ? 'video' : 'tab', { remember: false });
}

/** Loads every track and builds the tab player once. */
function ensureTabPlayer() {
  if (!state.tabPromise) {
    state.tabPromise = (async () => {
      const song = state.song;
      const tracks = await Promise.all(
        song.tracks.map(async (meta) => {
          const file = await loadTrackFile(meta);
          return { id: meta.id, kind: meta.kind, capo: meta.capo || 0, sound: meta.sound || null, level: meta.level, strings: file.strings, tuning: file.tuning, measures: file.measures };
        }),
      );
      const clock = tabClock(song, tracks[0].measures, tracks.map((track) => track.measures));
      const player = new TabPlayer({ tracks, clock, timeSignature: song.timeSignature, sound: state.sound });
      player.prewarm(); // the plucks are synthesized while the page is idle, so pressing play does not wait for them
      player.addEventListener('tick', (e) => {
        if (state.sync === player) onTick(e.detail);
      });
      player.addEventListener('state', (e) => {
        if (state.sync === player) setPlaying(e.detail.playing);
      });
      await player.init();
      buildMixer(player);
      state.tab = player;
      return player;
    })();
    state.tabPromise.catch(() => {
      state.tabPromise = null; // so the next attempt rebuilds instead of failing forever
    });
  }
  return state.tabPromise;
}

/**
 * Switch between the video and the tab player, carrying the bar position, speed
 * and loop across. `fromPlayer`: the video started on its own, keep its position.
 */
/** `remember` is false for the page's own fallbacks (no video, a video that failed), which must not overwrite the listener's choice. */
async function setSource(source, { fromPlayer = false, remember = true } = {}) {
  const target = source === 'tab' ? await ensureTabPlayer() : state.video;
  if (!target) return;
  const from = state.sync;
  state.source = source;
  if (remember) storage.set('nagori:source', source);
  updateUrl();
  if (from !== target) {
    const pos = from && from.ready ? from.clock.timeToBar(from.time) : null;
    if (from) from.pause();
    state.sync = target;
    if (pos && !pos.before && !fromPlayer) target.seekBar(pos.bar, pos.frac);
    target.setRate(parseFloat(els.speed.value));
    target.setLoop(els.loop.value === '' ? null : sectionRange(Number(els.loop.value)));
  }
  applySourceUI();
  setPlaying(target.playing);
}

function applySourceUI() {
  const tab = state.tab !== null && state.sync === state.tab;
  els.sourceVideo.setAttribute('aria-pressed', String(!tab));
  els.sourceTab.setAttribute('aria-pressed', String(tab));
  els.mixer.style.display = tab ? '' : 'none';
  els.clickLabel.style.display = tab ? '' : 'none';
  els.soundLabel.style.display = tab ? '' : 'none';
  els.syncRow.style.display = tab ? 'none' : '';
  els.timeLabel.lastChild.textContent = ` / ${formatTime(state.sync.clock.end)}`;
  state.lastSecond = -1;
}

/** One chip per part; a pressed chip plays, an unpressed one is muted (mute the part you are practising). */
/** Pick the guitar sound for tab playback (a SOUNDS key); remembered across songs. */
function setSound(name) {
  state.sound = soundChoice(name);
  storage.set('nagori:sound', state.sound);
  updateUrl();
  els.soundSelect.value = state.sound;
  if (state.tab) state.tab.setSound(state.sound);
}

function buildMixer(player) {
  clear(els.mixer);
  const names = state.song.tracks.map((track) => track.name);
  for (const track of state.song.tracks) {
    const duplicate = names.filter((n) => n === track.name).length > 1;
    const role = roleName(track.role);
    const label = duplicate ? `${track.name} · ${role.split(' · ')[0]}` : track.name;
    const chip = h('button', { class: 'chip mini', type: 'button', 'aria-pressed': String(player.getVolume(track.id) > 0), title: t('mixer.hint', { name: track.name, role }) }, label);
    chip.addEventListener('click', () => {
      const on = chip.getAttribute('aria-pressed') !== 'true';
      chip.setAttribute('aria-pressed', String(on));
      player.setVolume(track.id, on ? (track.level ?? 1) : 0);
    });
    els.mixer.append(chip);
  }
}

// --- Tick ---------------------------------------------------------------------

function onTick({ time, bar, frac, before, playing }) {
  const second = Math.floor(time);
  if (second !== state.lastSecond) {
    state.lastSecond = second;
    els.timeLabel.firstChild.textContent = formatTime(time);
  }
  if (before) {
    if (state.pos.bar !== -1 || state.chordIndex !== -1) {
      hideCursor();
      state.pos = { bar: -1, beat: -1, system: -1 };
      state.chordIndex = -1; // so the first chord is announced again when bar 1 comes round
      els.nowChord.textContent = '—';
      els.nowChord.classList.add('idle');
      els.nowWhere.textContent = t('now.countIn');
      clear(els.nowNext);
    }
    return;
  }
  const sectionIndex = sectionIndexFor(bar);
  const chordIndex = chordIndexAt(bar, frac);
  if (chordIndex !== state.chordIndex) {
    state.chordIndex = chordIndex;
    const entry = state.song.chordTimeline[chordIndex];
    els.nowChord.textContent = entry ? formatChord(entry.chord) : '—';
    els.nowChord.classList.toggle('idle', !entry);
    let next = null;
    for (let i = chordIndex + 1; i < state.song.chordTimeline.length; i++) {
      if (state.song.chordTimeline[i].chord !== entry?.chord) {
        next = state.song.chordTimeline[i];
        break;
      }
    }
    clear(els.nowNext).append(...(next ? [`${t('now.next')} `, h('b', {}, formatChord(next.chord)), t('now.nextWhere', { n: next.bar + 1 })] : []));
    if (state.view === 'chords' && state.sheet) applySheetActive(sectionIndex, entry?.chord, playing);
  }
  if (bar !== state.pos.bar) {
    const section = state.song.sections[sectionIndex];
    els.nowWhere.textContent = t('now.where', { section: section ? sectionName(section.name) : t('now.bar'), n: bar + 1 });
    if (sectionIndex !== state.sectionIndex) {
      state.sectionIndex = sectionIndex;
      if (els.nowStatus) els.nowStatus.textContent = sectionIndex >= 0 ? sectionName(state.song.sections[sectionIndex].name) : '';
      for (const [i, btn] of [...els.sectionBar.children].entries()) btn.classList.toggle('is-active', i === sectionIndex);
      renderSidebarPositions(sectionIndex);
      if (state.view === 'chords' && state.sheet) applySheetActive(sectionIndex, state.song.chordTimeline[chordIndex]?.chord, playing);
    }
  }
  if (sectionIndex >= 0) {
    const { startBar, endBar } = sectionRange(sectionIndex);
    const p = ((bar - startBar + frac) / (endBar - startBar + 1)) * 100;
    els.sectionBar.children[sectionIndex].style.setProperty('--p', `${Math.min(100, Math.max(0, p)).toFixed(1)}%`);
  }
  if (state.view === 'tab') updateCursor(bar, frac, playing);
}

function applySheetActive(sectionIndex, chord, playing) {
  const name = state.song.sections[sectionIndex]?.name;
  const { sectionEl } = state.sheet.setActive(name, chord);
  if (sectionEl && playing && state.autoscroll && sectionEl !== state.lastScrolledSection) {
    state.lastScrolledSection = sectionEl;
    sectionEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function hideCursor() {
  if (state.pos.system >= 0 && state.systemEls[state.pos.system]) {
    const svg = state.systemEls[state.pos.system].firstElementChild;
    svg.querySelector('[data-cursor]').classList.add('is-hidden');
    svg.querySelector('.measure-bg.is-active')?.classList.remove('is-active');
  }
  state.lyricEl?.classList.remove('is-active');
  state.lyricEl = null;
  state.lyricIndex = -1;
}

/** Light the syllable being sung: the last one at or before (bar, frac), as long as it is from this bar or the one before. */
function updateLyric(bar, frac) {
  const lyrics = state.showLyrics ? state.song.lyrics : null;
  if (!lyrics || !lyrics.length) return;
  let lo = 0;
  let hi = lyrics.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const e = lyrics[mid];
    if (e.bar < bar || (e.bar === bar && e.pos <= frac + 1e-6)) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (idx >= 0 && bar - lyrics[idx].bar > 1) idx = -1;
  if (idx === state.lyricIndex) return;
  state.lyricEl?.classList.remove('is-active');
  state.lyricIndex = idx;
  state.lyricEl = idx >= 0 ? state.systemEls[state.barToSystem[lyrics[idx].bar]]?.querySelector(`[data-lyric="${idx}"]`) || null : null;
  state.lyricEl?.classList.add('is-active');
}

function updateCursor(bar, frac, playing) {
  const entry = state.tracks.get(state.trackId);
  if (!entry || !state.layout) return;
  const measure = entry.track.measures[bar];
  if (!measure) return;
  updateLyric(bar, frac);
  const beat = measure.beats.length ? beatIndexAt(measure, frac) : 0;
  if (bar === state.pos.bar && beat === state.pos.beat) return;
  const systemIndex = state.barToSystem[bar];
  const system = state.layout[systemIndex];
  const svg = state.systemEls[systemIndex]?.firstElementChild;
  if (!system || !svg) return;
  if (systemIndex !== state.pos.system) {
    hideCursor();
    if (playing && state.autoscroll) state.systemEls[systemIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  if (bar !== state.pos.bar) {
    svg.querySelector('.measure-bg.is-active')?.classList.remove('is-active');
    svg.querySelector(`.measure-bg[data-bar="${bar}"]`)?.classList.add('is-active');
  }
  const m = system.measures.find((mm) => mm.index === bar);
  const cursor = svg.querySelector('[data-cursor]');
  if (m.beats.length) {
    const geo = m.beats[beat];
    cursor.setAttribute('x', (geo.x - 6).toFixed(1));
    cursor.setAttribute('width', geo.w.toFixed(1));
  } else {
    cursor.setAttribute('x', m.x.toFixed(1));
    cursor.setAttribute('width', m.width.toFixed(1));
  }
  cursor.classList.remove('is-hidden');
  state.pos = { bar, beat, system: systemIndex };
  highlightSidebarCard(entry.analysis.segmentAt(bar, beat));
}

// --- Tab view -----------------------------------------------------------------

function renderToolbar() {
  const picker = h('div', { class: 'track-picker', role: 'group', 'aria-label': t('toolbar.track') });
  for (const track of state.song.tracks) {
    const role = roleName(track.role);
    picker.append(
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(track.id === state.trackId), dataset: { track: track.id }, onclick: () => selectTrack(track.id) }, track.name, h('span', { class: 'sub' }, track.capo ? `${role} · ${t('toolbar.capo', { n: track.capo })}` : role)),
    );
  }
  els.picker = picker;
  const fingersToggle = h('input', { type: 'checkbox', checked: state.showFingers ? true : null, onchange: (e) => {
    state.showFingers = e.target.checked;
    storage.set('nagori:fingers', state.showFingers);
    els.tabView.classList.toggle('hide-fingers', !state.showFingers);
  } });
  const lyricsToggle = state.song.lyrics?.length
    ? h('input', { type: 'checkbox', checked: state.showLyrics ? true : null, onchange: (e) => {
      state.showLyrics = e.target.checked;
      storage.set('nagori:lyrics', state.showLyrics);
      const entry = state.tracks.get(state.trackId);
      if (entry && state.layout) renderTab(entry); // the row changes the systems' height and the bars' widths
    } })
    : null;
  return h(
    'div',
    { class: 'toolbar' },
    picker,
    h('span', { class: 'spacer' }),
    h('label', { class: 'toggle' }, fingersToggle, t('toolbar.fingers')),
    ...(lyricsToggle ? [h('label', { class: 'toggle' }, lyricsToggle, t('toolbar.lyrics'))] : []),
    h('a', { class: 'btn small', href: '#positions', onclick: (e) => {
      e.preventDefault(); // a bare fragment would resolve against <base> on songs/<id>.html
      document.getElementById('positions')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } }, t('toolbar.positions')),
  );
}

async function selectTrack(trackId) {
  state.trackId = trackId;
  updateUrl();
  for (const chip of els.picker.querySelectorAll('.chip')) chip.setAttribute('aria-pressed', String(chip.dataset.track === trackId));
  clear(els.tabView).append(h('p', { class: 'status' }, t('track.loading')));
  let entry;
  try {
    entry = await getTrack(trackId);
  } catch (err) {
    if (state.trackId === trackId) clear(els.tabView).append(h('p', { class: 'status error' }, t('track.loadError', { message: err.message })));
    return;
  }
  if (state.trackId !== trackId) return;
  renderTab(entry);
  renderPositions(entry);
  renderSidebarPositions(state.sectionIndex);
}

function tabWidth() {
  return Math.max(320, Math.floor(els.tabView.clientWidth || els.content.clientWidth || 800));
}

function renderTab(entry) {
  const width = tabWidth();
  state.layoutWidth = width;
  state.layout = layoutTrack(entry.track, width, { lyrics: state.showLyrics ? state.song.lyrics : null });
  state.barToSystem = [];
  state.systemEls = [];
  state.pos = { bar: -1, beat: -1, system: -1 };
  state.lyricIndex = -1;
  state.lyricEl = null;
  clear(els.tabView);
  els.tabView.classList.toggle('hide-fingers', !state.showFingers);
  const lastBar = entry.track.measures.length - 1;
  let prevRing = false;
  for (const system of state.layout) {
    const el = h('div', { class: 'tab-system', dataset: { system: system.index } });
    el.innerHTML = renderSystem(system, entry.track, { fingerFor: entry.analysis.fingerFor, showFingers: true, lastBar, prevRing, barLabel: (n) => t('sheet.bar', { n }) });
    els.tabView.append(el);
    state.systemEls.push(el);
    for (const m of system.measures) state.barToSystem[m.index] = system.index;
    const lastMeasure = entry.track.measures[system.lastBar];
    const lastBeat = [...lastMeasure.beats].reverse().find((b) => !b.rest);
    prevRing = lastBeat ? !!lastBeat.ring : prevRing;
  }
}

function cardTitle(card) {
  if (card.labels && card.labels.length > 1 && card.source !== 'library') {
    return `${formatChord(card.labels[0])} → ${formatChord(card.labels[card.labels.length - 1])}`;
  }
  if (card.chord) return formatChord(card.chord);
  return card.kind === 'melody' ? t('card.run', { n: card.shape.baseFret }) : t('card.shapeAt', { n: card.shape.baseFret });
}

function buildCard(card, compact) {
  const entry = state.tracks.get(state.trackId);
  const labels = entry && entry.track.tuning ? stringNames(entry.track.tuning) : null;
  const el = h(
    'div',
    { class: 'position-card', role: 'button', tabindex: '0', title: t('card.playFrom', { n: card.bars[0] }) },
    h('div', { class: 'name' }, cardTitle(card), card.shapeName && chordKey(card.shapeName) !== chordKey(card.chord || '') ? h('small', {}, t('card.shape', { name: formatChord(card.shapeName) })) : null),
    h('div', { html: diagramSVG(card.shape, { label: cardTitle(card), stringLabels: compact ? null : labels }) }),
    h('div', { class: 'fingers' }, fingerString(card.shape)),
    h('div', { class: 'bars' }, t('card.bars', { list: formatBarList(card.bars, 6, { separator: t('list.separator') }) })),
  );
  const go = () => {
    seekBar(card.bars[0] - 1);
    if (state.view === 'tab') {
      const systemIndex = state.barToSystem[card.bars[0] - 1];
      state.systemEls[systemIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };
  el.addEventListener('click', go);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      go();
    }
  });
  return el;
}

function renderPositions(entry) {
  const sections = positionsBySection(entry.analysis, state.song.sections, state.song.bars, entry.track.strings);
  state.positions = sections;
  state.cardBySegment = new Map();
  clear(els.positions);
  els.positions.append(
    h('h2', {}, t('positions.heading')),
    h('p', { class: 'lead' }, t('positions.lead', { name: entry.meta.name, role: roleName(entry.meta.role) })),
  );
  for (const section of sections) {
    if (!section.cards.length) continue;
    const grid = h('div', { class: 'position-grid' });
    for (const card of section.cards) {
      const el = buildCard(card, false);
      grid.append(el);
      for (const seg of card.segments) state.cardBySegment.set(seg.index, card);
    }
    els.positions.append(h('div', { class: 'position-section' }, h('h3', {}, sectionName(section.name), ' ', h('span', {}, t('positions.bars', { from: section.startBar + 1, to: section.endBar + 1 }))), grid));
  }
}

function renderSidebarPositions(sectionIndex) {
  if (!state.positions || state.view !== 'tab') {
    els.positionsPanel.style.display = 'none';
    return;
  }
  const section = state.positions[Math.max(0, sectionIndex)];
  if (!section) return;
  els.positionsPanel.style.display = '';
  els.positionsPanelTitle.textContent = t('positions.section', { name: sectionName(section.name) });
  clear(els.positionsPanelGrid);
  state.sidebarCards = new Map();
  for (const card of section.cards) {
    const el = buildCard(card, true);
    els.positionsPanelGrid.append(el);
    for (const seg of card.segments) state.sidebarCards.set(seg.index, el);
  }
}

function highlightSidebarCard(segment) {
  const el = segment ? state.sidebarCards.get(segment.index) : null;
  if (el === state.activeCardEl) return;
  state.activeCardEl?.classList.remove('is-active');
  el?.classList.add('is-active');
  state.activeCardEl = el || null;
  if (el && state.autoscroll) revealSidebarCard(el);
}

/** Scroll the sidebar's grid, and nothing else, until the lit card is inside it; the page's own scrolling follows the tab. */
function revealSidebarCard(el) {
  const grid = els.positionsPanelGrid;
  if (grid.scrollHeight <= grid.clientHeight) return;
  const g = grid.getBoundingClientRect();
  const c = el.getBoundingClientRect();
  const margin = 8;
  const fits = c.height <= g.height - 2 * margin;
  if (c.top < g.top + margin || (!fits && c.top !== g.top + margin)) grid.scrollBy({ top: c.top - g.top - margin, behavior: 'smooth' }); // a card taller than the box shows its top
  else if (fits && c.bottom > g.bottom - margin) grid.scrollBy({ top: c.bottom - g.bottom + margin, behavior: 'smooth' });
}

// --- Views --------------------------------------------------------------------

async function renderView() {
  clear(els.content);
  state.pos = { bar: -1, beat: -1, system: -1 };
  state.chordIndex = -1;
  for (const btn of document.querySelectorAll('#view-switch button')) btn.setAttribute('aria-pressed', String(btn.dataset.view === state.view));
  updateUrl();
  if (state.view === 'chords') {
    const container = h('div', { id: 'chords-view' });
    els.content.append(container);
    const guitar = state.song.tracks.find((tr) => tr.kind === 'guitar' && tr.tuning);
    const nonStandard = guitar && guitar.tuning.some((m, i) => m !== STANDARD_TUNING[i]);
    state.sheet = renderChordSheet(container, state.song, {
      stringLabels: nonStandard ? stringNames(guitar.tuning) : null,
      onChordSeek: (name, bar) => {
        if (bar !== null && bar !== undefined) return seekBar(bar);
        const idx = state.song.sections.findIndex((s) => s.name === name);
        if (idx >= 0) seekBar(state.song.sections[idx].bar);
      },
    });
    els.positionsPanel.style.display = 'none';
    return;
  }
  els.tabView = h('div', { class: 'tab-view', id: 'tab-view' });
  els.positions = h('section', { class: 'positions', id: 'positions' });
  els.content.append(renderToolbar(), els.tabView, els.positions);
  els.tabView.addEventListener('click', (e) => {
    const hit = e.target.closest('.measure-hit');
    if (hit) seekBar(Number(hit.dataset.bar));
  });
  els.tabView.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const hit = e.target.closest?.('.measure-hit');
    if (!hit) return;
    e.preventDefault();
    seekBar(Number(hit.dataset.bar));
  });
  await selectTrack(state.trackId);
}

function setView(view) {
  if (view === state.view) return;
  state.view = view;
  renderView();
}

// --- Boot ---------------------------------------------------------------------

/** The page's own set-up, everything after the song is loaded; anything it throws is shown in place of the page. */
async function render(app) {
  const song = state.song;
  if (!Array.isArray(song.sections)) song.sections = []; // both optional in the format; the page counts on lists
  if (!Array.isArray(song.chordTimeline)) song.chordTimeline = [];
  document.title = pageTitle(song.title, song.artist);
  if (!state.trackId || !song.tracks.some((tr) => tr.id === state.trackId)) state.trackId = song.defaultTrack || song.tracks[0].id;

  els.content = h('div', { class: 'content' });
  const sidebar = renderSidebar();
  clear(app).append(renderHead(song), h('div', { class: 'song-layout' }, sidebar, els.content)); // the player first in reading order; CSS puts it beside the content on wide screens

  const footer = document.getElementById('song-footer');
  const source = song.source || {}; // a song added from a folder may name no source
  const sourceText = source.label || (source.name ? t('footer.tab', { name: source.name }) : '');
  clear(footer).append(
    ...(sourceText
      ? [
          t('footer.transcription'),
          source.url ? h('a', { href: source.url, target: '_blank', rel: 'noopener' }, sourceText) : h('span', {}, sourceText),
          source.author && source.revisionId
            ? t('footer.byRevision', { author: source.author, id: source.revisionId })
            : source.author
              ? t('footer.by', { author: source.author })
              : source.revisionId
                ? t('footer.revision', { id: source.revisionId })
                : '',
          t('footer.period'),
        ]
      : BASE === 'local'
        ? [t('footer.local')]
        : []),
    ...(song.video ? [t('footer.video'), h('a', { href: `https://www.youtube.com/watch?v=${song.video.id}`, target: '_blank', rel: 'noopener' }, song.video.title || 'YouTube'), t('footer.period')] : []),
    t('footer.fingerings'),
    siteText('copyright') ? ` ${siteText('copyright')}` : '',
  );

  for (const btn of document.querySelectorAll('#view-switch button')) btn.addEventListener('click', () => setView(btn.dataset.view));

  document.addEventListener('keydown', (e) => {
    if (isEditing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ') {
      if (e.target.closest?.('button, a')) return; // space activates the focused control
      e.preventDefault();
      state.sync?.toggle();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const bar = Math.max(0, Math.min(song.bars - 1, Math.max(0, state.pos.bar) + (e.key === 'ArrowRight' ? 1 : -1)));
      seekBar(bar);
    }
  });

  window.addEventListener('resize', debounce(() => {
    if (state.view !== 'tab' || !state.trackId) return;
    const entry = state.tracks.get(state.trackId);
    if (entry && tabWidth() !== state.layoutWidth) renderTab(entry); // mobile browsers fire resize when their toolbar collapses
  }, 150));

  // Leaving the page stops the players; a page kept for back navigation only pauses them.
  window.addEventListener('pagehide', (e) => {
    if (e.persisted) {
      state.tab?.pause();
      state.video?.pause?.();
    } else {
      state.tab?.destroy();
      state.video?.destroy();
    }
  });

  await renderView();
}

async function main() {
  const [, songResult] = await Promise.allSettled([loadSite(), songId ? loadSongJSON(songId) : Promise.resolve(null)]);
  applyLang();
  applySite();
  setupThemeToggle();
  setupPrintTheme();
  setupLanguageToggle();
  registerOffline();
  const app = document.getElementById('app');
  try {
    if (!songId) {
      const songs = await loadJSON('data/songs.json');
      if (!songs.length) throw new Error(t('home.empty'));
      songId = songs[0].id;
      state.song = await loadSongJSON(songId);
    } else {
      if (songResult.status === 'rejected') throw songResult.reason;
      state.song = songResult.value;
    }
    DATA_BASE = `${SONG_ROOT}${songId}/`;
    await render(app);
  } catch (err) {
    clear(app).append(h('p', { class: 'status error' }, t('song.loadError', { id: songId, message: err.message })));
    return;
  }
  initPlayers().catch(showPlayerError);
}

main();
