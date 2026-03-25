// content-reader.js — distraction-free reader mode overlay using Mozilla Readability
// Depends on: content-core.js, content-translation.js (runTranslateElements)

const READER_OVERLAY_ID = 'ai-reader-overlay';

// READER_ICON is defined in content-core.js
const CLOSE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

// Collect all translatable elements inside the reader body.
// No viewport check needed — everything in the clean DOM is article content.
function collectReaderElements(scope) {
  const candidates = Array.from(
    scope.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote, li')
  );
  const filtered = candidates.filter(el => {
    if (el.dataset.aiWrapped) return false;
    const text = el.innerText?.trim();
    return text && text.length >= 20;
  });
  // Drop ancestors: only translate innermost candidates
  return filtered.filter(el => !filtered.some(other => other !== el && el.contains(other)));
}

function toggleReaderMode(triggerBtn) {
  if (document.getElementById(READER_OVERLAY_ID)) {
    closeReaderMode();
    return;
  }
  openReaderMode(triggerBtn);
}

function openReaderMode(triggerBtn) {
  if (triggerBtn) { triggerBtn.disabled = true; }

  const docClone = document.cloneNode(true);
  const reader = new Readability(docClone);
  const article = reader.parse();

  if (triggerBtn) { triggerBtn.disabled = false; }

  if (!article || !article.content) {
    showToast(browser.i18n.getMessage('noAnalyzableContent') || 'No readable content found');
    return;
  }

  const isDark = isThemeDark(_cachedTheme);

  // --- Overlay root ---
  const overlay = document.createElement('div');
  overlay.id = READER_OVERLAY_ID;
  if (isDark) overlay.classList.add('dark');

  // --- Toolbar ---
  const toolbar = document.createElement('div');
  toolbar.id = 'ai-reader-toolbar';

  const siteLabel = document.createElement('span');
  siteLabel.id = 'ai-reader-site';
  siteLabel.textContent = article.siteName || location.hostname;

  const actions = document.createElement('div');
  actions.id = 'ai-reader-toolbar-actions';

  const translateBtn = document.createElement('button');
  translateBtn.id = 'ai-reader-translate-btn';
  translateBtn.title = browser.i18n.getMessage('translateScreenContent') || 'Translate';
  setTranslateIcon(translateBtn);

  const closeBtn = document.createElement('button');
  closeBtn.id = 'ai-reader-close-btn';
  closeBtn.title = browser.i18n.getMessage('exitReader') || 'Exit reader';
  closeBtn.innerHTML = CLOSE_ICON;

  actions.append(translateBtn, closeBtn);
  toolbar.append(siteLabel, actions);

  // --- Content ---
  const content = document.createElement('div');
  content.id = 'ai-reader-content';

  // Metadata block
  const meta = document.createElement('div');
  meta.id = 'ai-reader-meta';

  const titleEl = document.createElement('h1');
  titleEl.id = 'ai-reader-title';
  titleEl.textContent = article.title || document.title;
  meta.appendChild(titleEl);

  const bylineParts = [article.byline, article.siteName, article.publishedTime].filter(Boolean);
  if (bylineParts.length > 0) {
    const bylineEl = document.createElement('div');
    bylineEl.id = 'ai-reader-byline';
    bylineEl.textContent = bylineParts.join(' · ');
    meta.appendChild(bylineEl);
  }

  // Article body from Readability
  const body = document.createElement('div');
  body.id = 'ai-reader-body';
  body.innerHTML = article.content;
  // Strip any injected scripts/styles for safety
  body.querySelectorAll('script, style').forEach(el => el.remove());

  content.append(meta, body);
  overlay.append(toolbar, content);
  document.body.appendChild(overlay);

  // Escape key closes
  function onKeydown(e) {
    if (e.key === 'Escape') closeReaderMode();
  }
  document.addEventListener('keydown', onKeydown);
  overlay._cleanup = () => document.removeEventListener('keydown', onKeydown);

  closeBtn.addEventListener('click', closeReaderMode);
  translateBtn.addEventListener('click', () => {
    const elements = collectReaderElements(body);
    runTranslateElements(elements, translateBtn);
  });
}

function closeReaderMode() {
  const overlay = document.getElementById(READER_OVERLAY_ID);
  if (!overlay) return;
  overlay._cleanup?.();
  overlay.remove();
}
