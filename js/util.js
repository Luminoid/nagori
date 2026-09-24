// Small DOM, formatting, and storage helpers shared by every page.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, v);
        else el.style[prop] = v;
      }
    }
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'html') el.innerHTML = value;
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Display form of a chord name: Bb6 -> B♭6, C#m -> C♯m. Slash chords handled on both sides. */
export function formatChord(name) {
  if (!name) return '';
  return String(name)
    .split('/')
    .map((part) => part.replace(/^([A-G])b/, '$1♭').replace(/^([A-G])#/, '$1♯'))
    .join('/');
}

/** Canonical ASCII key for chord lookups: B♭6 -> Bb6, C♯m -> C#m. */
export function chordKey(name) {
  if (!name) return '';
  return String(name).replace(/♭/g, 'b').replace(/♯/g, '#').trim();
}

export function durationValue(beat) {
  return beat.d[0] / beat.d[1];
}

export async function loadJSON(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
}

export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode or blocked storage: ignore */
    }
  },
};

export function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Compress a sorted list of 1-based bar numbers into "1–3, 12, 23–24". */
export function formatBarList(bars, max = 6, { separator = ', ', more = '…' } = {}) {
  const sorted = [...new Set(bars)].sort((a, b) => a - b);
  const ranges = [];
  for (const bar of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && bar === last[1] + 1) last[1] = bar;
    else ranges.push([bar, bar]);
  }
  const text = ranges.slice(0, max).map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`));
  if (ranges.length > max) text.push(more);
  return text.join(separator);
}

export function setupThemeToggle() {
  const button = document.getElementById('theme-toggle');
  if (!button) return;
  button.addEventListener('click', () => {
    const root = document.documentElement;
    const isLight = root.dataset.theme === 'light' || (!root.dataset.theme && matchMedia('(prefers-color-scheme: light)').matches);
    const next = isLight ? 'dark' : 'light';
    root.dataset.theme = next;
    storage.set('nagori:theme', next);
  });
}

/** Print on the light tokens whatever the visitor's theme, and restore it afterwards. */
export function setupPrintTheme() {
  if (typeof window === 'undefined') return;
  const root = document.documentElement;
  let previous = null;
  window.addEventListener('beforeprint', () => {
    previous = root.dataset.theme ?? null;
    root.dataset.theme = 'light';
  });
  window.addEventListener('afterprint', () => {
    if (previous === null) delete root.dataset.theme;
    else root.dataset.theme = previous;
  });
}

const SHARP_PITCH_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT_PITCH_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

/**
 * Tab string labels from MIDI tuning, highest string first; a repeated top-string
 * name is lowercased (e B G D A E). Flats when the tuning has E♭, A♭ or B♭
 * strings (a half-step-down guitar), sharps otherwise (D A D F♯ B E).
 */
export function stringNames(tuning) {
  const classes = tuning.map((midi) => ((midi % 12) + 12) % 12);
  const flats = classes.some((pc) => pc === 3 || pc === 8 || pc === 10);
  const names = classes.map((pc) => (flats ? FLAT_PITCH_NAMES : SHARP_PITCH_NAMES)[pc]);
  if (names.length > 1 && names[0] === names[names.length - 1]) names[0] = names[0].toLowerCase();
  return names;
}

/** Whether keystrokes belong to the focused control rather than to the page's shortcuts. */
export function isEditing(el) {
  return !!el && (el.isContentEditable || /^(input|select|textarea)$/i.test(el.tagName || ''));
}

/** Text for matching: lower case, accents stripped ("Tárrega" -> "tarrega"), so a plain keyboard finds it. */
export function foldText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
