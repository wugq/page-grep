// content-init.js — bootstrap: initial storage read, message listener, storage change listener
// Loaded last; depends on all other content modules.

// --- Message listener ---

browser.runtime.onMessage.addListener((message) => {
  if (message.action === 'getSummaryData') {
    return Promise.resolve({ points: SUMMARY_STATE.points || [] });
  }

  if (message.action === 'getHighlightData') {
    return Promise.resolve({ items: HIGHLIGHT_STATE.items || [] });
  }

  if (message.action === 'getReaderModeState') {
    return Promise.resolve({ active: !!getActiveReaderBody() });
  }

  if (message.action === 'summaryHover') {
    const target = SUMMARY_STATE.elements?.[message.index]?.el;
    if (target?.isConnected) {
      clearAllHighlights();
      hoverElement(target, 'summary');
    }
    return;
  }

  if (message.action === 'summaryUnhover') {
    clearAllHighlights();
    return;
  }

  if (message.action === 'summaryClick') {
    const target = SUMMARY_STATE.elements?.[message.index]?.el;
    if (target?.isConnected) {
      log(`[PageGrep] summary item clicked (sidebar): index ${message.index}`);
      clearAllHighlights();
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flashElement(target, 'summary');
    }
    return;
  }

  if (message.action === 'runSummary') {
    runSummaryFromPage();
    return;
  }

  if (message.action === 'runHighlight') {
    runInterestingFromPage();
    return;
  }

  if (message.action === 'highlightHover') {
    const target = HIGHLIGHT_STATE.elements?.[message.index]?.el;
    if (target?.isConnected) hoverElement(target, 'highlight');
    return;
  }

  if (message.action === 'highlightUnhover') {
    const target = HIGHLIGHT_STATE.elements?.[message.index]?.el;
    if (target?.isConnected) unhoverElement(target);
    return;
  }

  if (message.action === 'highlightClick') {
    const target = HIGHLIGHT_STATE.elements?.[message.index]?.el;
    if (target?.isConnected) {
      log(`[PageGrep] interesting item clicked (sidebar): index ${message.index}`);
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flashElement(target, 'highlight');
    }
    return;
  }
});

// --- Initialization ---

log('[PageGrep] content script loaded', location.href);
browser.storage.local.get([STORAGE_KEYS.SHOW_FLOAT_BTN, STORAGE_KEYS.BLOCKED_DOMAINS, STORAGE_KEYS.THEME]).then(async ({ showFloatBtn, blockedDomains, theme }) => {
  _cachedTheme = theme;
  await applyI18nOverride();
  const blocked = Array.isArray(blockedDomains) ? blockedDomains : [];
  if (!blocked.includes(location.hostname)) {
    selectionTranslateEnabled = true;
  }
  if (showFloatBtn !== false && !blocked.includes(location.hostname)) {
    createFloatButton();
  }
});

// Handle system theme changes if no explicit preference is set
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => {
  const { theme } = await browser.storage.local.get(STORAGE_KEYS.THEME);
  if (!theme) applyThemeToPanel();
});

browser.storage.onChanged.addListener((changes) => {
  if (STORAGE_KEYS.SHOW_FLOAT_BTN in changes) {
    const show = changes[STORAGE_KEYS.SHOW_FLOAT_BTN].newValue !== false;
    if (show) {
      browser.storage.local.get(STORAGE_KEYS.BLOCKED_DOMAINS).then(({ blockedDomains }) => {
        const blocked = Array.isArray(blockedDomains) ? blockedDomains : [];
        if (!blocked.includes(location.hostname)) {
          createFloatButton();
        }
      });
    } else if (!getActiveReaderBody()) {
      document.getElementById(FLOAT_BTN_ID)?.remove();
      document.getElementById('ai-reader-mode-btn')?.remove();
      document.getElementById('ai-scratchpad-btn')?.remove();
      clearAllHighlights();
      removePanelIfEmpty();
    }
  }
  if (STORAGE_KEYS.BLOCKED_DOMAINS in changes) {
    const blocked = Array.isArray(changes[STORAGE_KEYS.BLOCKED_DOMAINS].newValue)
      ? changes[STORAGE_KEYS.BLOCKED_DOMAINS].newValue : [];
    if (blocked.includes(location.hostname)) {
      selectionTranslateEnabled = false;
      document.getElementById(FLOAT_BTN_ID)?.remove();
      document.getElementById('ai-reader-mode-btn')?.remove();
      document.getElementById('ai-scratchpad-btn')?.remove();
      clearAllHighlights();
      removePanelIfEmpty();
    } else {
      selectionTranslateEnabled = true;
      browser.storage.local.get(STORAGE_KEYS.SHOW_FLOAT_BTN).then(({ showFloatBtn }) => {
        if (showFloatBtn !== false) {
          createFloatButton();
        }
      });
    }
  }
  if (STORAGE_KEYS.THEME in changes) {
    _cachedTheme = changes[STORAGE_KEYS.THEME].newValue;
    applyThemeToPanel();
  }
  if (STORAGE_KEYS.UI_LANG in changes) {
    applyI18nOverride();
  }
});
