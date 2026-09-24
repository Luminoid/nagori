// Site configuration (data/site.json): the site's name, its default language
// and, per language, the home page's title and intro, the name of the song
// collection, the footer line and the copyright line after it. Anything left empty keeps the built-in
// text, so a fork only fills in what it wants to change.

import { loadJSON, storage } from './util.js';
import { lang, setLanguage, t } from './i18n.js';

const DEFAULTS = { name: 'Nagori', defaultLang: 'auto' };
let site = { ...DEFAULTS };

/** Load data/site.json (missing or broken: defaults) and apply its default language when nothing else chose one. */
export async function loadSite() {
  try {
    site = { ...DEFAULTS, ...(await loadJSON('data/site.json')) };
  } catch {
    site = { ...DEFAULTS };
  }
  const param = new URLSearchParams(window.location.search).get('lang');
  const stored = storage.get('nagori:lang');
  if (!param && !stored && site.defaultLang && site.defaultLang !== 'auto') setLanguage(site.defaultLang);
  return site;
}

function siteName() {
  return site.name || DEFAULTS.name;
}

/** A per-language text from the config, or '' when the config leaves it empty. */
export function siteText(key) {
  const value = site[key];
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value[lang] || value.en || '';
}

/** Title for a page: "Lágrima · Francisco Tárrega · <site name>". */
export function pageTitle(...parts) {
  return [...parts.filter(Boolean), siteName()].join(' · ');
}

/**
 * Put the configured name and texts into a page after applyLang(): the brand
 * in the header, the document title, and the hero, collection heading and
 * footer wherever a page has them.
 */
export function applySite(root = document) {
  const name = siteName();
  for (const brand of root.querySelectorAll('.brand')) {
    const textNode = [...brand.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    if (textNode) textNode.textContent = ` ${name}`;
  }
  if (document.title.includes(DEFAULTS.name)) document.title = document.title.replace(DEFAULTS.name, name);
  const overrides = [
    ['[data-i18n="home.title"]', siteText('title')],
    ['[data-i18n="home.intro"]', siteText('intro')],
  ];
  for (const [selector, text] of overrides) {
    if (!text) continue;
    for (const el of root.querySelectorAll(selector)) el.textContent = text;
  }
  const copyright = siteText('copyright');
  for (const el of root.querySelectorAll('[data-i18n="home.footer"]')) {
    const base = siteText('footer') || t('home.footer', { name });
    el.textContent = copyright ? `${base} ${copyright}` : base;
  }
  const collection = siteText('collection');
  for (const el of root.querySelectorAll('[data-i18n="home.songs"]')) {
    el.textContent = collection || t('home.songs');
    el.classList.toggle('sr-only', !collection);
  }
}
