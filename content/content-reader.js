// content-reader.js — distraction-free reader mode overlay using Mozilla Readability
// Depends on: content-reader-settings.js (icons, prefs, readerGetById, collectReaderElements, buildSettingsPanel),
//             content-core.js, content-dom.js, content-translation.js (runTranslateElements)

const READER_OVERLAY_ID  = 'ai-reader-overlay';
const READER_SETTINGS_ID = 'ai-reader-settings';

// Tracks the active reader body element so other modules can query it without
// knowing the internal DOM ID. Set by openReaderMode, cleared by closeReaderMode.
let _readerBody = null;
function getActiveReaderBody() { return _readerBody; }

// Prevents re-entrant calls while the async parse is in progress.
let _readerOpening = false;

// Holds the page-mode summary while reader mode is active so the two instances
// stay independent. Restored when reader mode closes.
let _pageSummaryBackup = null;

// --- Reader state persistence (scroll position + translations) ---
// In-memory mirror of chrome.storage readerStates, loaded on open and kept
// in sync so rapid updates don't race each other on storage reads.
let _readerStates = null;

// Readability-parsed HTML and metadata for the current live article, used by
// the save feature. Cleared when reader mode closes.
let _articleHtml = null;
let _articleMeta = null;

// True while a saved article is loaded into the reader overlay (via the library
// panel). Suppresses scroll-position tracking for the live page URL.
let _libraryArticleLoaded = false;
let _libraryArticleUrl   = null; // URL of the library article currently shown in reader

// Snapshot of the live article taken before the first library load, so we can
// restore it when the user clicks "Back to article".
let _liveArticleSnapshot = null;

function getReaderUrl() {
  return location.origin + location.pathname;
}

// Strips event-handler attributes and javascript:/data: URLs from a parsed document
// in place. Addresses stored article HTML restored from browser.storage — script/style
// tags are removed by callers; this covers the remaining XSS vectors.
function sanitiseArticleDoc(doc) {
  doc.querySelectorAll('script, style').forEach(el => el.remove());
  doc.querySelectorAll('*').forEach(el => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('on')) {
        el.removeAttribute(attr.name);
      }
    }
    for (const attr of ['href', 'src', 'action', 'formaction']) {
      const val = el.getAttribute(attr);
      if (val && /^\s*(javascript|vbscript)\s*:/i.test(val)) {
        el.removeAttribute(attr);
      }
    }
    // data: hrefs and form actions have no legitimate use in article HTML.
    for (const attr of ['href', 'action', 'formaction']) {
      const val = el.getAttribute(attr);
      if (val && /^\s*data\s*:/i.test(val)) {
        el.removeAttribute(attr);
      }
    }
  });
}

// Called from content-init.js storage.onChanged to keep the mirror current.
// Ignored when reader mode is closed (_readerStates is null).
function syncReaderStatesFromStorage(newValue) {
  if (_readerStates !== null) _readerStates = newValue || {};
}

// Apply updater(urlEntry) to the given URL's state entry and persist.
// Pass targetUrl explicitly when updating a library article's state.
function saveReaderState(updater, targetUrl) {
  if (!_readerStates) return;
  const url = targetUrl || getReaderUrl();
  if (!_readerStates[url]) _readerStates[url] = {};
  updater(_readerStates[url]);
  // Keep only the 50 most recently written entries to cap storage usage.
  const keys = Object.keys(_readerStates);
  if (keys.length > 50) keys.slice(0, keys.length - 50).forEach(k => delete _readerStates[k]);
  browser.storage.local.set({ [STORAGE_KEYS.READER_STATES]: _readerStates });
}

