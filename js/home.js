import { h, clear, loadJSON, storage, setupThemeToggle, foldText } from './util.js';
import { t, applyLang, setupLanguageToggle, keyName, tuningName, parens } from './i18n.js';
import { loadSite, applySite } from './site.js';
import { registerOffline } from './offline.js';
import { SORTS, DEFAULT_SORT, sortSongs, groupSongs, keyLabel } from './song-sort.js';

const SORT_KEY = 'nagori:sort';

/** The sort mode to start with: the URL's `sort`, else the remembered one, else the default. */
export function initialSort(search, remembered) {
  const param = new URLSearchParams(search).get('sort');
  if (SORTS.includes(param)) return param;
  return SORTS.includes(remembered) ? remembered : DEFAULT_SORT;
}

/** A private song (private/songs, never committed) opens through song.html with its root in the URL; a public one has its own page. */
function songHref(song, view) {
  return song.private ? `song.html?id=${encodeURIComponent(song.id)}&base=private&view=${view}` : `songs/${encodeURIComponent(song.id)}.html?view=${view}`;
}

/** A card; `heading` is h3 under the page's "Songs" heading, h4 under a group heading. */
function songCard(song, heading = 'h3') {
  const meta = [keyName(song.key), song.bpm ? `${song.bpm} ${t('meta.bpm')}` : null, tuningName(song.tuning), song.duration, song.tracks ? t('home.tracks', { n: song.tracks }) : null, song.private ? t('home.private') : null].filter(Boolean);
  return h(
    'article',
    { class: 'song-card' },
    h('div', {}, h(heading, { class: 'song-title' }, song.title), h('div', { class: 'artist' }, [song.artist, song.album ? `${song.album}${song.year ? parens(song.year) : ''}` : null].filter(Boolean).join(' · '))),
    h('div', { class: 'meta' }, meta.map((m) => h('span', { class: 'meta-chip' }, m))),
    h(
      'div',
      { class: 'actions' },
      h('a', { class: 'btn primary', href: songHref(song, 'tab') }, t('nav.tab')),
      h('a', { class: 'btn', href: songHref(song, 'chords') }, t('nav.chords')),
    ),
  );
}

/** Songs whose title, artist (as shown or as sorted), album or year contain every word of the query, accents ignored. */
export function matchSongs(songs, query) {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return songs;
  return songs.filter((song) => {
    const text = foldText([song.title, song.artist, song.artistSort, song.album, song.year].filter(Boolean).join(' '));
    return words.every((w) => text.includes(w));
  });
}

async function main() {
  await loadSite();
  applyLang();
  applySite();
  setupThemeToggle();
  setupLanguageToggle();
  registerOffline();
  const grid = document.getElementById('song-grid');
  const filter = document.getElementById('song-filter');
  const count = document.getElementById('song-count');
  const sortSelect = document.getElementById('song-sort');
  let mode = initialSort(location.search, storage.get(SORT_KEY));
  let songs = [];
  try {
    // A private collection beside the public one, when this copy has one (a local checkout or a private deployment); fetched alongside, so a missing one costs no time.
    const [pub, priv] = await Promise.allSettled([loadJSON('data/songs.json'), loadJSON('private/songs.json')]);
    if (pub.status === 'rejected') throw pub.reason;
    songs = priv.status === 'fulfilled' ? [...pub.value, ...priv.value.map((song) => ({ ...song, private: true }))] : pub.value;
  } catch (err) {
    clear(grid).append(h('p', { class: 'status error' }, t('home.loadError', { message: err.message })));
    return;
  }
  const render = (query = '') => {
    clear(grid);
    if (!songs.length) {
      grid.append(h('p', { class: 'empty-note' }, t('home.empty')));
      count.textContent = '';
      return;
    }
    const shown = matchSongs(songs, query);
    if (!shown.length) grid.append(h('p', { class: 'empty-note' }, t('home.noMatch')));
    const labelFor = (song, by) => (by === 'key' ? (song.key ? keyName(keyLabel(song.key)) : t('home.noKey')) : song.artist);
    for (const group of groupSongs(sortSongs(shown, mode), mode, labelFor)) {
      if (group.label) grid.append(h('h3', { class: 'song-group' }, group.label, h('span', { class: 'song-group-count' }, String(group.songs.length))));
      for (const song of group.songs) grid.append(songCard(song, group.label ? 'h4' : 'h3'));
    }
    count.textContent = query ? t('home.matchCount', { n: shown.length, total: songs.length }) : t('home.count', { n: songs.length });
  };
  // The filter and the sort are worth showing once the collection outgrows a glance.
  if (songs.length > 6) {
    filter.hidden = false;
    filter.placeholder = t('home.filter');
    filter.setAttribute('aria-label', t('home.filter'));
    filter.addEventListener('input', () => render(filter.value));
    for (const option of SORTS) sortSelect.append(h('option', { value: option }, t(`sort.${option}`)));
    sortSelect.value = mode;
    sortSelect.closest('.song-sort').hidden = false;
    sortSelect.addEventListener('change', () => {
      mode = SORTS.includes(sortSelect.value) ? sortSelect.value : DEFAULT_SORT;
      storage.set(SORT_KEY, mode);
      const url = new URL(location.href);
      if (mode === DEFAULT_SORT) url.searchParams.delete('sort');
      else url.searchParams.set('sort', mode);
      history.replaceState(null, '', url);
      render(filter.value);
    });
  }
  render();
}

if (typeof document !== 'undefined' && document.getElementById('song-grid')) main();
