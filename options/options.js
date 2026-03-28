
function renderBlockedDomains(domains) {
  const list = document.getElementById('blocked-domains-list');
  if (!list) return;
  list.innerHTML = '';
  if (!domains || domains.length === 0) {
    const empty = document.createElement('span');
    empty.id = 'blocked-domains-empty';
    empty.textContent = browser.i18n.getMessage('noBlockedDomains') || 'No blocked domains';
    list.appendChild(empty);
    return;
  }
  domains.forEach(domain => {
    const tag = document.createElement('span');
    tag.className = 'domain-tag';
    tag.appendChild(document.createTextNode(domain));
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '×';
    removeBtn.title = browser.i18n.getMessage('removeDomain') || 'Remove';
    removeBtn.addEventListener('click', async () => {
      const { blockedDomains } = await browser.storage.local.get(STORAGE_KEYS.BLOCKED_DOMAINS);
      const updated = (Array.isArray(blockedDomains) ? blockedDomains : []).filter(d => d !== domain);
      await browser.storage.local.set({ [STORAGE_KEYS.BLOCKED_DOMAINS]: updated });
      renderBlockedDomains(updated);
    });
    tag.appendChild(removeBtn);
    list.appendChild(tag);
  });
}

let _loadedUiLang = '';

async function loadSettings() {
  const s = await browser.storage.local.get([
    STORAGE_KEYS.API_KEY, STORAGE_KEYS.MODEL, STORAGE_KEYS.THEME, STORAGE_KEYS.SHOW_FLOAT_BTN,
    STORAGE_KEYS.UI_LANG, STORAGE_KEYS.TRANSLATE_LANG, STORAGE_KEYS.BLOCKED_DOMAINS
  ]);

  if (s[STORAGE_KEYS.API_KEY]) document.getElementById('api-key').value = s[STORAGE_KEYS.API_KEY];
  if (s[STORAGE_KEYS.MODEL]) document.getElementById('model-select').value = s[STORAGE_KEYS.MODEL];
  document.getElementById('theme-select').value = s[STORAGE_KEYS.THEME] || 'light';
  _loadedUiLang = s[STORAGE_KEYS.UI_LANG] || '';
  document.getElementById('language-select').value = _loadedUiLang;
  document.getElementById('translate-lang-select').value = s[STORAGE_KEYS.TRANSLATE_LANG] || 'zh-CN';

  const floatCheckbox = document.getElementById('show-float-btn');
  if (floatCheckbox) floatCheckbox.checked = s[STORAGE_KEYS.SHOW_FLOAT_BTN] !== false;

  renderBlockedDomains(Array.isArray(s[STORAGE_KEYS.BLOCKED_DOMAINS]) ? s[STORAGE_KEYS.BLOCKED_DOMAINS] : []);
}

function showStatus(message, type) {
  const statusEl = document.getElementById('save-status');
  statusEl.textContent = message;
  statusEl.className = type;
  statusEl.classList.remove('hidden');
  setTimeout(() => statusEl.classList.add('hidden'), 3000);
}

document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const apiKey = document.getElementById('api-key').value.trim();
  const model = document.getElementById('model-select').value;
  const theme = document.getElementById('theme-select').value;
  const showFloatBtn = document.getElementById('show-float-btn').checked;
  const uiLang = document.getElementById('language-select').value;
  const translateLang = document.getElementById('translate-lang-select').value;

  if (!apiKey) {
    showStatus(browser.i18n.getMessage('enterApiKey'), 'error');
    return;
  }

  if (!apiKey.startsWith('sk-')) {
    showStatus(browser.i18n.getMessage('invalidApiKey'), 'error');
    return;
  }

  try {
    const prevLang = _loadedUiLang;
    await browser.storage.local.set({
      [STORAGE_KEYS.API_KEY]: apiKey,
      [STORAGE_KEYS.MODEL]: model,
      [STORAGE_KEYS.THEME]: theme || 'light',
      [STORAGE_KEYS.SHOW_FLOAT_BTN]: showFloatBtn,
      [STORAGE_KEYS.UI_LANG]: uiLang || null,
      [STORAGE_KEYS.TRANSLATE_LANG]: translateLang || null,
    });
    if (uiLang !== prevLang) {
      location.reload();
      return;
    }
    showStatus(browser.i18n.getMessage('settingsSaved'), 'success');
  } catch (err) {
    showStatus(browser.i18n.getMessage('saveFailed') + err.message, 'error');
  }
});

