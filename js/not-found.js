// 404.html: the header, texts and theme of the other pages, nothing else.
import { setupThemeToggle } from './util.js';
import { applyLang, setupLanguageToggle, t } from './i18n.js';
import { loadSite, applySite, pageTitle } from './site.js';
import { registerOffline } from './offline.js';

async function main() {
  await loadSite();
  applyLang();
  applySite();
  document.title = pageTitle(t('notFound.title'));
  setupThemeToggle();
  setupLanguageToggle();
  registerOffline();
}

main();
