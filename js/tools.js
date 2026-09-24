// Tools page: metronome, chord dictionary, fretboard note map, tuner. One shared AudioContext,
// created on the first click so browsers allow it.

import { h, clear, storage, setupThemeToggle, setupPrintTheme, formatChord, isEditing } from './util.js';
import { t, applyLang, setupLanguageToggle } from './i18n.js';
import { TUNINGS, SCALES, SHARP_NAMES, FLAT_NAMES, noteName, octaveOf, noteLabel, midiToFreq } from './theory.js';
import { fretboardSVG } from './fretboard.js';
import { Metronome, TapTempo } from './metronome.js';
import { detectPitch, nearestNote } from './pitch.js';
import { pluckBuffer, timbre, buildChain, roomNode, DEFAULT_SOUND, rememberRate } from './tab-audio.js';
import { loadSite, applySite, pageTitle } from './site.js';
import { QUALITIES, dictionaryEntry, voicingMidi, parseChordName } from './chord-library.js';
import { voicingSVG } from './chord-diagram.js';
import { registerOffline } from './offline.js';

let audio = null;

function getContext() {
  if (!audio) {
    const Context = window.AudioContext || window.webkitAudioContext;
    audio = new Context({ latencyHint: 'interactive' });
    rememberRate(audio.sampleRate);
  }
  if (audio.state === 'suspended') {
    const resumed = audio.resume();
    if (resumed && resumed.catch) resumed.catch(() => {});
  }
  return audio;
}

const PLUCK_CAP = 64; // buffers kept for the dictionary, fretboard and tuner; the oldest go when a visitor plays more
const pluckBuffers = new Map();
const chains = new Map(); // one output chain (body filters, room send) per instrument kind
let room = null;

/** The output chain the tools play through: the acoustic sound's body and room for a guitar, the bass's own for a bass. */
function chainFor(ctx, kind) {
  let chain = chains.get(kind);
  if (!chain) {
    if (!room) {
      room = roomNode(ctx);
      room.connect(ctx.destination);
    }
    chain = buildChain(ctx, { kind, sound: DEFAULT_SOUND, dry: ctx.destination, wet: room });
    chains.set(kind, chain);
  }
  return chain;
}

