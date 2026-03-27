// content-reader.js — distraction-free reader mode overlay using Mozilla Readability
// Depends on: content-core.js, content-dom.js (filterTranslatableElements), content-translation.js (runTranslateElements)

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

function getReaderUrl() {
  return location.origin + location.pathname;
}

// Apply updater(urlEntry) to the current URL's state entry and persist.
function saveReaderState(updater) {
  if (!_readerStates) return;
  const url = getReaderUrl();
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
function findReadingIndex(overlay) {
  if (!_readerBody) return 0;
  const elements = getReaderPositionElements(_readerBody);
  if (!elements.length) return 0;
  const overlayRect = overlay.getBoundingClientRect();
  const threshold = overlayRect.top + 80;
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
  saveReaderState(state => { state.translations = translations; });
  attachTranslationToggleTracking(elements);
}

// Attach a secondary click listener to each toggle button that keeps the
// stored showing state in sync. Idempotent via data-toggle-tracked.
function attachTranslationToggleTracking(elements) {
  elements.forEach((el, idx) => {
    if (!el.dataset.aiWrapped) return;
    const btn = el.querySelector('.ai-toggle-btn');
    if (!btn || btn.dataset.toggleTracked) return;
    btn.dataset.toggleTracked = '1';
    btn.addEventListener('click', () => {
      const showing = el.classList.contains('show-translation');
      saveReaderState(state => {
        if (state.translations?.[idx]) state.translations[idx].showing = showing;
      });
    });
  });
}

function restoreReaderSummaryElements(summaryState, elements) {
  if (!summaryState?.points?.length) return [];
  const cachedTargets = Array.isArray(summaryState.targets) ? summaryState.targets : null;
  if (!cachedTargets?.length) return elements;

  const buckets = new Map();
  elements.forEach((item) => {
    const key = item.text;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  });

  return cachedTargets.map((text, index) => {
    const bucket = buckets.get(text);
    if (bucket?.length) return bucket.shift();
    return elements[index] || { el: null, text };
  });
}

// READER_ICON is defined in content-core.js
const CLOSE_ICON    = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const SETTINGS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`;

const FONT_SIZES    = [14, 15, 16, 17, 18, 20, 22, 24, 28]; // index 0–8, default 4 (18px)
const LINE_SPACINGS = [1.4, 1.6, 1.8, 2.0, 2.2];           // index 0–4, default 2 (1.8)
const WIDTHS = [
  { key: 'narrow', px: 480, msgKey: 'readerWidthNarrow' },
  { key: 'normal', px: 680, msgKey: 'readerWidthNormal' },
  { key: 'wide',   px: 860, msgKey: 'readerWidthWide'   },
];
const DEFAULT_PREFS = { theme: 'auto', fontSize: 4, lineSpacing: 2, width: 'normal' };

// --- Prefs helpers ---

async function loadReaderPrefs() {
  const { readerPrefs } = await browser.storage.local.get(STORAGE_KEYS.READER_PREFS);
  return { ...DEFAULT_PREFS, ...(readerPrefs || {}) };
}

function saveReaderPrefs(prefs) {
  browser.storage.local.set({ [STORAGE_KEYS.READER_PREFS]: prefs });
}

function resolveTheme(prefs) {
  if (prefs.theme !== 'auto') return prefs.theme;
  return isThemeDark(_cachedTheme) ? 'dark' : 'light';
}

function applyPrefs(overlay, prefs) {
  overlay.dataset.readerTheme = resolveTheme(prefs);
  overlay.style.setProperty('--reader-font-size',   FONT_SIZES[prefs.fontSize] + 'px');
  overlay.style.setProperty('--reader-line-height', String(LINE_SPACINGS[prefs.lineSpacing]));
  overlay.style.setProperty('--reader-width',       (WIDTHS.find(w => w.key === prefs.width)?.px ?? 680) + 'px');
}

// Re-resolve auto theme when the sidebar/system theme changes.
// Registered as a hook so content-core.js does not depend on this module.
async function refreshReaderTheme() {
  const overlay = document.getElementById(READER_OVERLAY_ID);
  if (!overlay) return;
  const prefs = await loadReaderPrefs();
  if (prefs.theme !== 'auto') return;
  overlay.dataset.readerTheme = resolveTheme(prefs);
}

onThemeChange(refreshReaderTheme);

function collectReaderElements(scope) {
  // Omits td/figcaption/dd — Readability strips layout tables and most captions.
  const candidates = scope.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote, li');
  return filterTranslatableElements(candidates);
}

// contentEl: the #ai-reader-content element, needed so width changes trigger its CSS transition.
function buildSettingsPanel(overlay, prefs, contentEl) {
  const panel = document.createElement('div');
  panel.id = READER_SETTINGS_ID;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', browser.i18n.getMessage('readerSettings') || 'Reading settings');

  const themeLabel = document.createElement('div');
  themeLabel.className = 'ai-rs-section-label';
  themeLabel.textContent = browser.i18n.getMessage('readerThemeLabel') || 'Theme';

  const themeRow = makeRow();
  // Display initials so buttons are visually distinguishable without relying on color alone.
  const THEMES = [
    { key: 'auto',  msgKey: 'readerThemeAuto',  glyph: null       },
    { key: 'light', msgKey: 'readerThemeLight', glyph: 'L'        },
    { key: 'sepia', msgKey: 'readerThemeSepia', glyph: 'S'        },
    { key: 'dark',  msgKey: 'readerThemeDark',  glyph: 'D'        },
  ];
  const themeBtns = THEMES.map(({ key, msgKey, glyph }) => {
    const label = browser.i18n.getMessage(msgKey) || msgKey;
    const btn = document.createElement('button');
    btn.className = 'ai-rs-theme-btn';
    btn.dataset.theme = key;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', prefs.theme === key ? 'true' : 'false');
    // Colors are handled by CSS [data-theme] rules — no inline styles needed.
    btn.textContent = glyph ?? label;
    if (prefs.theme === key) btn.classList.add('active');
    btn.addEventListener('click', () => {
      prefs.theme = key;
      applyPrefs(overlay, prefs);
      themeBtns.forEach(b => {
        const isActive = b.dataset.theme === key;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
      saveReaderPrefs(prefs);
    });
    return btn;
  });
  themeBtns.forEach(b => themeRow.appendChild(b));

  const { row: fontRow, minus: fontMinus, val: fontVal, plus: fontPlus } =
    makeStepper(browser.i18n.getMessage('readerFontLabel') || 'Font', FONT_SIZES[prefs.fontSize] + 'px');
  fontMinus.disabled = prefs.fontSize === 0;
  fontPlus.disabled  = prefs.fontSize === FONT_SIZES.length - 1;
  holdRepeat(fontMinus, () => {
    if (prefs.fontSize === 0) return;
    prefs.fontSize--;
    fontVal.textContent = FONT_SIZES[prefs.fontSize] + 'px';
    fontMinus.disabled  = prefs.fontSize === 0;
    fontPlus.disabled   = false;
    applyPrefs(overlay, prefs); saveReaderPrefs(prefs);
  });
  holdRepeat(fontPlus, () => {
    if (prefs.fontSize === FONT_SIZES.length - 1) return;
    prefs.fontSize++;
    fontVal.textContent = FONT_SIZES[prefs.fontSize] + 'px';
    fontPlus.disabled   = prefs.fontSize === FONT_SIZES.length - 1;
    fontMinus.disabled  = false;
    applyPrefs(overlay, prefs); saveReaderPrefs(prefs);
  });

  const { row: spacingRow, minus: spacingMinus, val: spacingVal, plus: spacingPlus } =
    makeStepper(browser.i18n.getMessage('readerSpacingLabel') || 'Spacing', LINE_SPACINGS[prefs.lineSpacing] + '×');
  spacingMinus.disabled = prefs.lineSpacing === 0;
  spacingPlus.disabled  = prefs.lineSpacing === LINE_SPACINGS.length - 1;
  holdRepeat(spacingMinus, () => {
    if (prefs.lineSpacing === 0) return;
    prefs.lineSpacing--;
    spacingVal.textContent = LINE_SPACINGS[prefs.lineSpacing] + '×';
    spacingMinus.disabled  = prefs.lineSpacing === 0;
    spacingPlus.disabled   = false;
    applyPrefs(overlay, prefs); saveReaderPrefs(prefs);
  });
  holdRepeat(spacingPlus, () => {
    if (prefs.lineSpacing === LINE_SPACINGS.length - 1) return;
    prefs.lineSpacing++;
    spacingVal.textContent = LINE_SPACINGS[prefs.lineSpacing] + '×';
    spacingPlus.disabled   = prefs.lineSpacing === LINE_SPACINGS.length - 1;
    spacingMinus.disabled  = false;
    applyPrefs(overlay, prefs); saveReaderPrefs(prefs);
  });

  const widthRow = makeRow();
  const widthBtns = WIDTHS.map(({ key, px, msgKey }) => {
    const label = browser.i18n.getMessage(msgKey) || key;
    const btn = document.createElement('button');
    btn.className = 'ai-rs-width-btn';
    btn.dataset.width = key;
    btn.textContent = label;
    btn.setAttribute('aria-pressed', prefs.width === key ? 'true' : 'false');
    if (prefs.width === key) btn.classList.add('active');
    btn.addEventListener('click', () => {
      prefs.width = key;
      applyPrefs(overlay, prefs);
      // Set maxWidth directly on the content element so the CSS transition fires.
      // (CSS transitions do not animate through custom property changes.)
      if (contentEl) contentEl.style.maxWidth = px + 'px';
      widthBtns.forEach(b => {
        const isActive = b.dataset.width === key;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
      saveReaderPrefs(prefs);
    });
    return btn;
  });
  widthBtns.forEach(b => widthRow.appendChild(b));

  panel.append(themeLabel, themeRow, fontRow, spacingRow, widthRow);
  return panel;
}

function positionSettingsPopup(popup, anchorEl) {
  const POPUP_W = 220;
  const GAP     = 24; // box-shadow blur is 32px; 24px gives ~8px clear visual gap after shadow
  const MARGIN  = 8;
  // Read max-height from the CSS custom property so JS and CSS stay in sync automatically.
  const SETTINGS_MAX_H = parseInt(getComputedStyle(popup).getPropertyValue('--reader-settings-max-h')) || 280;

  let anchorTop, anchorLeft, anchorRight;
  if (anchorEl) {
    const r = anchorEl.getBoundingClientRect();
    anchorTop   = r.top;
    anchorLeft  = r.left;
    anchorRight = r.right;
  } else {
    // No anchor available — center near top-right of screen
    anchorTop   = MARGIN;
    anchorLeft  = window.innerWidth / 2;
    anchorRight = window.innerWidth / 2;
  }

  const fitsLeft = anchorLeft - GAP - POPUP_W >= MARGIN;
  const left = fitsLeft
    ? anchorLeft - GAP - POPUP_W
    : Math.min(anchorRight + GAP, window.innerWidth - POPUP_W - MARGIN);

  // Clamp top synchronously using the CSS max-height constant — no rAF needed.
  const rawTop = anchorTop;
  const top = rawTop + SETTINGS_MAX_H > window.innerHeight - MARGIN
    ? Math.max(MARGIN, window.innerHeight - SETTINGS_MAX_H - MARGIN)
    : rawTop;

  // Set transform-origin before the caller adds .open so the scale animation
  // starts from the correct corner.
  popup.style.transformOrigin = fitsLeft ? 'top right' : 'top left';
  popup.style.left   = left + 'px';
  popup.style.top    = top + 'px';
  popup.style.right  = 'auto';
  popup.style.bottom = 'auto';
}

function makeRow() {
  const row = document.createElement('div');
  row.className = 'ai-rs-row';
  return row;
}

function makeStepper(label, initialVal) {
  const row = makeRow();
  const lbl = document.createElement('span');
  lbl.className = 'ai-rs-stepper-label';
  lbl.textContent = label;
  const minus = document.createElement('button');
  minus.className = 'ai-rs-step-btn';
  minus.textContent = '−';
  minus.setAttribute('aria-label', `${label} decrease`);
  const val = document.createElement('span');
  val.className = 'ai-rs-stepper-val';
  val.textContent = initialVal;
  const plus = document.createElement('button');
  plus.className = 'ai-rs-step-btn';
  plus.textContent = '+';
  plus.setAttribute('aria-label', `${label} increase`);
  row.append(lbl, minus, val, plus);
  return { row, minus, val, plus };
}

// Attach hold-to-repeat behaviour to a stepper button.
// Fires action() once on press, then repeatedly after 400ms delay at 80ms intervals.
function holdRepeat(btn, action) {
  let repeatTimer = null;
  let intervalTimer = null;

  function start() {
    action();
    repeatTimer = setTimeout(() => {
      intervalTimer = setInterval(action, 80);
    }, 400);
  }

  function stop() {
    clearTimeout(repeatTimer);
    clearInterval(intervalTimer);
    repeatTimer = null;
    intervalTimer = null;
  }

  btn.addEventListener('mousedown', start);
  btn.addEventListener('touchstart', start, { passive: true });
  btn.addEventListener('mouseup', stop);
  btn.addEventListener('mouseleave', stop);
  btn.addEventListener('touchend', stop);
  btn.addEventListener('touchcancel', stop);
}

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

  let article, prefs, urlState;
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
    const { readerStates } = await browser.storage.local.get(STORAGE_KEYS.READER_STATES);
    _readerStates = readerStates || {};
    urlState = _readerStates[getReaderUrl()] || {};
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

  const overlay = document.createElement('div');
  overlay.id = READER_OVERLAY_ID;
  overlay.tabIndex = -1; // focusable but not in tab order; allows Space/PageDown to scroll
  applyPrefs(overlay, prefs);

  const closeBtn = document.createElement('button');
  closeBtn.id = 'ai-reader-close-btn';
  closeBtn.replaceChildren(_svgParser.parseFromString(CLOSE_ICON, 'image/svg+xml').documentElement);
  const exitLabel = browser.i18n.getMessage('exitReader') || 'Exit reader';
  closeBtn.title = exitLabel;
  closeBtn.setAttribute('aria-label', exitLabel);

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
  const articleDoc = new DOMParser().parseFromString(article.content, 'text/html');
  articleDoc.querySelectorAll('script, style').forEach(el => el.remove());
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
  const settingsPanel = buildSettingsPanel(overlay, prefs, content);

  // settingsPanel is position:fixed but inside overlay so it inherits CSS theme vars
  overlay.append(closeBtn, settingsPanel, content);

  // Save scroll position before locking the page so we can restore it on close.
  const savedScrollY = window.scrollY;
  document.body.appendChild(overlay);
  document.documentElement.style.overflow = 'hidden';

  // Swap to reader-mode summary instance before notifying the sidebar.
  _pageSummaryBackup = {
    points: Array.isArray(SUMMARY_STATE.points) ? SUMMARY_STATE.points.slice() : [],
    elements: Array.isArray(SUMMARY_STATE.elements) ? SUMMARY_STATE.elements.slice() : []
  };
  SUMMARY_STATE.points = urlState.summary?.points || [];
  // Restore live DOM refs for cached reader summaries using the original
  // reader text collected before translation wrappers are reapplied.
  SUMMARY_STATE.elements = restoreReaderSummaryElements(urlState.summary, summaryElements);

  browser.runtime.sendMessage({ action: 'readerModeChanged', active: true }).catch(() => {});

  // Focus the overlay scroll container so Space/PageDown scroll the article.
  // The close button and settings remain reachable via Tab (focus trap below).
  overlay.focus();

  // Restore last reading position (element-index-based, survives font/width changes).
  // Uses getReaderPositionElements — stable regardless of translation state.
  if (urlState.readingIndex != null) {
    const target = getReaderPositionElements(body)[urlState.readingIndex];
    if (target) {
      requestAnimationFrame(() => {
        const overlayRect = overlay.getBoundingClientRect();
        const elRect = target.getBoundingClientRect();
        overlay.scrollTop = elRect.top - overlayRect.top - 16;
      });
    }
  }

  // Collect teardown callbacks — flushed immediately on close, before the fade-out.
  const cleanupFns = [];

  // Persist reading position on scroll (debounced) so it survives crashes/unloads.
  let _scrollSaveTimer = null;
  overlay.addEventListener('scroll', () => {
    clearTimeout(_scrollSaveTimer);
    _scrollSaveTimer = setTimeout(() => {
      saveReaderState(state => { state.readingIndex = findReadingIndex(overlay); });
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

  // Dismiss settings popup on click outside
  overlay.addEventListener('click', (e) => {
    if (settingsOpen && !settingsPanel.contains(e.target)) {
      setSettingsOpen(false);
    }
  });

  // Keyboard handler:
  //   Escape — close settings panel first; close the whole reader only if settings is already closed.
  //   Tab    — focus trap: cycle within the overlay + the optional settings trigger button.
  function onKeydown(e) {
    if (e.key === 'Escape') {
      if (settingsOpen) { setSettingsOpen(false); } else { closeReaderMode(); }
      return;
    }
    if (e.key === 'Tab') {
      // Build (or recall) focusable list. Don't cache when settings is open —
      // stepper buttons may become disabled (min/max reached) during that session,
      // which would make a cached list stale.
      let all = _focusableCache;
      if (!all) {
        const sel = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const insideOverlay = Array.from(overlay.querySelectorAll(sel))
          .filter(el => settingsOpen || !settingsPanel.contains(el));
        all = (panelReaderBtn?.isConnected && !settingsOpen)
          ? [...insideOverlay, panelReaderBtn]
          : insideOverlay;
        if (!settingsOpen) _focusableCache = all;
      }
      if (all.length < 2) return;
      const first = all[0];
      const last  = all[all.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
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

  overlay._cleanupFns   = cleanupFns;
  overlay._savedScrollY = savedScrollY;

  closeBtn.addEventListener('click', closeReaderMode);
}

function closeReaderMode() {
  const overlay = document.getElementById(READER_OVERLAY_ID);
  if (!overlay) return;
  // Save reading position before teardown so it's available on next open.
  saveReaderState(state => { state.readingIndex = findReadingIndex(overlay); });
  // Flush cleanup immediately: restores the panel button and removes event listeners.
  // The overlay stays in the DOM briefly for the fade-out animation.
  overlay._cleanupFns?.forEach(fn => fn());
  _readerBody = null;
  _readerStates = null;

  // Restore page-mode summary before notifying the sidebar.
  SUMMARY_STATE.points = _pageSummaryBackup?.points || [];
  SUMMARY_STATE.elements = _pageSummaryBackup?.elements || [];
  _pageSummaryBackup = null;

  document.documentElement.style.overflow = '';
  window.scrollTo(0, overlay._savedScrollY ?? 0);
  browser.runtime.sendMessage({ action: 'readerModeChanged', active: false }).catch(() => {});
  // If the float button was hidden (global toggle or site block) while reader
  // mode was open, apply the deferred removal now that reader mode has exited.
  browser.storage.local.get([STORAGE_KEYS.SHOW_FLOAT_BTN, STORAGE_KEYS.BLOCKED_DOMAINS]).then(({ showFloatBtn, blockedDomains }) => {
    const siteBlocked = Array.isArray(blockedDomains) && blockedDomains.includes(location.hostname);
    if (showFloatBtn === false || siteBlocked) {
      document.getElementById(FLOAT_BTN_ID)?.remove();
      document.getElementById(READER_MODE_BTN_ID)?.remove();
      document.getElementById(SCRATCHPAD_BTN_ID)?.remove();
      removePanelIfEmpty();
    }
  });
  overlay.classList.add('ai-closing');
  overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
}
