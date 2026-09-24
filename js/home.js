import { h, clear, loadJSON, storage, setupThemeToggle, foldText } from './util.js';
import { t, applyLang, setupLanguageToggle, keyName, tuningName, parens } from './i18n.js';
import { loadSite, applySite } from './site.js';
import { registerOffline } from './offline.js';
import { SORTS, DEFAULT_SORT, sortSongs, groupSongs, keyLabel } from './song-sort.js';
import { openStore, memoryStore, pickFolderEntries, entriesFromDataTransfer, readSongFolders, planImport } from './local-songs.js';

const SORT_KEY = 'nagori:sort';

/** The sort mode to start with: the URL's `sort`, else the remembered one, else the default. */
export function initialSort(search, remembered) {
  const param = new URLSearchParams(search).get('sort');
  if (SORTS.includes(param)) return param;
  return SORTS.includes(remembered) ? remembered : DEFAULT_SORT;
}

/** A private song (private/songs, never committed) or one of the visitor's own (this browser's store) opens through song.html with its root in the URL; a public one has its own page. */
function songHref(song, view) {
  if (song.local) return `song.html?id=${encodeURIComponent(song.id)}&base=local&view=${view}`;
  return song.private ? `song.html?id=${encodeURIComponent(song.id)}&base=private&view=${view}` : `songs/${encodeURIComponent(song.id)}.html?view=${view}`;
}

/** A card; `heading` is h3 under the page's "Songs" heading, h4 under a group heading; `onRemove` gives a visitor's own song its Remove button. */
function songCard(song, heading = 'h3', onRemove = null) {
  const meta = [keyName(song.key), song.bpm ? `${song.bpm} ${t('meta.bpm')}` : null, tuningName(song.tuning), song.duration, song.tracks ? t('home.tracks', { n: song.tracks }) : null, song.private ? t('home.private') : null, song.local ? t('home.yours') : null].filter(Boolean);
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
      song.local && onRemove ? h('button', { class: 'btn small remove', type: 'button', onclick: () => onRemove(song) }, t('local.remove')) : null,
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
  let collection = [];
  let local = []; // the visitor's own songs, from this browser's store
  try {
    // A private collection beside the public one, when this copy has one (a local checkout or a private deployment); fetched alongside, so a missing one costs no time.
    const [pub, priv] = await Promise.allSettled([loadJSON('data/songs.json'), loadJSON('private/songs.json')]);
    if (pub.status === 'rejected') throw pub.reason;
    collection = priv.status === 'fulfilled' ? [...pub.value, ...priv.value.map((song) => ({ ...song, private: true }))] : pub.value;
  } catch (err) {
    clear(grid).append(h('p', { class: 'status error' }, t('home.loadError', { message: err.message })));
    return;
  }
  const songs = () => [...collection, ...local];
  let controls = false;
  const render = (query = '') => {
    const all = songs();
    clear(grid);
    if (!all.length) {
      grid.append(h('p', { class: 'empty-note' }, t('home.empty')));
      count.textContent = '';
      return;
    }
    const shown = matchSongs(all, query);
    if (!shown.length) grid.append(h('p', { class: 'empty-note' }, t('home.noMatch')));
    const labelFor = (song, by) => (by === 'key' ? (song.key ? keyName(keyLabel(song.key)) : t('home.noKey')) : song.artist);
    for (const group of groupSongs(sortSongs(shown, mode), mode, labelFor)) {
      if (group.label) grid.append(h('h3', { class: 'song-group' }, group.label, h('span', { class: 'song-group-count' }, String(group.songs.length))));
      for (const song of group.songs) grid.append(songCard(song, group.label ? 'h4' : 'h3', removeLocal));
    }
    count.textContent = query ? t('home.matchCount', { n: shown.length, total: all.length }) : t('home.count', { n: all.length });
  };
  // The filter and the sort are worth showing once the collection outgrows a glance.
  const showControls = () => {
    if (controls || songs().length <= 6) return;
    controls = true;
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
  };

  // --- The visitor's own songs: folders read in the browser, kept in IndexedDB, never uploaded ---
  const panel = document.getElementById('local-songs');
  const status = document.getElementById('local-status');
  const store = (await openStore()) || memoryStore();
  const say = (lines, error = false) => {
    clear(status).append(...lines.flatMap((line, i) => (i ? [h('br'), line] : [line])));
    status.classList.toggle('error', error);
  };
  const refreshLocal = async () => {
    const records = await store.list();
    local = records.map((record) => ({ ...record.row, local: true }));
  };
  async function removeLocal(song) {
    await store.remove(song.id);
    await refreshLocal();
    render(filter.value);
    say([t('local.removed', { title: song.title })]);
  }
  // Adding a folder again is a sync: unchanged songs are left alone, changed ones updated keeping their date, and songs the folder no longer holds can be removed.
  const importEntries = async (entries) => {
    if (!entries) return;
    say([t('local.reading')]);
    const { songs: found, problems } = await readSongFolders(entries);
    const plan = await planImport(found, await store.list());
    for (const record of plan.records) await store.put(record);
    await refreshLocal();
    showControls();
    render(filter.value);
    const lines = [];
    if (plan.added.length) lines.push(t('local.added', { n: plan.added.length }));
    if (plan.updated.length) lines.push(t('local.updated', { n: plan.updated.length }));
    if (plan.unchanged.length) lines.push(t('local.unchanged', { n: plan.unchanged.length }));
    for (const item of plan.replaced) lines.push(t('local.replaced', { title: item.title, folder: item.from }));
    if (!found.length && !problems.length) lines.push(t('local.none'));
    for (const dup of plan.duplicates) lines.push(t('local.problem', { folder: dup.folder, message: t('local.duplicate', { id: dup.id }) }));
    for (const problem of problems) lines.push(t('local.problem', { folder: problem.folder, message: t(problem.key, problem.params) }));
    if (plan.leftovers.length) {
      const titles = local.filter((song) => plan.leftovers.includes(song.id)).map((song) => song.title);
      lines.push(h('span', {}, t('local.leftovers', { n: plan.leftovers.length, titles: titles.join(', ') }), ' ', h('button', { class: 'btn small', type: 'button', onclick: async () => {
        for (const id of plan.leftovers) await store.remove(id);
        await refreshLocal();
        render(filter.value);
        say([t('local.leftoversRemoved', { n: plan.leftovers.length })]);
      } }, t('local.removeLeftovers'))));
    }
    say(lines, !found.length);
  };
  if (panel) {
    panel.hidden = false;
    document.getElementById('local-add').addEventListener('click', async () => {
      try {
        await importEntries(await pickFolderEntries());
      } catch (err) {
        say([t('local.failed', { message: err.message })], true);
      }
    });
    for (const type of ['dragenter', 'dragover']) {
      panel.addEventListener(type, (e) => {
        e.preventDefault();
        panel.classList.add('is-drop');
      });
    }
    panel.addEventListener('dragleave', (e) => {
      if (!panel.contains(e.relatedTarget)) panel.classList.remove('is-drop');
    });
    panel.addEventListener('drop', async (e) => {
      e.preventDefault();
      panel.classList.remove('is-drop');
      try {
        await importEntries(await entriesFromDataTransfer(e.dataTransfer));
      } catch (err) {
        say([t('local.failed', { message: err.message })], true);
      }
    });
  }
  await refreshLocal();
  showControls();
  render();
}

if (typeof document !== 'undefined' && document.getElementById('song-grid')) main();
