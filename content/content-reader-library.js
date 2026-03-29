// content-reader-library.js — article save/unsave, bookmark sync, and library panel UI
// Depends on: content-reader-settings.js (readerGetById, collectReaderElements, icons),
//             content-reader.js (shared state: _readerStates, _readerBody, _libraryArticleLoaded,
//               _libraryArticleUrl, _liveArticleSnapshot, _articleHtml, _articleMeta,
//               getReaderUrl, sanitiseArticleDoc, saveReaderState, attachTranslationToggleTracking),
//             content-core.js, content-collectors.js, content-translation.js (restoreTranslation)
// Must be loaded after content-reader.js (manifest.json load order is the contract).

async function syncAddBookmark(meta) {
  try {
    // Single atomic set — no read-modify-write, safe for concurrent devices.
    await browser.storage.sync.set({ [urlToSyncKey(meta.url)]: meta });
    // Best-effort: if we're over 40, drop the oldest entry.
    const all = await getSyncBookmarks();
    if (all.length > 40) {
      all.sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
      await browser.storage.sync.remove(urlToSyncKey(all[0].url));
    }
  } catch (_) { /* sync unavailable or quota exceeded — fail silently */ }
}

async function syncRemoveBookmark(url) {
  try {
    // Single atomic remove — no read-modify-write, safe for concurrent devices.
    await browser.storage.sync.remove(urlToSyncKey(url));
  } catch (_) { /* sync unavailable — fail silently */ }
}

let _savingInProgress = false;
let _promoteSuppressed = false;

function updateSaveBtn(btn, saved) {
  btn.replaceChildren(_svgParser.parseFromString(saved ? SAVED_ICON : SAVE_ICON, 'image/svg+xml').documentElement);
  const label = browser.i18n.getMessage(saved ? 'unsaveArticle' : 'saveForLater') || (saved ? 'Unsave article' : 'Save article');
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.classList.toggle('saved', saved);
}

async function onSaveBtnClick(btn) {
  if (_savingInProgress) return;
  _savingInProgress = true;
  try {
    // When a library article is loaded use its URL, otherwise use the live page URL.
    const url = _libraryArticleUrl || getReaderUrl();
    const syncKey = urlToSyncKey(url);
    const [{ savedArticles }, syncResult] = await Promise.all([
      browser.storage.local.get(STORAGE_KEYS.SAVED_ARTICLES),
      browser.storage.sync.get(syncKey).catch(() => ({})),
    ]);
    const articles = Array.isArray(savedArticles) ? savedArticles : [];
    const existingIdx = articles.findIndex(a => a.url === url);
    const inSync = !!syncResult[syncKey];

    if (existingIdx >= 0 || inSync) {
      _promoteSuppressed = true; // cancel any in-flight promoteFromSync for this URL
      if (existingIdx >= 0) {
        articles.splice(existingIdx, 1);
        await browser.storage.local.set({ [STORAGE_KEYS.SAVED_ARTICLES]: articles });
      }
      await syncRemoveBookmark(url);
      updateSaveBtn(btn, false);
      showToast(browser.i18n.getMessage('articleUnsaved') || 'Removed from saved');
    } else {
      if (!_articleHtml) return;
      const translations = _readerStates?.[url]?.translations || {};
      const savedAt = Date.now();
      const newArticle = {
        url,
        title: _articleMeta?.title || document.title,
        byline: _articleMeta?.byline || null,
        siteName: _articleMeta?.siteName || null,
        publishedTime: _articleMeta?.publishedTime || null,
        savedAt,
        html: _articleHtml,
        translations,
      };
      articles.unshift(newArticle);
      if (articles.length > 20) {
        articles.length = 20;
        showToast(browser.i18n.getMessage('libraryFull') || 'Library full — oldest article removed');
      } else {
        showToast(browser.i18n.getMessage('articleSaved') || 'Article saved');
      }
      await browser.storage.local.set({ [STORAGE_KEYS.SAVED_ARTICLES]: articles });
      await syncAddBookmark({ url, title: newArticle.title, byline: newArticle.byline, siteName: newArticle.siteName, savedAt });
      updateSaveBtn(btn, true);
    }
  } catch (err) {
    error('[PageGrep] onSaveBtnClick failed:', err.message);
    showToast(browser.i18n.getMessage('operationFailed') || 'Operation failed');
  } finally {
    _savingInProgress = false;
  }
}