/** Play one plucked note with the site's string synthesis, now or at an AudioContext time. */
function pluck(midi, kind = 'guitar', level = 0.6, when = 0) {
  const ctx = getContext();
  const key = `${kind}:${midi}`;
  let buffer = pluckBuffers.get(key);
  if (!buffer) {
    const freq = midiToFreq(midi);
    const samples = pluckBuffer(freq, ctx.sampleRate, { ...timbre(kind, freq), seed: midi * 31 });
    buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.copyToChannel(samples, 0);
    pluckBuffers.set(key, buffer);
    if (pluckBuffers.size > PLUCK_CAP) pluckBuffers.delete(pluckBuffers.keys().next().value);
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = level;
  source.connect(gain);
  gain.connect(chainFor(ctx, kind).input);
  source.start(when);
  return source;
}

function field(label, control) {
  return h('label', { class: 'field' }, label, control);
}

// --- Metronome ----------------------------------------------------------------

function metronomeTool() {
  const saved = storage.get('nagori:metronome', {});
  const metro = new Metronome({ createContext: getContext });
  metro.setBpm(saved.bpm || 100);
  metro.setBeats(saved.beats || 4);
  metro.setSubdivision(saved.subdivision || 1);
  metro.setAccent(saved.accent ?? true);
  const taps = new TapTempo();
  const save = () => storage.set('nagori:metronome', { bpm: metro.bpm, beats: metro.beats, subdivision: metro.subdivision, accent: metro.accent });

  const bpmValue = h('div', { class: 'metro-bpm' }, String(metro.bpm), h('small', {}, t('meta.bpm')));
  const slider = h('input', { class: 'range', type: 'range', min: 20, max: 300, value: metro.bpm, 'aria-label': t('metro.tempo') });
  const setBpm = (value) => {
    metro.setBpm(value);
    bpmValue.firstChild.textContent = String(metro.bpm);
    slider.value = metro.bpm;
    save();
  };
  slider.addEventListener('input', () => setBpm(Number(slider.value)));

  const dots = h('div', { class: 'beat-dots', 'aria-hidden': 'true' });
  const renderDots = () => {
    clear(dots);
    for (let i = 0; i < metro.beats; i++) dots.append(h('span', { class: i === 0 && metro.accent ? 'accent' : null }));
  };
  renderDots();

  const startBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => metro.toggle() }, t('metro.start'));
  const tapBtn = h('button', { class: 'btn', type: 'button', onclick: () => {
    const bpm = taps.tap();
    if (bpm) setBpm(bpm);
  } }, t('metro.tap'));
  const beatsSelect = h(
    'select',
    { class: 'select', 'aria-label': t('metro.beats'), onchange: (e) => {
      metro.setBeats(Number(e.target.value));
      renderDots();
      save();
    } },
    ...[1, 2, 3, 4, 5, 6, 7].map((n) => h('option', { value: n, selected: n === metro.beats }, String(n))),
  );
  const subSelect = h(
    'select',
    { class: 'select', 'aria-label': t('metro.subdivision'), onchange: (e) => {
      metro.setSubdivision(Number(e.target.value));
      save();
    } },
    ...[1, 2, 3, 4].map((n) => h('option', { value: n, selected: n === metro.subdivision }, t(`metro.sub.${n}`))),
  );
  const accent = h('input', { type: 'checkbox', checked: metro.accent ? true : null, onchange: (e) => {
    metro.setAccent(e.target.checked);
    renderDots();
    save();
  } });

  metro.addEventListener('tick', (e) => {
    if (e.detail.sub !== 0) return;
    for (const [i, dot] of [...dots.children].entries()) dot.classList.toggle('is-on', i === e.detail.beat);
  });
  metro.addEventListener('state', (e) => {
    startBtn.textContent = e.detail.running ? t('metro.stop') : t('metro.start');
    if (!e.detail.running) for (const dot of dots.children) dot.classList.remove('is-on');
  });

  const el = h(
    'section',
    { class: 'tool tool-metronome', id: 'metronome', 'aria-labelledby': 'metro-title' },
    h('h2', { id: 'metro-title' }, t('metro.title')),
    h('p', { class: 'lead' }, t('metro.lead')),
    h(
      'div',
      { class: 'metro-tempo' },
      h('button', { class: 'btn small', type: 'button', 'aria-label': t('metro.slower'), onclick: () => setBpm(metro.bpm - 1) }, '−'),
      bpmValue,
      h('button', { class: 'btn small', type: 'button', 'aria-label': t('metro.faster'), onclick: () => setBpm(metro.bpm + 1) }, '+'),
      h('span', { class: 'spacer' }),
      startBtn,
    ),
    slider,
    dots,
    h('div', { class: 'tool-row' }, tapBtn, field(t('metro.beats'), beatsSelect), field(t('metro.subdivision'), subSelect), h('label', { class: 'toggle' }, accent, t('metro.accent'))),
  );
  return { el, metro };
}

// --- Chord dictionary -----------------------------------------------------------

/** `preset`: a chord named in the URL (a chord card on a song page links here), over the remembered choice. */
function chordsTool(preset = {}) {
  const saved = { ...storage.get('nagori:chords', {}), ...preset };
  const state = {
    root: Number.isInteger(saved.root) && saved.root >= 0 && saved.root < 12 ? saved.root : 0,
    suffix: QUALITIES.some((q) => q.suffix === saved.suffix) ? saved.suffix : '',
    flats: !!saved.flats,
  };
  const save = () => storage.set('nagori:chords', state);
  const rootChips = h('div', { class: 'chip-row root-chips', role: 'group', 'aria-label': t('fret.root') });
  const qualityChips = h('div', { class: 'chip-row root-chips', role: 'group', 'aria-label': t('dict.quality') });
  const sharps = h('button', { type: 'button', onclick: () => update({ flats: false }) }, t('fret.sharps'));
  const flats = h('button', { type: 'button', onclick: () => update({ flats: true }) }, t('fret.flats'));
  const grid = h('div', { class: 'chord-grid' });

  /** Strum a voicing low string to high, a little apart, like a downstroke. */
  const strum = (frets) => {
    const start = getContext().currentTime + 0.02;
    voicingMidi(frets).forEach((midi, i) => pluck(midi, 'guitar', 0.5, start + i * 0.045));
  };

  function render() {
    sharps.setAttribute('aria-pressed', String(!state.flats));
    flats.setAttribute('aria-pressed', String(state.flats));
    clear(rootChips);
    (state.flats ? FLAT_NAMES : SHARP_NAMES).forEach((name, pc) => {
      rootChips.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.root === pc), onclick: () => update({ root: pc }) }, name));
    });
    clear(qualityChips);
    for (const quality of QUALITIES) {
      qualityChips.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.suffix === quality.suffix), onclick: () => update({ suffix: quality.suffix }) }, t(quality.label)));
    }
    const entry = dictionaryEntry(state.root, state.suffix, { flats: state.flats });
    const label = formatChord(entry.name);
    clear(grid);
    if (!entry.voicings.length) {
      grid.append(h('p', { class: 'empty-note' }, t('dict.none')));
      return;
    }
    for (const voicing of entry.voicings) {
      grid.append(
        h(
          'button',
          { class: 'chord-card playable', type: 'button', 'aria-label': t('dict.play', { name: label }), title: t('dict.play', { name: label }), onclick: () => strum(voicing.frets) },
          h('div', { class: 'name' }, label),
          h('div', { html: voicingSVG(voicing, 6, label) }),
          h('div', { class: 'frets' }, voicing.frets),
        ),
      );
    }
  }

  function update(changes) {
    Object.assign(state, changes);
    save();
    render();
  }

  const el = h(
    'section',
    { class: 'tool tool-chords wide', id: 'chords', 'aria-labelledby': 'chords-title' },
    h('h2', { id: 'chords-title' }, t('dict.title')),
    h('p', { class: 'lead' }, t('dict.lead')),
    h('div', { class: 'tool-row' }, h('span', { class: 'field' }, t('fret.root')), rootChips, h('div', { class: 'segmented small', role: 'group', 'aria-label': t('fret.names') }, sharps, flats)),
    h('div', { class: 'tool-row' }, h('span', { class: 'field' }, t('dict.quality')), qualityChips),
    grid,
  );
  render();
  return { el };
}

