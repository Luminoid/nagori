// Site configuration (data/site.json): the site's name, its default language
// and, per language, the home page's title and intro, the name of the song
// collection, the footer line and the copyright line after it. Anything left empty keeps the built-in
// text, so a fork only fills in what it wants to change.

import { h, loadJSON, storage } from './util.js';
import { lang, setLanguage, t } from './i18n.js';

const DEFAULTS = { name: 'Nagori', defaultLang: 'auto' };
// GitHub's mark (the octicon), for the header link to the site's repository.
const GITHUB_MARK = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
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

/**
 * A link to one of the site's pages, as written (`song.html?id=x`) or, when
 * site.json says the host serves pages without the extension (`cleanUrls`:
 * Cloudflare Pages, GitHub Pages), in that form (`song?id=x`, `./` for index).
 * Links to other sites pass through.
 */
export function pageHref(path, clean = site.cleanUrls) {
  if (!clean || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(path)) return path;
  const short = path.replace(/(^|\/)index\.html(?=$|[?#])/, '$1').replace(/\.html(?=$|[?#])/, '');
  return short === '' || /^[?#]/.test(short) ? `./${short}` : short;
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
 * footer wherever a page has them; with `cleanUrls`, the page's links to the
 * other pages take the host's form; with `repo`, a GitHub link joins the
 * header's controls.
 */
export function applySite(root = document) {
  const name = siteName();
  if (site.cleanUrls) {
    for (const a of root.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      const short = pageHref(href);
      if (short !== href) a.setAttribute('href', short);
    }
  }
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
  const repo = typeof site.repo === 'string' ? site.repo.trim() : '';
  for (const actions of root.querySelectorAll('.header-actions')) {
    let link = actions.querySelector('.repo-link');
    if (!repo) {
      link?.remove();
      continue;
    }
    if (!link) {
      link = h('a', { class: 'icon-btn text repo-link', target: '_blank', rel: 'noopener', 'data-i18n-aria': 'nav.source', 'data-i18n-title': 'nav.source' });
      link.innerHTML = GITHUB_MARK;
      link.append('GitHub');
      actions.prepend(link);
    }
    link.href = repo;
    link.title = t('nav.source');
    link.setAttribute('aria-label', t('nav.source'));
  }
}