// Build the slide-in library panel. onOpen(article) is called when the user
// picks an article; the panel closes itself beforehand.
function buildLibraryPanel(onOpen, onClose, onDelete) {
  const panel = document.createElement('div');
  panel.id = 'ai-reader-library';

  const header = document.createElement('div');
  header.className = 'ai-lib-header';
  const headerTitle = document.createElement('span');
  headerTitle.textContent = browser.i18n.getMessage('savedTab') || 'Saved';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'ai-lib-close-btn';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', browser.i18n.getMessage('closeLibrary') || 'Close');
  closeBtn.addEventListener('click', () => { if (onClose) onClose(); else panel.classList.remove('open'); });
  header.append(headerTitle, closeBtn);
  panel.appendChild(header);

  const listEl = document.createElement('div');
  listEl.className = 'ai-lib-list';
  panel.appendChild(listEl);

  async function refresh() {
    listEl.replaceChildren();
    const loadingEl = document.createElement('div');
    loadingEl.className = 'ai-lib-loading';
    listEl.appendChild(loadingEl);

    let articles;
    try {
      const [{ savedArticles }, syncBookmarks] = await Promise.all([
        browser.storage.local.get(STORAGE_KEYS.SAVED_ARTICLES),
        getSyncBookmarks(),
      ]);
      // Deduplicate by URL, keeping the most recently saved entry.
      const seen = new Set();
      const localArticles = (Array.isArray(savedArticles) ? savedArticles : [])
        .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
        .filter(a => { if (seen.has(a.url)) return false; seen.add(a.url); return true; });
      const localUrls = new Set(localArticles.map(a => a.url));
      const syncOnly = syncBookmarks
        .filter(b => !localUrls.has(b.url))
        .map(b => ({ ...b, _syncOnly: true }));
      articles = [...localArticles, ...syncOnly].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    } catch (err) {
      listEl.replaceChildren();
      const errorEl = document.createElement('div');
      errorEl.className = 'ai-lib-error';
      errorEl.textContent = browser.i18n.getMessage('operationFailed') || 'Failed to load saved articles';
      listEl.appendChild(errorEl);
      return;
    }

    listEl.replaceChildren();

    if (articles.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ai-lib-empty';
      empty.textContent = browser.i18n.getMessage('savedArticlesEmpty') || 'No saved articles yet';
      listEl.appendChild(empty);
      return;
    }

    const currentPageUrl = getReaderUrl();

    articles.forEach((article) => {
      const isCurrentPage = article.url === currentPageUrl;
      const isReading     = article.url === _libraryArticleUrl;
      const isSyncOnly    = !!article._syncOnly;

      const item = document.createElement('div');
      item.className = 'ai-lib-item';
      if (isCurrentPage) item.classList.add('ai-lib-item--current');
      if (isReading)     item.classList.add('ai-lib-item--reading');
      if (isSyncOnly)    item.classList.add('ai-lib-item--synced');

      // Clicking anywhere on the item opens it (except the delete button).
      // Sync-only items navigate to the URL; local items open in reader.
      item.addEventListener('click', (e) => {
        if (e.target.closest('.ai-lib-delete-btn')) return;
        if (isSyncOnly) {
          window.open(article.url, '_blank', 'noopener');
        } else {
          onOpen(article);
        }
      });

      const itemTop = document.createElement('div');
      itemTop.className = 'ai-lib-item-top';

      const titleEl = document.createElement('div');
      titleEl.className = 'ai-lib-title';
      titleEl.textContent = article.title || article.url;

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'ai-lib-delete-btn';
      deleteBtn.textContent = '×';
      deleteBtn.setAttribute('aria-label', browser.i18n.getMessage('deleteSavedArticle') || 'Remove article');
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (article._syncOnly) {
          await syncRemoveBookmark(article.url);
        } else {
          const { savedArticles: current } = await browser.storage.local.get(STORAGE_KEYS.SAVED_ARTICLES);
          const updated = (Array.isArray(current) ? current : [])
            .filter(a => !(a.url === article.url && a.savedAt === article.savedAt));
          await browser.storage.local.set({ [STORAGE_KEYS.SAVED_ARTICLES]: updated });
          await syncRemoveBookmark(article.url);
        }
        if (onDelete) onDelete(article);
        refresh();
      });

      itemTop.append(titleEl, deleteBtn);
      item.appendChild(itemTop);

      // Meta line: site · date · badges
      const metaEl = document.createElement('div');
      metaEl.className = 'ai-lib-meta';
      const metaText = [article.siteName, article.savedAt ? new Date(article.savedAt).toLocaleDateString() : null].filter(Boolean).join(' · ');
      if (metaText) {
        metaEl.appendChild(document.createTextNode(metaText));
      }
      if (isCurrentPage) {
        const badge = document.createElement('span');
        badge.className = 'ai-lib-badge';
        badge.textContent = browser.i18n.getMessage('currentPageBadge') || 'This page';
        metaEl.appendChild(badge);
      }
      if (metaEl.childNodes.length) item.appendChild(metaEl);

      if (isSyncOnly) {
        const syncHint = document.createElement('div');
        syncHint.className = 'ai-lib-sync-hint';
        syncHint.textContent = browser.i18n.getMessage('syncedArticle') || 'Cached on another device — re-open the page to read. Translations will need to be redone.';
        item.appendChild(syncHint);
      }

      listEl.appendChild(item);
    });
  }

  panel._refresh = refresh;
  return panel;
}