// Returns all block content elements in the reader scope regardless of translation
// state. Used for reading-position tracking — unlike collectReaderElements this list
// is stable whether or not translations have been applied.
function getReaderPositionElements(scope) {
  return Array.from(scope.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote, li'));
}

// Find the index of the first reader element whose bottom edge is at/below a
// threshold inside the overlay — this is the "reading position" anchor that
// survives font-size and width changes.
function findReadingIndex(scrollEl) {
  if (!_readerBody) return 0;
  const elements = getReaderPositionElements(_readerBody);
  if (!elements.length) return 0;
  const scrollRect = scrollEl.getBoundingClientRect();
  const threshold = scrollRect.top + 80;
  for (let i = 0; i < elements.length; i++) {
    if (elements[i].getBoundingClientRect().bottom >= threshold) return i;
  }
  return elements.length - 1;
}

// Called by content-panel.js after translate-all completes in reader mode.
// elements must be the same array that was passed to runTranslateElements — collected
// before translation so it isn't empty (filterTranslatableElements skips wrapped nodes).
function saveCurrentReaderTranslations(elements) {
  if (!_readerBody || !elements?.length) return;
  const translations = {};
  elements.forEach((el, idx) => {
    if (el.dataset.aiWrapped !== '1') return;
    const span = el.querySelector('.ai-para-translated');
    if (span?.innerHTML.trim()) {
      translations[idx] = { html: span.innerHTML, showing: el.classList.contains('show-translation') };
    }
  });
  if (!Object.keys(translations).length) return;
  saveReaderState(state => { state.translations = translations; }, _libraryArticleUrl || undefined);
  attachTranslationToggleTracking(elements);
}

// Attach a secondary click listener to each toggle button that keeps the
// stored showing state in sync. Idempotent via data-toggle-tracked.
function attachTranslationToggleTracking(elements) {
  // Capture the library URL at call time so the closures below use the correct
  // URL even if _libraryArticleUrl changes later (e.g. user navigates back).
  const trackUrl = _libraryArticleUrl || null;
  elements.forEach((el, idx) => {
    if (!el.dataset.aiWrapped) return;
    const btn = el.querySelector('.ai-toggle-btn');
    if (!btn || btn.dataset.toggleTracked) return;
    btn.dataset.toggleTracked = '1';
    btn.addEventListener('click', () => {
      const showing = el.classList.contains('show-translation');
      saveReaderState(state => {
        if (state.translations?.[idx]) state.translations[idx].showing = showing;
      }, trackUrl || undefined);
    });
  });
}

// CSS injected into the reader shadow root. READER_SHADOW_CSS was extracted to
// content/reader-shadow.css, loaded via _readerCssReady and injected in openReaderMode().

function toggleReaderMode(triggerBtn) {
  if (document.getElementById(READER_OVERLAY_ID)) {
    closeReaderMode();
    return;
  }
  openReaderMode(triggerBtn);
}

async function openReaderMode(triggerBtn) {
  // Guard against re-entrant calls during the async parse, and against a
  // second open if the overlay is already in the DOM.
  if (_readerOpening || document.getElementById(READER_OVERLAY_ID)) return;
  _readerOpening = true;

  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.classList.add('ai-loading-btn');
  }

  let article, prefs, urlState, isSaved, promoteFromSync;
  try {
    const docClone = document.cloneNode(true);
    // Strip translation wrappers so Readability sees original text only.
    docClone.querySelectorAll('[data-ai-wrapped]').forEach(el => {
      const original = el.querySelector('.ai-para-original');
      if (original) {
        el.replaceChildren(...Array.from(original.childNodes).map(n => n.cloneNode(true)));
        el.classList.remove('ai-para-wrap', 'show-translation');
        delete el.dataset.aiWrapped;
        if (el.style.position === 'relative') el.style.position = '';
      }
    });
    article = new Readability(docClone).parse();
    prefs   = await loadReaderPrefs();
    const readerSyncKey = urlToSyncKey(getReaderUrl());
    const [{ readerStates }, { savedArticles }, syncResult] = await Promise.all([
      browser.storage.local.get(STORAGE_KEYS.READER_STATES),
      browser.storage.local.get(STORAGE_KEYS.SAVED_ARTICLES),
      browser.storage.sync.get(readerSyncKey).catch(() => ({})),
    ]);
    _readerStates = readerStates || {};
    urlState = _readerStates[getReaderUrl()] || {};
    const isLocalSaved = Array.isArray(savedArticles) && savedArticles.some(a => a.url === getReaderUrl());
    const isSyncSaved  = !!syncResult[readerSyncKey];
    isSaved = isLocalSaved || isSyncSaved;
    promoteFromSync = isSyncSaved && !isLocalSaved;
  } catch (err) {
    error('[PageGrep] openReaderMode failed:', err.message);
    _readerOpening = false;
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.classList.remove('ai-loading-btn');
    }
    showToast(browser.i18n.getMessage('readerNoContent') || 'No readable content found');
    return;
  }

  _readerOpening = false;
  if (triggerBtn) {
    triggerBtn.disabled = false;
    triggerBtn.classList.remove('ai-loading-btn');
  }

  if (!article || !article.content) {
    showToast(browser.i18n.getMessage('readerNoContent') || 'No readable content found');
    return;
  }

  // Store for the save feature.
  _articleHtml = article.content;
  _articleMeta = {
    title: article.title || document.title,
    byline: article.byline || null,
    siteName: article.siteName || null,
    publishedTime: article.publishedTime || null,
  };

  // Promote a sync-only bookmark to a full local article now that we have the content.
  // _promoteSuppressed is set to true if the user unsaves the article before this completes.
  if (promoteFromSync) {
    _promoteSuppressed = false;
    (async () => {
      try {
        const url = getReaderUrl();
        const { savedArticles } = await browser.storage.local.get(STORAGE_KEYS.SAVED_ARTICLES);
        if (_promoteSuppressed) return;
        const articles = Array.isArray(savedArticles) ? savedArticles : [];
        if (!articles.some(a => a.url === url)) {
          articles.unshift({
            url,
            title: _articleMeta.title,
            byline: _articleMeta.byline,
            siteName: _articleMeta.siteName,
            publishedTime: _articleMeta.publishedTime,
            savedAt: Date.now(),
            html: _articleHtml,
            translations: {},
          });
          if (articles.length > 20) articles.length = 20;
          await browser.storage.local.set({ [STORAGE_KEYS.SAVED_ARTICLES]: articles });
          await syncRemoveBookmark(url);
        }
      } catch (_) { /* non-critical */ }
    })();
  }

  // Shadow host lives in the page DOM (carries the ID + CSS vars for shadow inheritance).
  const shadowHost = document.createElement('div');
  shadowHost.id = READER_OVERLAY_ID;
  const shadowRoot = shadowHost.attachShadow({ mode: 'open' });
  const shadowStyle = document.createElement('style');
  shadowStyle.textContent = await _readerCssReady;
  shadowRoot.appendChild(shadowStyle);

  // Inner overlay container inside the shadow root — isolated from page CSS.
  const overlay = document.createElement('div');
  overlay.className = 'rd-overlay';
  overlay.tabIndex = -1;
  applyPrefs(shadowHost, prefs); // CSS vars + data-reader-theme propagate into shadow
  shadowRoot.appendChild(overlay);

  const closeBtn = document.createElement('button');
  closeBtn.id = 'ai-reader-close-btn';
  closeBtn.replaceChildren(_svgParser.parseFromString(CLOSE_ICON, 'image/svg+xml').documentElement);
  const exitLabel = browser.i18n.getMessage('exitReader') || 'Exit reader';
  closeBtn.title = exitLabel;
  closeBtn.setAttribute('aria-label', exitLabel);

  const saveBtn = document.createElement('button');
  saveBtn.id = 'ai-reader-save-btn';
  updateSaveBtn(saveBtn, isSaved);
  saveBtn.addEventListener('click', async () => {
    await onSaveBtnClick(saveBtn);
    // Keep library list in sync when user unsaves while viewing a library article.
    if (_libraryArticleLoaded && libraryPanel.classList.contains('open')) libraryPanel._refresh();
  });

  const libraryBtn = document.createElement('button');
  libraryBtn.id = 'ai-reader-library-btn';
  libraryBtn.replaceChildren(_svgParser.parseFromString(LIBRARY_ICON, 'image/svg+xml').documentElement);
  const libraryLabel = browser.i18n.getMessage('savedTab') || 'Saved';
  libraryBtn.title = libraryLabel;
  libraryBtn.setAttribute('aria-label', libraryLabel);

  // The backdrop is kept OUT of the DOM when the library is closed so it cannot
  // interfere with scroll-event dispatch (Firefox does not always honour
  // pointer-events:none for wheel/scroll targeting).
  const libraryBackdrop = document.createElement('div');
  libraryBackdrop.id = 'ai-reader-library-backdrop';

  function openLibrary() {
    libraryPanel.before(libraryBackdrop); // insert into DOM just before the panel
    requestAnimationFrame(() => libraryBackdrop.classList.add('visible')); // fade in
    libraryPanel.classList.add('open');
    libraryBtn.classList.add('active');
    _focusableCache = null;
    libraryPanel._refresh();
  }

  function closeLibrary() {
    libraryPanel.classList.remove('open');
    libraryBtn.classList.remove('active');
    _focusableCache = null;
    if (libraryBackdrop.isConnected) {
      if (libraryBackdrop.classList.contains('visible')) {
        // Fully faded in — animate out then remove.
        libraryBackdrop.classList.remove('visible');
        libraryBackdrop.addEventListener('transitionend', () => libraryBackdrop.remove(), { once: true });
      } else {
        // Closed before fade-in completed (rapid tap) — remove immediately.
        libraryBackdrop.remove();
      }
    }
  }

  const backBtn = document.createElement('button');
  backBtn.id = 'ai-reader-back-btn';
  backBtn.replaceChildren(_svgParser.parseFromString(BACK_ICON, 'image/svg+xml').documentElement);
  const backLabel = browser.i18n.getMessage('backToArticle') || 'Back to article';
  backBtn.title = backLabel;
  backBtn.setAttribute('aria-label', backLabel);
  backBtn.style.display = 'none';

  const libraryPanel = buildLibraryPanel(
    (article) => { loadSavedArticleIntoReader(article, shadowHost, saveBtn, backBtn); closeLibrary(); },
    closeLibrary,
    (deletedArticle) => {
      // If the deleted article is currently displayed in the reader, mark it unsaved.
      const activeUrl = _libraryArticleUrl || getReaderUrl();
      if (deletedArticle.url === activeUrl) updateSaveBtn(saveBtn, false);
    }
  );

  libraryBackdrop.addEventListener('click', closeLibrary);

  backBtn.addEventListener('click', () => restoreLiveArticle(shadowHost, saveBtn, backBtn));

  const printBtn = document.createElement('button');
  printBtn.id = 'ai-reader-print-btn';
  printBtn.replaceChildren(_svgParser.parseFromString(PRINT_ICON, 'image/svg+xml').documentElement);
  const printLabel = browser.i18n.getMessage('printArticle') || 'Print';
  printBtn.title = printLabel;
  printBtn.setAttribute('aria-label', printLabel);
  printBtn.addEventListener('click', () => window.print());

  libraryBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (libraryPanel.classList.contains('open')) { closeLibrary(); } else { openLibrary(); }
  });

  // created before settingsPanel so we can pass it for width transitions
  const content = document.createElement('div');
  content.id = 'ai-reader-content';

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

  const body = document.createElement('div');
  body.id = 'ai-reader-body';
  const articleDoc = _htmlParser.parseFromString(article.content, 'text/html');
  sanitiseArticleDoc(articleDoc);
  body.replaceChildren(...Array.from(articleDoc.body.childNodes));
  _readerBody = body;
  const summaryElements = collectArticleElements(body);

  // Restore cached translations (no API call).
  // Collect elements before any restoreTranslation call — filterTranslatableElements
  // skips wrapped nodes, so the list must be captured while everything is still unwrapped.
  if (urlState.translations) {
    const elements = collectReaderElements(body);
    elements.forEach((el, idx) => {
      const saved = urlState.translations[idx];
      if (!saved) return;
      restoreTranslation(el, saved.html, saved.showing, (newShowing) => {
        saveReaderState(state => {
          if (state.translations?.[idx]) state.translations[idx].showing = newShowing;
        });
      });
    });
    // Pass the same pre-wrap list; elements are wrapped now but references are valid.
    attachTranslationToggleTracking(elements);
  }

  content.append(meta, body);

  // --- Settings panel (receives content so width clicks can trigger its CSS transition) ---
  const settingsPanel = buildSettingsPanel(shadowHost, prefs, content);

  // Wrap the article content in a dedicated scroll container so the overlay itself
  // can be overflow:hidden — this keeps buttons/panels truly above the scroll area
  // and avoids position:fixed inside overflow:auto interaction bugs.
  const scrollEl = document.createElement('div');
  scrollEl.id = 'ai-reader-scroll';
  scrollEl.tabIndex = -1; // allow Space/PageDown to scroll when focused
  scrollEl.appendChild(content);

  overlay.append(closeBtn, saveBtn, backBtn, libraryBtn, printBtn, libraryPanel, settingsPanel, scrollEl);

  // Store the scroll element for use in loadSavedArticleIntoReader / restoreLiveArticle.
  shadowHost._scrollEl = scrollEl;

  // Save scroll position before locking the page so we can restore it on close.
  const savedScrollY = window.scrollY;
  document.body.appendChild(shadowHost);
  // Use setProperty with 'important' so the lock overrides site CSS that may
  // declare overflow with !important (e.g. `html, body { overflow: auto !important }`).
  const _savedHtmlOverflow = [
    document.documentElement.style.getPropertyValue('overflow'),
    document.documentElement.style.getPropertyPriority('overflow'),
  ];
  const _savedBodyOverflow = [
    document.body.style.getPropertyValue('overflow'),
    document.body.style.getPropertyPriority('overflow'),
  ];
  document.documentElement.style.setProperty('overflow', 'hidden', 'important');
  document.body.style.setProperty('overflow', 'hidden', 'important');
  shadowHost._savedHtmlOverflow = _savedHtmlOverflow;
  shadowHost._savedBodyOverflow = _savedBodyOverflow;

  // Swap to reader-mode summary instance before notifying the sidebar.
  _pageSummaryBackup = {
    points: Array.isArray(SUMMARY_STATE.points) ? SUMMARY_STATE.points.slice() : [],
    elements: Array.isArray(SUMMARY_STATE.elements) ? SUMMARY_STATE.elements.slice() : []
  };
  SUMMARY_STATE.points = urlState.summary?.points || [];
  // Restore live DOM refs for cached reader summaries using the original
  // reader text collected before translation wrappers are reapplied.
  SUMMARY_STATE.elements = restoreSummaryElements(urlState.summary, summaryElements);

  browser.runtime.sendMessage({ action: 'readerModeChanged', active: true }).catch(() => {});

  // Focus the scroll container so Space/PageDown scroll the article.
  // The close button and settings remain reachable via Tab (focus trap below).
  scrollEl.focus();

  // Restore last reading position (element-index-based, survives font/width changes).
  // Uses getReaderPositionElements — stable regardless of translation state.
  if (urlState.readingIndex != null) {
    const target = getReaderPositionElements(body)[urlState.readingIndex];
    if (target) {
      requestAnimationFrame(() => {
        const scrollRect = scrollEl.getBoundingClientRect();
        const elRect = target.getBoundingClientRect();
        scrollEl.scrollTop = elRect.top - scrollRect.top - 16;
      });
    }
  }

  // Collect teardown callbacks — flushed immediately on close, before the fade-out.
  const cleanupFns = [];

  // Inject a document-level print stylesheet so the reader content fills the page
  // and all other page content is hidden. Removed on reader close.
  const printStyle = document.createElement('style');
  printStyle.id = 'ai-reader-print-style';
  printStyle.textContent = `@media print {
  html, body { overflow: visible !important; }
  body > *:not(#${READER_OVERLAY_ID}) { display: none !important; }
  #${PANEL_ID} { display: none !important; }
}`;
  document.head.appendChild(printStyle);
  cleanupFns.push(() => printStyle.remove());

  // Prevent wheel events from bubbling to the page's scroll container.
  // Sites that declare `html { overflow: auto !important }` can otherwise
  // "steal" wheel events that the reader scroll container should handle.
  scrollEl.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });

  // Persist reading position on scroll (debounced) so it survives crashes/unloads.
  // Skipped when a saved article is loaded in-place (no URL to persist against).
  let _scrollSaveTimer = null;
  scrollEl.addEventListener('scroll', () => {
    if (_libraryArticleLoaded) return;
    clearTimeout(_scrollSaveTimer);
    _scrollSaveTimer = setTimeout(() => {
      saveReaderState(state => { state.readingIndex = findReadingIndex(scrollEl); });
    }, 300);
  }, { passive: true });
  cleanupFns.push(() => clearTimeout(_scrollSaveTimer));


  // JS boolean is the source of truth for settings panel visibility.
  let settingsOpen = false;
  let _focusableCache = null; // invalidated whenever settingsOpen changes
  function setSettingsOpen(open) {
    settingsOpen = open;
    _focusableCache = null;
    // Position (and set transform-origin) BEFORE adding .open so the scale
    // animation starts from the correct corner on every open.
    if (open) positionSettingsPopup(settingsPanel, panelReaderBtn);
    settingsPanel.classList.toggle('open', open);
    panelReaderBtn?.classList.toggle('active', open);
    if (open) {
      // Move focus inside the panel so keyboard/screen-reader users land in the right place.
      const firstFocusable = settingsPanel.querySelector('button:not([disabled])');
      firstFocusable?.focus();
    }
  }

  // Repurpose the floating panel reader button as the settings trigger.
  const panelReaderBtn = triggerBtn;
  if (panelReaderBtn) {
    const savedChildren = Array.from(panelReaderBtn.childNodes);
    const savedTitle    = panelReaderBtn.title;
    panelReaderBtn.dataset.readerActive = '1';
    panelReaderBtn.replaceChildren(_svgParser.parseFromString(SETTINGS_ICON, 'image/svg+xml').documentElement);
    panelReaderBtn.title = browser.i18n.getMessage('readerSettings') || 'Reading settings';

    function onSettingsClick(e) {
      e.stopPropagation();
      setSettingsOpen(!settingsOpen);
    }
    panelReaderBtn.addEventListener('click', onSettingsClick);

    cleanupFns.push(() => {
      panelReaderBtn.removeEventListener('click', onSettingsClick);
      panelReaderBtn.replaceChildren(...savedChildren);
      panelReaderBtn.title = savedTitle;
      panelReaderBtn.classList.remove('active');
      delete panelReaderBtn.dataset.readerActive;
    });
  }

  // Dismiss library panel or settings on click outside
  overlay.addEventListener('click', (e) => {
    if (libraryPanel.classList.contains('open') && !libraryPanel.contains(e.target) && !libraryBtn.contains(e.target)) {
      closeLibrary();
    }
    if (settingsOpen && !settingsPanel.contains(e.target)) {
      setSettingsOpen(false);
    }
  });

  // Keyboard handler:
  //   Escape — close library first, then settings, then the whole reader.
  //   Tab    — focus trap: cycle within the overlay + the optional settings trigger button.
  function onKeydown(e) {
    if (e.key === 'Escape') {
      if (libraryPanel.classList.contains('open')) {
        closeLibrary();
      } else if (settingsOpen) { setSettingsOpen(false); } else { closeReaderMode(); }
      return;
    }
    if (e.key === 'Tab') {
      // Build (or recall) focusable list. Don't cache when settings or library is
      // open — buttons may become disabled or the scope changes.
      let all = _focusableCache;
      if (!all) {
        const sel = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const libraryIsOpen = libraryPanel.classList.contains('open');
        let insideOverlay;
        if (libraryIsOpen) {
          // Restrict focus to the library panel only while it is visible.
          insideOverlay = Array.from(libraryPanel.querySelectorAll(sel));
        } else {
          insideOverlay = Array.from(overlay.querySelectorAll(sel))
            .filter(el => settingsOpen || !settingsPanel.contains(el));
        }
        all = (panelReaderBtn?.isConnected && !settingsOpen && !libraryIsOpen)
          ? [...insideOverlay, panelReaderBtn]
          : insideOverlay;
        if (!settingsOpen && !libraryIsOpen) _focusableCache = all;
      }
      if (all.length < 2) return;
      const first = all[0];
      const last  = all[all.length - 1];
      const activeEl = shadowRoot.activeElement || document.activeElement;
      if (e.shiftKey && activeEl === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault(); first.focus();
      }
    }
  }
  document.addEventListener('keydown', onKeydown);
  cleanupFns.push(() => document.removeEventListener('keydown', onKeydown));

  // Reposition the settings popup on viewport resize (e.g. sidebar open/close)
  // so it stays adjacent to the floating panel button.
  function onResize() {
    if (settingsOpen) positionSettingsPopup(settingsPanel, panelReaderBtn);
  }
  window.addEventListener('resize', onResize);
  cleanupFns.push(() => window.removeEventListener('resize', onResize));

  shadowHost._cleanupFns   = cleanupFns;
  shadowHost._savedScrollY = savedScrollY;

  closeBtn.addEventListener('click', closeReaderMode);
}