document.getElementById('clear-btn').addEventListener('click', async () => {
  if (!confirm(browser.i18n.getMessage('confirmClear'))) return;

  await browser.storage.local.remove([
    STORAGE_KEYS.API_KEY, STORAGE_KEYS.MODEL, STORAGE_KEYS.THEME,
    STORAGE_KEYS.SHOW_FLOAT_BTN, STORAGE_KEYS.USER_INTERESTS, STORAGE_KEYS.UI_LANG, STORAGE_KEYS.TRANSLATE_LANG,
    STORAGE_KEYS.BLOCKED_DOMAINS, STORAGE_KEYS.PANEL_POSITION,
    STORAGE_KEYS.READER_PREFS, STORAGE_KEYS.READER_STATES, STORAGE_KEYS.PAGE_STATES
  ]);
  document.getElementById('api-key').value = '';
  document.getElementById('model-select').value = 'gpt-4o-mini';
  document.getElementById('theme-select').value = 'light';
  document.getElementById('language-select').value = '';
  document.getElementById('translate-lang-select').value = 'zh-CN';
  document.getElementById('show-float-btn').checked = true;
  renderBlockedDomains([]);
  showStatus(browser.i18n.getMessage('settingsCleared'), 'success');
});

document.getElementById('clear-translations-btn').addEventListener('click', async () => {
  if (!confirm(browser.i18n.getMessage('confirmClearTranslations') || 'Clear all cached translations? Your saved articles and settings will not be affected.')) return;
  // Strip translations from READER_STATES, preserving scroll/summary
  const { readerStates } = await browser.storage.local.get(STORAGE_KEYS.READER_STATES);
  if (readerStates && typeof readerStates === 'object') {
    for (const url of Object.keys(readerStates)) {
      delete readerStates[url].translations;
    }
    await browser.storage.local.set({ [STORAGE_KEYS.READER_STATES]: readerStates });
  }
  // Strip translations from SAVED_ARTICLES
  const { savedArticles } = await browser.storage.local.get(STORAGE_KEYS.SAVED_ARTICLES);
  if (Array.isArray(savedArticles)) {
    savedArticles.forEach(a => { a.translations = {}; });
    await browser.storage.local.set({ [STORAGE_KEYS.SAVED_ARTICLES]: savedArticles });
  }
  showStatus(browser.i18n.getMessage('translationsClearedStatus') || 'Translation cache cleared.', 'success');
});

document.getElementById('toggle-visibility').addEventListener('click', () => {
  const input = document.getElementById('api-key');
  input.type = input.type === 'password' ? 'text' : 'password';
});

browser.storage.onChanged.addListener((changes) => {
  if (STORAGE_KEYS.THEME in changes) {
    document.getElementById('theme-select').value = changes[STORAGE_KEYS.THEME].newValue || 'light';
  }
  if (STORAGE_KEYS.SHOW_FLOAT_BTN in changes) {
    document.getElementById('show-float-btn').checked = changes[STORAGE_KEYS.SHOW_FLOAT_BTN].newValue !== false;
  }
  if (STORAGE_KEYS.BLOCKED_DOMAINS in changes) {
    const domains = Array.isArray(changes[STORAGE_KEYS.BLOCKED_DOMAINS].newValue)
      ? changes[STORAGE_KEYS.BLOCKED_DOMAINS].newValue : [];
    renderBlockedDomains(domains);
  }
});

(window.i18nReady || Promise.resolve()).then(() => loadSettings().catch(console.error));

// --- Tab switching ---
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'library') libraryRefresh();
  });
});

// --- Library tab ---