// Replace the content inside an already-open reader overlay with a saved article.
function loadSavedArticleIntoReader(article, overlay, saveBtn, backBtn) {
  // Snapshot the live article before the first library load so the user can return.
  // Skip when the library article is the same page — no navigation needed.
  if (!_libraryArticleLoaded && article.url !== getReaderUrl()) {
    _liveArticleSnapshot = {
      title: readerGetById('ai-reader-title')?.textContent || '',
      bylineText: readerGetById('ai-reader-byline')?.textContent || '',
      html: _articleHtml,
      url: getReaderUrl(),
      summaryPoints: Array.isArray(SUMMARY_STATE.points) ? SUMMARY_STATE.points.slice() : [],
      summaryElements: Array.isArray(SUMMARY_STATE.elements) ? SUMMARY_STATE.elements.slice() : [],
    };
  }
  _libraryArticleLoaded = true;
  _libraryArticleUrl = article.url;

  // Meta
  const titleEl = readerGetById('ai-reader-title');
  if (titleEl) titleEl.textContent = article.title || '';

  const meta = readerGetById('ai-reader-meta');
  let bylineEl = readerGetById('ai-reader-byline');
  const bylineParts = [article.byline, article.siteName, article.publishedTime].filter(Boolean);
  if (bylineParts.length) {
    if (!bylineEl) {
      bylineEl = document.createElement('div');
      bylineEl.id = 'ai-reader-byline';
      titleEl?.insertAdjacentElement('afterend', bylineEl);
    }
    bylineEl.textContent = bylineParts.join(' · ');
  } else if (bylineEl) {
    bylineEl.textContent = '';
  }

  // Source URL
  let sourceEl = meta?.querySelector('.ai-reader-source');
  if (!sourceEl && meta) {
    sourceEl = document.createElement('div');
    sourceEl.className = 'ai-reader-source';
    meta.appendChild(sourceEl);
  }
  if (sourceEl) {
    sourceEl.replaceChildren();
    const label = document.createElement('span');
    label.textContent = (browser.i18n.getMessage('savedArticleSource') || 'Source') + ': ';
    const link = document.createElement('a');
    link.href = article.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = article.url;
    sourceEl.append(label, link);
  }

  // Body
  const body = readerGetById('ai-reader-body');
  if (body) {
    const articleDoc = _htmlParser.parseFromString(article.html || '', 'text/html');
    sanitiseArticleDoc(articleDoc);
    body.replaceChildren(...Array.from(articleDoc.body.childNodes));
    _readerBody = body;

    // Prefer readerStates translations (updated on every translate action) over
    // the snapshot baked into the saved article at save time.
    const translations = (_readerStates?.[article.url]?.translations &&
      Object.keys(_readerStates[article.url].translations).length)
      ? _readerStates[article.url].translations
      : article.translations;
    if (translations && Object.keys(translations).length) {
      const elements = collectReaderElements(body);
      elements.forEach((el, idx) => {
        const saved = translations[idx];
        if (!saved) return;
        restoreTranslation(el, saved.html, saved.showing, () => {});
      });
      attachTranslationToggleTracking(elements);
    }

    SUMMARY_STATE.points = [];
    SUMMARY_STATE.elements = restoreSummaryElements(null, collectArticleElements(body));
  }

  (overlay._scrollEl || overlay).scrollTo({ top: 0, behavior: 'smooth' });

  // Show back button only when the library article differs from the current page.
  // If it's the same URL there's nowhere to "go back" to.
  const isSamePage = article.url === getReaderUrl();
  if (backBtn) backBtn.style.display = isSamePage ? 'none' : '';
  // Library articles are always saved — show save button in saved state so user can unsave.
  if (saveBtn) { updateSaveBtn(saveBtn, true); saveBtn.style.display = ''; }
}

