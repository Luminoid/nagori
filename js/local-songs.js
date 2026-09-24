// Songs a visitor adds from a folder on their own disk: read in the browser,
// kept in IndexedDB and listed beside the collection as "yours". Nothing
// leaves the browser, so anyone can bring their own transcriptions without
// an account and without publishing them. The pure parts (grouping a folder's
// files into songs, checking them, building index rows) run in Node for the
// tests; the store takes any IndexedDB, or a memory map where there is none.

export const DB_NAME = 'nagori';
export const STORE_NAME = 'local-songs';
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KINDS = ['guitar', 'bass'];
const SKIP_DIRS = new Set(['node_modules', '__pycache__']);

/** Folders never worth reading: version control, dependencies, caches, anything hidden. */
const skipDir = (name) => name.startsWith('.') || SKIP_DIRS.has(name);
const skipPath = (path) => path.split('/').slice(0, -1).some(skipDir);

// --- Reading a folder ----------------------------------------------------------

/** A folder's files as entries [{ path, text() }] from an <input webkitdirectory> or a plain file list. */
export function entriesFromFileList(files) {
  return [...files].map((file) => ({ path: file.webkitRelativePath || file.name, text: () => file.text() })).filter((entry) => !skipPath(entry.path));
}

/** The same from a directory handle (showDirectoryPicker), walking it. */
export async function entriesFromDirectoryHandle(handle, prefix = handle.name) {
  const out = [];
  for await (const [name, child] of handle.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (child.kind === 'directory') {
      if (!skipDir(name)) out.push(...(await entriesFromDirectoryHandle(child, path)));
    } else out.push({ path, text: () => child.getFile().then((file) => file.text()) });
  }
  return out;
}

/** The same from a drop: folders are walked through the (WebKit) entry API, single files taken as they are. */
export async function entriesFromDataTransfer(transfer) {
  const items = [...(transfer.items || [])];
  const entries = items.map((item) => (item.kind === 'file' && item.webkitGetAsEntry ? item.webkitGetAsEntry() : null));
  if (!entries.some(Boolean)) return entriesFromFileList(transfer.files || []);
  const out = [];
  const readAll = (reader) =>
    new Promise((resolve, reject) => {
      const batches = [];
      const next = () =>
        reader.readEntries((batch) => {
          if (!batch.length) return resolve(batches);
          batches.push(...batch);
          next();
        }, reject);
      next();
    });
  const walk = async (entry) => {
    if (!entry) return;
    if (entry.isDirectory) {
      if (skipDir(entry.name)) return;
      for (const child of await readAll(entry.createReader())) await walk(child);
    } else if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      out.push({ path: entry.fullPath.replace(/^\/+/, ''), text: () => file.text() });
    }
  };
  for (const entry of entries) await walk(entry);
  return out;
}