async function libraryRefresh() {
  const listEl  = document.getElementById('lib-list');
  const countEl = document.getElementById('lib-count');

  const [{ savedArticles }, syncList] = await Promise.all([
    browser.storage.local.get(STORAGE_KEYS.SAVED_ARTICLES),
    getSyncBookmarks(),
  ]);

  const locals       = Array.isArray(savedArticles) ? savedArticles : [];
  const localUrls    = new Set(locals.map(a => a.url));
  const syncedUrls   = new Set(syncList.map(b => b.url));
  const syncOnlyList = syncList.filter(b => !localUrls.has(b.url)).map(b => ({ ...b, _syncOnly: true }));
  const articles     = [...locals, ...syncOnlyList].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

  const total = articles.length;
  countEl.textContent = total === 0 ? '' : total === 1
    ? (browser.i18n.getMessage('libArticleCountOne') || '1 article')
    : (browser.i18n.getMessage('libArticleCountMany', [String(total)]) || `${total} articles`);
  document.getElementById('lib-clear-all').style.display = total === 0 ? 'none' : '';

  listEl.replaceChildren();

  if (total === 0) {
    const empty = document.createElement('div');
    empty.className = 'lib-empty';
    empty.textContent = browser.i18n.getMessage('savedArticlesEmpty') || 'No saved articles yet';
    listEl.appendChild(empty);
    return;
  }

  articles.forEach(article => {
    const isSyncOnly = !!article._syncOnly;
    const isSynced   = !isSyncOnly && syncedUrls.has(article.url);

    const card = document.createElement('div');
    card.className = 'lib-card';

    // Top row: title + delete button
    const top = document.createElement('div');
    top.className = 'lib-card-top';

    const titleEl = document.createElement('a');
    titleEl.className = 'lib-title';
    titleEl.href = article.url;
    titleEl.target = '_blank';
    titleEl.rel = 'noopener noreferrer';
    titleEl.textContent = article.title || article.url;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'lib-delete-btn';
    deleteBtn.textContent = '×';
    deleteBtn.title = browser.i18n.getMessage('removeDomain') || 'Remove';
    deleteBtn.addEventListener('click', async () => {
      if (!isSyncOnly) {
        const { savedArticles: cur } = await browser.storage.local.get(STORAGE_KEYS.SAVED_ARTICLES);
        const updated = (Array.isArray(cur) ? cur : [])
          .filter(a => !(a.url === article.url && a.savedAt === article.savedAt));
        await browser.storage.local.set({ [STORAGE_KEYS.SAVED_ARTICLES]: updated });
      }
      // Single atomic remove — safe even if both devices delete simultaneously.
      await browser.storage.sync.remove(urlToSyncKey(article.url)).catch(() => {});
      libraryRefresh();
    });

    top.append(titleEl, deleteBtn);
    card.appendChild(top);

    // Meta row: site · date · badge
    const meta = document.createElement('div');
    meta.className = 'lib-meta';

    const metaParts = [article.siteName, article.savedAt ? new Date(article.savedAt).toLocaleDateString() : null].filter(Boolean);
    if (metaParts.length) {
      const metaText = document.createElement('span');
      metaText.textContent = metaParts.join(' · ');
      meta.appendChild(metaText);
    }

    if (isSyncOnly) {
      const badge = document.createElement('span');
      badge.className = 'lib-badge lib-badge--sync';
      badge.textContent = browser.i18n.getMessage('libBadgeOtherDevice') || 'Other device';
      meta.appendChild(badge);
    } else if (isSynced) {
      const badge = document.createElement('span');
      badge.className = 'lib-badge lib-badge--synced';
      badge.textContent = browser.i18n.getMessage('libBadgeSynced') || 'Synced';
      meta.appendChild(badge);
    }

    card.appendChild(meta);
    listEl.appendChild(card);
  });
}

document.getElementById('lib-add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url   = document.getElementById('lib-add-url').value.trim();
  const title = document.getElementById('lib-add-title').value.trim();
  if (!url) return;
  try { new URL(url); } catch (_) { return; }
  const syncKey = urlToSyncKey(url);
  const existing = await browser.storage.sync.get(syncKey).catch(() => ({}));
  if (!existing[syncKey]) {
    await browser.storage.sync.set({ [syncKey]: { url, title: title || url, byline: null, siteName: null, savedAt: Date.now() } }).catch(() => {});
  }
  document.getElementById('lib-add-url').value   = '';
  document.getElementById('lib-add-title').value = '';
  libraryRefresh();
});

document.getElementById('lib-clear-all').addEventListener('click', async () => {
  if (!confirm(browser.i18n.getMessage('libClearAllConfirm') || 'Remove all saved articles? This cannot be undone.')) return;
  await browser.storage.local.set({ [STORAGE_KEYS.SAVED_ARTICLES]: [] });
  const allSync = await browser.storage.sync.get(null).catch(() => ({}));
  const bmKeys = Object.keys(allSync).filter(k => k.startsWith(STORAGE_KEYS.BOOKMARK_KEY_PREFIX));
  if (bmKeys.length) await browser.storage.sync.remove(bmKeys).catch(() => {});
  libraryRefresh();
});