function closeReaderMode() {
  const overlay = document.getElementById(READER_OVERLAY_ID);
  if (!overlay) return;
  // Save reading position before teardown so it's available on next open.
  // Skip when a library article is displayed — _readerBody is the library article's
  // DOM, so findReadingIndex would return an index into the wrong document and corrupt
  // the live page's stored reading position.
  const scrollEl = overlay._scrollEl || overlay;
  if (!_libraryArticleLoaded) saveReaderState(state => { state.readingIndex = findReadingIndex(scrollEl); });
  // Flush cleanup immediately: restores the panel button and removes event listeners.
  // The overlay stays in the DOM briefly for the fade-out animation.
  overlay._cleanupFns?.forEach(fn => fn());
  _readerBody = null;
  _readerStates = null;
  _articleHtml = null;
  _articleMeta = null;
  _libraryArticleLoaded = false;
  _libraryArticleUrl = null;
  _liveArticleSnapshot = null;
  // Cancel any in-flight sync-bookmark promotion. The IIFE in openReaderMode
  // checks this flag after its storage await; without this, it would proceed and
  // crash accessing _articleMeta.title (null) — silently caught, but wrong.
  _promoteSuppressed = true;

  // Restore page-mode summary before notifying the sidebar.
  SUMMARY_STATE.points = _pageSummaryBackup?.points || [];
  SUMMARY_STATE.elements = _pageSummaryBackup?.elements || [];
  _pageSummaryBackup = null;
  // Clear highlight state — any highlight run inside reader mode holds refs to
  // now-detached reader DOM nodes. Page-mode highlights are also invalid since
  // they were computed before reader mode replaced the visible content.
  HIGHLIGHT_STATE.elements = null;
  HIGHLIGHT_STATE.items = null;

  // Restore html/body overflow to whatever it was before reader mode.
  // removeProperty + conditional re-set handles both !important and normal values.
  const [htmlOv, htmlPri] = overlay._savedHtmlOverflow || ['', ''];
  document.documentElement.style.removeProperty('overflow');
  if (htmlOv) document.documentElement.style.setProperty('overflow', htmlOv, htmlPri);
  const [bodyOv, bodyPri] = overlay._savedBodyOverflow || ['', ''];
  document.body.style.removeProperty('overflow');
  if (bodyOv) document.body.style.setProperty('overflow', bodyOv, bodyPri);
  window.scrollTo(0, overlay._savedScrollY ?? 0);
  browser.runtime.sendMessage({ action: 'readerModeChanged', active: false }).catch(() => {});
  // If the float button was hidden (global toggle or site block) while reader
  // mode was open, apply the deferred removal now that reader mode has exited.
  browser.storage.local.get([STORAGE_KEYS.SHOW_FLOAT_BTN, STORAGE_KEYS.BLOCKED_DOMAINS]).then(({ showFloatBtn, blockedDomains }) => {
    const siteBlocked = Array.isArray(blockedDomains) && blockedDomains.includes(location.hostname);
    if (showFloatBtn === false || siteBlocked) {
      panelGetById(FLOAT_BTN_ID)?.remove();
      panelGetById(READER_MODE_BTN_ID)?.remove();
      panelGetById(SCRATCHPAD_BTN_ID)?.remove();
      removePanelIfEmpty();
    }
  });
  overlay.classList.add('ai-closing');
  overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
}