// Restore the live article that was being read before a library article was opened.
function restoreLiveArticle(overlay, saveBtn, backBtn) {
  if (!_liveArticleSnapshot) return;
  const snap = _liveArticleSnapshot;
  _liveArticleSnapshot = null;
  _libraryArticleLoaded = false;
  _libraryArticleUrl = null;

  const titleEl = readerGetById('ai-reader-title');
  if (titleEl) titleEl.textContent = snap.title;

  const bylineEl = readerGetById('ai-reader-byline');
  if (bylineEl) bylineEl.textContent = snap.bylineText;

  // Remove the source-URL line that was added for the library article.
  readerGetById('ai-reader-meta')?.querySelector('.ai-reader-source')?.remove();

  const body = readerGetById('ai-reader-body');
  if (body && snap.html) {
    const articleDoc = _htmlParser.parseFromString(snap.html, 'text/html');
    sanitiseArticleDoc(articleDoc);
    body.replaceChildren(...Array.from(articleDoc.body.childNodes));
    _readerBody = body;

    // Re-apply stored translations for the live article URL.
    const urlState = _readerStates?.[snap.url] || {};
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
      attachTranslationToggleTracking(elements);
    }

    SUMMARY_STATE.points   = snap.summaryPoints;
    // Re-collect elements from the freshly rebuilt body — snap.summaryElements held
    // refs to the old nodes which are now detached after replaceChildren().
    SUMMARY_STATE.elements = restoreSummaryElements(
      _readerStates?.[snap.url]?.summary,
      collectArticleElements(body)
    );
  }

  const scrollEl = overlay._scrollEl || overlay;
  scrollEl.scrollTo({ top: 0, behavior: 'smooth' });

  if (backBtn) backBtn.style.display = 'none';
  if (saveBtn) {
    saveBtn.style.display = '';
    // Re-check saved state — user may have unsaved the live article while browsing library.
    const snapSyncKey = urlToSyncKey(snap.url);
    Promise.all([
      browser.storage.local.get(STORAGE_KEYS.SAVED_ARTICLES),
      browser.storage.sync.get(snapSyncKey).catch(() => ({})),
    ]).then(([{ savedArticles }, syncResult]) => {
      const inLocal = Array.isArray(savedArticles) && savedArticles.some(a => a.url === snap.url);
      const inSync  = !!syncResult[snapSyncKey];
      updateSaveBtn(saveBtn, inLocal || inSync);
    });
  }
}
