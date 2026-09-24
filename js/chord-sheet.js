// Chords view: chord diagrams strip plus the chord-over-lyrics sheet.

import { h, clear, formatChord, chordKey } from './util.js';
import { voicingSVG } from './chord-diagram.js';
import { t, sectionName, tuningName } from './i18n.js';
import { libraryFor } from './chord-library.js';

function sectionBars(song, name) {
  const idx = song.sections.findIndex((s) => s.name === name);
  if (idx < 0) return null;
  const start = song.sections[idx].bar + 1;
  const end = idx + 1 < song.sections.length ? song.sections[idx + 1].bar : song.bars;
  return start === end ? t('sheet.bar', { n: start }) : t('sheet.bars', { from: start, to: end });
}

export function renderChordSheet(container, song, { onChordSeek, stringLabels } = {}) {
  clear(container);
  const sheet = song.chordSheet;
  const library = libraryFor(song); // the song's voicings first, then the built-in ones
  const strings = song.tracks?.find((tr) => tr.kind === 'guitar')?.strings || 6;
  if (!sheet) {
    container.append(h('p', { class: 'status' }, t('sheet.none')));
    return {
      sectionElements: [],
      setActive() {
        return { sectionEl: null };
      },
    };
  }

  // Chords in order of first appearance.
  const order = [];
  const seen = new Set();
  for (const section of sheet.sections) {
    for (const line of section.lines) {
      const chordsInLine = line.type === 'bars' ? line.bars.flatMap((b) => b.chords.map((chord) => ({ chord }))) : line.segments;
      for (const seg of chordsInLine) {
        if (!seg.chord) continue;
        const key = chordKey(seg.chord);
        if (!seen.has(key)) {
          seen.add(key);
          order.push(seg.chord);
        }
      }
    }
  }

  const strip = h(
    'section',
    { class: 'chords-strip', 'aria-label': t('sheet.shapes') },
    h('h2', {}, t('sheet.chords')),
    h('p', { class: 'lead' }, t('sheet.lead', { n: order.length, tuning: tuningName(song.tuning), capo: song.capo ? t('sheet.capo', { n: song.capo }) : t('sheet.noCapo') })),
  );
  const grid = h('div', { class: 'chord-grid' });
  const cards = new Map();
  for (const name of order) {
    const key = chordKey(name);
    const entry = library[key];
    const voicing = Array.isArray(entry) ? entry[0] : entry;
    const card = h(
      'div',
      { class: 'chord-card', dataset: { chord: key } },
      h('div', { class: 'name' }, h('a', { href: `tools.html?chord=${encodeURIComponent(key)}#chords`, title: t('sheet.dictionary') }, formatChord(name))),
      voicing ? h('div', { html: voicingSVG(voicing, strings, formatChord(name), stringLabels) }) : h('div', { class: 'frets' }, t('sheet.noDiagram')),
      voicing ? h('div', { class: 'frets' }, voicing.frets) : null,
    );
    cards.set(key, card);
    grid.append(card);
  }
  strip.append(grid);
  container.append(strip);

  const sheetEl = h('section', { class: 'sheet', 'aria-label': t('sheet.title') }, h('h2', {}, t('sheet.title')));
  const sectionEls = [];
  sheet.sections.forEach((section, i) => {
    const bars = section.name ? sectionBars(song, section.name) : null;
    const label = [section.name ? sectionName(section.name) : t('sheet.part', { n: i + 1 }), bars ? h('span', {}, bars) : null];
    // The heading keeps its place in the outline; when the section can be played from, a button inside it does the seeking.
    const el = h(
      'div',
      { class: 'sheet-section', dataset: { section: i, name: section.name || '' } },
      h('h3', {}, bars && onChordSeek ? h('button', { class: 'sheet-jump', type: 'button', title: t('sheet.playFrom'), onclick: () => onChordSeek(section.name, null) }, ...label) : label.flatMap((part, k) => (k && part ? [' ', part] : [part]))),
    );
    for (const line of section.lines) {
      if (line.type === 'bars') {
        const row = h('div', { class: 'bar-grid' });
        let previous = null;
        for (const bar of line.bars) {
          const cell = h(onChordSeek ? 'button' : 'div', { class: 'bar', type: onChordSeek ? 'button' : null, title: onChordSeek ? t('sheet.playFrom') : null, dataset: { bar: bar.bar } }, h('span', { class: 'n' }, String(bar.bar + 1)));
          if (!bar.chords.length) cell.append(h('span', { class: 'rep' }, '·'));
          for (const chord of bar.chords) {
            if (chord === previous && bar.chords.length === 1) cell.append(h('span', { class: 'rep', title: chord }, '％'));
            else cell.append(h('span', { class: 'c', dataset: { chord: chordKey(chord) } }, formatChord(chord)));
            previous = chord;
          }
          if (onChordSeek) {
            cell.style.cursor = 'pointer';
            cell.addEventListener('click', () => onChordSeek(null, bar.bar));
          }
          row.append(cell);
        }
        el.append(row);
        continue;
      }
      const hasChords = line.segments.some((s) => s.chord);
      const chordsOnly = hasChords && line.segments.every((s) => !s.text.trim());
      const lineEl = h('div', { class: `sheet-line${chordsOnly ? ' chords-only' : ''}${hasChords ? '' : ' no-chords'}` });
      for (const seg of line.segments) {
        lineEl.append(
          h(
            'span',
            { class: 'sheet-seg' },
            h('span', { class: 'c', dataset: { chord: seg.chord ? chordKey(seg.chord) : '' } }, seg.chord ? formatChord(seg.chord) : ''),
            h('span', { class: 't' }, seg.text),
          ),
        );
      }
      el.append(lineEl);
    }
    sectionEls.push(el);
    sheetEl.append(el);
  });
  container.append(sheetEl);

  let activeSection = null;
  let activeChord = null;
  return {
    sectionElements: sectionEls,
    /** Highlight the section by tab marker name and the chord currently sounding. */
    setActive(sectionName, chordName) {
      const key = chordName ? chordKey(chordName) : null;
      // A sheet with one section follows the playhead even when the song names no sections.
      const el = sectionEls.find((s) => s.dataset.name === sectionName) || (sectionEls.length === 1 ? sectionEls[0] : null);
      const sectionChanged = el !== activeSection;
      if (sectionChanged) {
        activeSection?.classList.remove('is-active');
        el?.classList.add('is-active');
        activeSection = el;
      }
      if (key === activeChord && !sectionChanged) return { sectionEl: el }; // the same chord in a new section moves the highlight there
      for (const c of sheetEl.querySelectorAll('.c.is-now')) c.classList.remove('is-now');
      for (const c of cards.values()) c.classList.remove('is-active');
      activeChord = key;
      if (key) {
        const scope = el || sheetEl;
        for (const c of scope.querySelectorAll(`.c[data-chord="${CSS.escape(key)}"]`)) c.classList.add('is-now');
        cards.get(key)?.classList.add('is-active');
      }
      return { sectionEl: el };
    },
  };
}
