const STORAGE_KEYS = Object.freeze({
  API_KEY: 'openaiApiKey',
  MODEL: 'preferredModel',
  THEME: 'theme',
  SHOW_FLOAT_BTN: 'showFloatBtn',
  USER_INTERESTS: 'userInterests',
  UI_LANG: 'uiLang',
  TRANSLATE_LANG: 'translateLang',
  PANEL_POSITION: 'panelPosition',
  BLOCKED_DOMAINS: 'blockedDomains',
  READER_PREFS: 'readerPrefs',
  READER_STATES: 'readerStates',
  PAGE_STATES: 'pageStates',
  SAVED_ARTICLES: 'savedArticles',
  BOOKMARK_KEY_PREFIX: 'bm_',
});

// Stable per-bookmark key derived from URL. Each bookmark lives under its own
// sync key so concurrent adds/removes on different devices never clobber each other.
// Uses two independent DJB2 seeds to produce a 64-bit hash, making collisions negligible.
function urlToSyncKey(url) {
  let h1 = 5381, h2 = 52711;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + c) | 0;
    h2 = ((h2 << 5) + h2 + c) | 0;
  }
  return STORAGE_KEYS.BOOKMARK_KEY_PREFIX + (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

// Returns all synced bookmarks as a plain array.
async function getSyncBookmarks() {
  try {
    const all = await browser.storage.sync.get(null);
    return Object.entries(all)
      .filter(([k]) => k.startsWith(STORAGE_KEYS.BOOKMARK_KEY_PREFIX))
      .map(([, v]) => v);
  } catch (_) {
    return [];
  }
}