/** Let the visitor choose a folder: the directory picker where the browser has it, an <input webkitdirectory> elsewhere. Resolves to entries, or null when they cancel. */
export async function pickFolderEntries(doc = document) {
  if (typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function') {
    try {
      return await entriesFromDirectoryHandle(await window.showDirectoryPicker({ mode: 'read' }));
    } catch (err) {
      if (err && err.name === 'AbortError') return null;
      throw err;
    }
  }
  return new Promise((resolve) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.setAttribute('webkitdirectory', '');
    input.addEventListener('change', () => resolve(entriesFromFileList(input.files)));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

// --- Songs out of entries ---------------------------------------------------------

const dirname = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const basename = (path) => path.slice(path.lastIndexOf('/') + 1);
const join = (folder, file) => (folder ? `${folder}/${file.replace(/^\.?\//, '')}` : file.replace(/^\.?\//, ''));

/** The folder name as a song id: "Tárrega Lágrima" -> "tarrega-lagrima". */
export function slugify(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Problems with a song and its track files, as [{ key, params }] for t(); empty when it can be shown. */
export function checkSong(song, files) {
  const problems = [];
  const problem = (key, params = {}) => problems.push({ key: `local.check.${key}`, params });
  if (!song || typeof song !== 'object') return [{ key: 'local.check.json', params: { file: 'song.json' } }];
  if (typeof song.id !== 'string' || !ID_RE.test(song.id)) problem('id');
  for (const field of ['title', 'artist']) if (typeof song[field] !== 'string' || !song[field].trim()) problem('field', { field });
  if (!Number.isInteger(song.bars) || song.bars <= 0) problem('field', { field: 'bars' });
  if (!Array.isArray(song.timeSignature) || song.timeSignature.length !== 2) problem('field', { field: 'timeSignature' });
  if (!Array.isArray(song.tracks) || !song.tracks.length) {
    problem('field', { field: 'tracks' });
    return problems;
  }
  for (const meta of song.tracks) {
    const id = meta && meta.id ? meta.id : '?';
    if (!meta || typeof meta.id !== 'string' || typeof meta.file !== 'string') {
      problem('track', { id, file: meta && meta.file ? meta.file : '?' });
      continue;
    }
    if (!KINDS.includes(meta.kind)) problem('kind', { id });
    const track = files[meta.file];
    if (!track) {
      problem('track', { id, file: meta.file });
      continue;
    }
    if (!Array.isArray(track.measures)) problem('measures', { id });
    else if (Number.isInteger(song.bars) && track.measures.length !== song.bars) problem('bars', { id, n: track.measures.length, bars: song.bars });
    const strings = track.strings ?? meta.strings;
    const tuning = track.tuning ?? meta.tuning;
    if (!Number.isInteger(strings) || strings < 4 || strings > 8 || !Array.isArray(tuning) || tuning.length !== strings) problem('tuning', { id });
  }
  return problems;
}

/** One home-page row for a song, like data/songs.json has (a curation.json beside it supplies duration and sort name). */
export function indexRow(song, { added, duration = null, sortArtist = null } = {}) {
  const row = {
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album ?? null,
    year: song.year ?? null,
    key: song.key ?? null,
    bpm: song.bpm ?? null,
    tuning: song.tuning ?? null,
    duration: duration || song.duration || null,
    tracks: song.tracks.length,
    video: Boolean(song.video),
    added,
  };
  if (sortArtist) row.artistSort = sortArtist;
  return row;
}

/**
 * Every song among the entries: a song.json with its track files beside it,
 * one folder or a whole collection. Returns { songs: [{ folder, root, song,
 * files, curation }], problems: [{ folder, key, params }] }; a song with
 * problems is left out and reported. `root` is the top folder the visitor
 * chose, so a later import of the same folder can tell which songs it no
 * longer holds.
 */
export async function readSongFolders(entries) {
  const byPath = new Map(entries.map((entry) => [entry.path.replace(/^\/+/, ''), entry]));
  const songs = [];
  const problems = [];
  const parse = async (entry) => JSON.parse(await entry.text());
  for (const [path, entry] of byPath) {
    if (basename(path) !== 'song.json') continue;
    const folder = dirname(path);
    const label = basename(folder) || 'song.json';
    let song;
    try {
      song = await parse(entry);
    } catch {
      problems.push({ folder: label, key: 'local.check.json', params: { file: 'song.json' } });
      continue;
    }
    if (song && typeof song === 'object' && !song.id && slugify(label)) song.id = slugify(label);
    const files = {};
    let broken = false;
    for (const meta of Array.isArray(song?.tracks) ? song.tracks : []) {
      if (!meta || typeof meta.file !== 'string') continue;
      const trackEntry = byPath.get(join(folder, meta.file));
      if (!trackEntry) continue;
      try {
        files[meta.file] = await parse(trackEntry);
      } catch {
        problems.push({ folder: label, key: 'local.check.json', params: { file: meta.file } });
        broken = true;
      }
    }
    if (broken) continue;
    const found = checkSong(song, files);
    if (found.length) {
      for (const { key, params } of found) problems.push({ folder: label, key, params });
      continue;
    }
    let curation = null;
    const curationEntry = byPath.get(join(folder, 'curation.json'));
    if (curationEntry) {
      try {
        curation = await parse(curationEntry);
      } catch {
        curation = null; // optional; a broken one is ignored
      }
    }
    songs.push({ folder: label, root: path.split('/')[0] === 'song.json' ? label : path.split('/')[0], song, files, curation });
  }
  return { songs, problems };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What an import means against what the store holds: records to write
 * (new songs, and changed ones keeping their original added date), the
 * ids left as they were, and the leftovers, songs from an earlier import
 * of the same top folder that this import no longer contains. A song whose
 * id was last added from another folder is replaced and reported as such;
 * later duplicates of an id within one import are dropped and reported.
 * Folders are told apart by their name alone.
 */
export async function planImport(found, existing, today = new Date().toISOString().slice(0, 10)) {
  const previous = new Map(existing.map((record) => [record.id, record]));
  const seen = new Set();
  const roots = new Set();
  const plan = { records: [], added: [], updated: [], replaced: [], unchanged: [], duplicates: [], leftovers: [] };
  for (const item of found) {
    roots.add(item.root);
    if (seen.has(item.song.id)) {
      plan.duplicates.push({ folder: item.folder, id: item.song.id });
      continue;
    }
    seen.add(item.song.id);
    const old = previous.get(item.song.id);
    if (old && same(old.song, item.song) && same(old.files, item.files) && old.root === item.root) {
      plan.unchanged.push(item.song.id);
      continue;
    }
    const record = { ...(await makeRecord(item, old ? old.added : today)), root: item.root };
    if (old) record.updated = today;
    plan.records.push(record);
    if (!old) plan.added.push(item.song.id);
    else if (old.root && old.root !== item.root) plan.replaced.push({ id: item.song.id, title: item.song.title, from: old.root });
    else plan.updated.push(item.song.id);
  }
  for (const record of existing) if (record.root && roots.has(record.root) && !seen.has(record.id)) plan.leftovers.push(record.id);
  return plan;
}

/** The tab's length as m:ss from the tempo map, the way make index computes it. */
export async function songLength(song, files) {
  const { tabClock } = await import('./tab-audio.js');
  const measures = files[song.tracks[0].file].measures;
  const clock = tabClock(song, measures, song.tracks.map((meta) => files[meta.file].measures));
  const seconds = Math.round(clock.end);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** A store record for a song read from a folder, its row ready for the home page. */
export async function makeRecord({ song, files, curation }, added = new Date().toISOString().slice(0, 10)) {
  const duration = curation?.duration || song.duration || (await songLength(song, files).catch(() => null));
  return { id: song.id, added, song, files, row: indexRow(song, { added, duration, sortArtist: curation?.sortArtist || null }) };
}

// --- The store --------------------------------------------------------------------

/** A store over IndexedDB: list(), get(id), put(record), remove(id), clear(). Null where IndexedDB is unavailable or refuses to open. */
export async function openStore(idb = typeof indexedDB !== 'undefined' ? indexedDB : null) {
  if (!idb) return null;
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const request = idb.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('blocked'));
    });
  } catch {
    return null; // private mode in some browsers, or storage switched off
  }
  const run = (mode, fn) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const request = fn(tx.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  return {
    list: () => run('readonly', (store) => store.getAll()),
    get: (id) => run('readonly', (store) => store.get(id)),
    put: (record) => run('readwrite', (store) => store.put(record)),
    remove: (id) => run('readwrite', (store) => store.delete(id)),
    clear: () => run('readwrite', (store) => store.clear()),
  };
}

/** The same interface over a Map, for tests and for a page without IndexedDB (songs then last until the page is left). */
export function memoryStore() {
  const map = new Map();
  return {
    list: async () => [...map.values()],
    get: async (id) => map.get(id),
    put: async (record) => {
      map.set(record.id, record);
      return record.id;
    },
    remove: async (id) => {
      map.delete(id);
    },
    clear: async () => map.clear(),
  };
}