// --- Fretboard ----------------------------------------------------------------

/** `preset` comes from the URL (a song's key chip links here): tuning id, root pitch class, scale id, flats. */
function fretboardTool(preset = {}) {
  const saved = { ...storage.get('nagori:fretboard', {}), ...preset };
  const state = {
    tuning: TUNINGS.find((x) => x.id === saved.tuning) || TUNINGS[0],
    flats: !!saved.flats,
    root: Number.isInteger(saved.root) && saved.root >= 0 && saved.root < 12 ? saved.root : null,
    scale: SCALES[saved.scale] ? saved.scale : null,
  };
  const save = () => storage.set('nagori:fretboard', { tuning: state.tuning.id, flats: state.flats, root: state.root, scale: state.scale });

  const board = h('div', { class: 'fretboard' });
  board.addEventListener('click', (e) => {
    const note = e.target.closest('[data-midi]');
    if (note) pluck(Number(note.dataset.midi), state.tuning.kind);
  });
  board.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const note = e.target.closest?.('[data-midi]');
    if (!note) return;
    e.preventDefault();
    pluck(Number(note.dataset.midi), state.tuning.kind);
  });
  const rootChips = h('div', { class: 'chip-row root-chips', role: 'group', 'aria-label': t('fret.root') });
  const sharps = h('button', { type: 'button', onclick: () => update({ flats: false }) }, t('fret.sharps'));
  const flats = h('button', { type: 'button', onclick: () => update({ flats: true }) }, t('fret.flats'));
  const tuningSelect = h(
    'select',
    { class: 'select', 'aria-label': t('fret.tuning'), onchange: (e) => update({ tuning: TUNINGS.find((x) => x.id === e.target.value) }) },
    ...TUNINGS.map((tuning) => h('option', { value: tuning.id, selected: tuning.id === state.tuning.id }, t(tuning.name))),
  );
  const scaleSelect = h(
    'select',
    { class: 'select', 'aria-label': t('fret.scale'), onchange: (e) => update({ scale: e.target.value || null }) },
    h('option', { value: '' }, t('fret.scale.none')),
    ...Object.keys(SCALES).map((id) => h('option', { value: id, selected: id === state.scale }, t(`fret.scale.${id}`))),
  );

  function render() {
    const label = [t(state.tuning.name), state.root !== null ? (state.flats ? FLAT_NAMES : SHARP_NAMES)[state.root] : null, state.scale ? t(`fret.scale.${state.scale}`) : null].filter(Boolean).join(' · ');
    board.innerHTML = fretboardSVG({ tuning: state.tuning.midi, frets: 15, flats: state.flats, root: state.root, scale: state.scale, label });
    sharps.setAttribute('aria-pressed', String(!state.flats));
    flats.setAttribute('aria-pressed', String(state.flats));
    clear(rootChips);
    rootChips.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.root === null), onclick: () => update({ root: null }) }, t('fret.rootNone')));
    (state.flats ? FLAT_NAMES : SHARP_NAMES).forEach((name, pc) => {
      rootChips.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.root === pc), onclick: () => update({ root: pc }) }, name));
    });
  }

  function update(changes) {
    Object.assign(state, changes);
    save();
    render();
  }

  const el = h(
    'section',
    { class: 'tool tool-fretboard wide', id: 'fretboard', 'aria-labelledby': 'fret-title' },
    h('h2', { id: 'fret-title' }, t('fret.title')),
    h('p', { class: 'lead' }, t('fret.lead')),
    h('div', { class: 'tool-row' }, field(t('fret.tuning'), tuningSelect), field(t('fret.scale'), scaleSelect), h('div', { class: 'segmented small', role: 'group', 'aria-label': t('fret.names') }, sharps, flats)),
    h('div', { class: 'tool-row' }, h('span', { class: 'field' }, t('fret.root')), rootChips),
    board,
  );
  render();
  return { el };
}

// --- Tuner --------------------------------------------------------------------

function tunerTool() {
  const saved = storage.get('nagori:tuner', {});
  const state = { tuning: TUNINGS.find((x) => x.id === saved.tuning) || TUNINGS[0], playing: null, stream: null, timer: 0 };
  let refTimer = 0;
  let refSource = null;

  const noteEl = h('div', { class: 'tuner-note' }, '—');
  const needle = h('span', { class: 'needle' });
  const scaleEl = h('div', { class: 'tuner-scale', 'aria-hidden': 'true' }, h('span', { class: 'center' }), needle);
  const statusEl = h('div', { class: 'tuner-status' }, t('tuner.idle'));
  const liveEl = h('div', { class: 'sr-only', 'aria-live': 'polite' }); // announced only when the verdict changes, not every frame
  let lastLive = '';
  const announce = (text) => {
    if (text === lastLive) return;
    lastLive = text;
    liveEl.textContent = text;
  };
  const strings = h('div', { class: 'chip-row string-chips', role: 'group', 'aria-label': t('tuner.reference') });
  const micBtn = h('button', { class: 'btn primary', type: 'button' }, t('tuner.mic'));

  const stopReference = () => {
    clearInterval(refTimer);
    refTimer = 0;
    try {
      refSource?.stop();
    } catch {
      /* not started */
    }
    refSource = null;
    state.playing = null;
    for (const chip of strings.children) chip.setAttribute('aria-pressed', 'false');
  };

  const renderStrings = () => {
    clear(strings);
    const count = state.tuning.midi.length;
    [...state.tuning.midi].reverse().forEach((midi, i) => {
      const number = count - i; // lowest string first, numbered like the tab (1 is the highest)
      const chip = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', title: t('tuner.string', { n: number }) }, `${number} · ${noteLabel(midi)}`);
      chip.addEventListener('click', () => {
        const again = state.playing === midi;
        stopReference();
        if (again) return;
        if (state.stream) stopMic(); // the tuner would otherwise listen to its own reference string
        state.playing = midi;
        chip.setAttribute('aria-pressed', 'true');
        const play = () => {
          try {
            refSource?.stop();
          } catch {
            /* not started */
          }
          refSource = pluck(midi, state.tuning.kind, 0.7);
        };
        play();
        refTimer = setInterval(play, 2200);
      });
      strings.append(chip);
    });
  };

  const tuningSelect = h(
    'select',
    { class: 'select', 'aria-label': t('fret.tuning'), onchange: (e) => {
      state.tuning = TUNINGS.find((x) => x.id === e.target.value);
      storage.set('nagori:tuner', { tuning: state.tuning.id });
      stopReference();
      renderStrings();
    } },
    ...TUNINGS.map((tuning) => h('option', { value: tuning.id, selected: tuning.id === state.tuning.id }, t(tuning.name))),
  );

  const idle = () => {
    statusEl.textContent = state.stream ? t('tuner.listening') : t('tuner.idle');
    announce(statusEl.textContent);
    statusEl.className = 'tuner-status';
    scaleEl.classList.remove('ok');
  };

  const showPitch = (freq) => {
    const { midi, cents } = nearestNote(freq);
    const stringIndex = state.tuning.midi.indexOf(midi);
    clear(noteEl).append(noteName(midi), h('small', {}, String(octaveOf(midi))), stringIndex >= 0 ? h('small', { class: 'which' }, ` · ${t('tuner.nearest', { n: stringIndex + 1 })}`) : null);
    needle.style.left = `${50 + cents}%`;
    const ok = Math.abs(cents) <= 5;
    scaleEl.classList.toggle('ok', ok);
    const rounded = Math.round(cents);
    const verdict = ok ? t('tuner.inTune') : cents < 0 ? t('tuner.low') : t('tuner.high');
    announce(`${noteName(midi)}${octaveOf(midi)} ${verdict}`);
    statusEl.textContent = `${verdict} · ${t('tuner.cents', { n: `${rounded > 0 ? '+' : ''}${rounded}` })}`;
    statusEl.className = `tuner-status${ok ? ' ok' : ''}`;
  };

  const stopMic = () => {
    clearInterval(state.timer);
    state.timer = 0;
    state.stream?.getTracks().forEach((track) => track.stop());
    state.stream = null;
    for (const node of state.nodes || []) node.disconnect();
    state.nodes = null;
    micBtn.textContent = t('tuner.mic');
    idle();
  };

  const startMic = async () => {
    stopReference();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ctx = getContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      state.stream = stream;
      state.nodes = [source, analyser];
      const frame = new Float32Array(analyser.fftSize);
      let hold = 0;
      state.timer = setInterval(() => {
        analyser.getFloatTimeDomainData(frame);
        const fmin = midiToFreq(Math.min(...state.tuning.midi)) * 0.9; // a little under the lowest string: shorter lags to search, and a bass E1 (41 Hz) still found
        const pitch = detectPitch(frame, ctx.sampleRate, { fmin });
        if (pitch) {
          showPitch(pitch.freq);
          hold = 8;
        } else if (hold > 0) hold -= 1;
        else idle();
      }, 70);
      micBtn.textContent = t('tuner.stop');
      idle();
    } catch (err) {
      statusEl.textContent = t('tuner.micError', { message: err.message });
      statusEl.className = 'tuner-status';
    }
  };
  micBtn.addEventListener('click', () => (state.stream ? stopMic() : startMic()));
  window.addEventListener('pagehide', () => {
    stopMic();
    stopReference();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.stream) stopMic(); // nothing to show while hidden; the reference string keeps sounding
  });

  const el = h(
    'section',
    { class: 'tool tool-tuner', id: 'tuner', 'aria-labelledby': 'tuner-title' },
    h('h2', { id: 'tuner-title' }, t('tuner.title')),
    h('p', { class: 'lead' }, t('tuner.lead')),
    h('div', { class: 'tool-row' }, field(t('fret.tuning'), tuningSelect), h('span', { class: 'spacer' }), micBtn),
    h('div', { class: 'tuner-display' }, noteEl, scaleEl, statusEl, liveEl),
    h('h3', {}, t('tuner.reference')),
    strings,
  );
  renderStrings();
  return { el };
}

// --- Boot ---------------------------------------------------------------------

async function main() {
  await loadSite();
  applyLang();
  applySite();
  document.title = pageTitle(t('tools.title'));
  setupThemeToggle();
  setupPrintTheme();
  setupLanguageToggle();
  const params = new URLSearchParams(location.search);
  const preset = {};
  if (params.has('tuning')) preset.tuning = params.get('tuning');
  if (params.has('root')) preset.root = params.get('root') === 'none' ? null : Number(params.get('root'));
  if (params.has('scale')) preset.scale = params.get('scale') === 'none' ? null : params.get('scale');
  if (params.has('names')) preset.flats = params.get('names') === 'flats';
  const chord = parseChordName(params.get('chord'));
  const chordPreset = chord ? { root: chord.root, flats: chord.flats, ...(QUALITIES.some((q) => q.suffix === chord.suffix) ? { suffix: chord.suffix } : {}) } : {};
  const root = document.getElementById('tools');
  const metronome = metronomeTool();
  clear(root).append(metronome.el, tunerTool().el, chordsTool(chordPreset).el, fretboardTool(preset).el);
  // The tools render after the page loaded, so the browser's own jump to #metronome etc. found nothing yet.
  const target = location.hash.length > 1 ? document.getElementById(location.hash.slice(1)) : null;
  if (target) target.scrollIntoView({ block: 'start' });
  registerOffline();
  document.addEventListener('keydown', (e) => {
    if (e.key !== ' ' || isEditing(e.target) || e.target.closest?.('button, a') || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    metronome.metro.toggle();
  });
}

main();
