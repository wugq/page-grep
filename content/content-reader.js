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

// READER_ICON is defined in content-core.js
const CLOSE_ICON    = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const SETTINGS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`;
const SAVE_ICON     = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
const SAVED_ICON    = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
const LIBRARY_ICON  = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
const BACK_ICON     = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><polyline points="15 18 9 12 15 6"/></svg>`;

// CSS injected into the reader shadow root. Provides complete isolation from page styles.
// Mirrors content.css reader section but uses :host selectors and drops !important guards.
const READER_SHADOW_CSS = `
.ai-para-wrap { position: relative; }
.ai-para-original { display: block; }
.ai-para-translated { display: none; color: inherit; }
.ai-para-wrap.show-translation .ai-para-original { display: none; }
.ai-para-wrap.show-translation .ai-para-translated { display: block; }
.ai-toggle-btn {
  position: absolute; top: 2px; right: 2px;
  width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
  color: white; border: none; border-radius: 50%;
  cursor: pointer; font-size: 11px; font-weight: bold;
  opacity: 0; transition: opacity 0.15s, transform 0.15s;
  z-index: 9999; padding: 0;
  box-shadow: 0 2px 6px rgba(99, 102, 241, 0.3);
  pointer-events: none;
}
.ai-para-wrap:hover .ai-toggle-btn { opacity: 0.85; pointer-events: auto; }
.ai-toggle-btn:hover  { opacity: 1; transform: scale(1.1); }
.ai-toggle-btn:active { transform: scale(0.9); }
.ai-loading-btn { background: #94a3b8; cursor: wait; animation: ai-pulse 1.2s ease-in-out infinite; }
.ai-error-btn { background: #ef4444; opacity: 1; }
@keyframes ai-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }

:host([data-reader-theme="light"]) {
  --rd-bg: #f9f7f4; --rd-text: #1a1a1a; --rd-muted: #888;
  --rd-border: rgba(0,0,0,0.08); --rd-meta-border: rgba(0,0,0,0.1);
  --rd-link: #6366f1; --rd-quote: #666; --rd-ctrl-bg: rgba(255,255,255,0.85);
  --rd-ctrl-color: #222; --rd-ctrl-border: rgba(0,0,0,0.14);
  --rd-ctrl-active-bg: rgba(0,0,0,0.08);
  --rd-settings-bg: rgba(0,0,0,0.025); --rd-accent: #6366f1;
}
:host([data-reader-theme="sepia"]) {
  --rd-bg: #f4ecd8; --rd-text: #5b4636; --rd-muted: #9c7c5e;
  --rd-border: rgba(91,70,54,0.12); --rd-meta-border: rgba(91,70,54,0.15);
  --rd-link: #8b5e3c; --rd-quote: #8b7355; --rd-ctrl-bg: rgba(255,248,235,0.88);
  --rd-ctrl-color: #4a3728; --rd-ctrl-border: rgba(91,70,54,0.22);
  --rd-ctrl-active-bg: rgba(91,70,54,0.12);
  --rd-settings-bg: rgba(91,70,54,0.04); --rd-accent: #8b5e3c;
}
:host([data-reader-theme="dark"]) {
  --rd-bg: #1c1c1e; --rd-text: #d0d0d0; --rd-muted: #888;
  --rd-border: rgba(255,255,255,0.08); --rd-meta-border: rgba(255,255,255,0.1);
  --rd-link: #818cf8; --rd-quote: #aaa; --rd-ctrl-bg: rgba(50,50,55,0.92);
  --rd-ctrl-color: #e8e8e8; --rd-ctrl-border: rgba(255,255,255,0.14);
  --rd-ctrl-active-bg: rgba(255,255,255,0.12);
  --rd-settings-bg: rgba(255,255,255,0.03); --rd-accent: #818cf8;
}

/* Shadow host: full-screen fixed container */
:host {
  position: fixed;
  inset: 0;
  z-index: 2147483640;
  overflow: hidden;
  padding: 0; margin: 0; border: none;
  box-sizing: border-box;
  animation: ai-reader-fade-in 0.18s ease forwards;
  --reader-settings-max-h: 280px;
}
:host(.ai-closing) {
  animation: ai-reader-fade-out 0.15s ease forwards;
  pointer-events: none;
}
@keyframes ai-reader-fade-in  { from { opacity: 0; } to { opacity: 1; } }
@keyframes ai-reader-fade-out { from { opacity: 1; } to { opacity: 0; } }

/* Inner overlay container */
.rd-overlay {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--rd-bg);
  color: var(--rd-text);
  font-family: Georgia, "Times New Roman", serif;
  outline: none;
}

#ai-reader-scroll {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow-y: scroll;
  overflow-x: hidden;
  overscroll-behavior: contain;
}

#ai-reader-close-btn,
#ai-reader-save-btn,
#ai-reader-back-btn,
#ai-reader-library-btn {
  position: absolute;
  top: 16px;
  z-index: 10;
  pointer-events: auto;
  width: 32px; height: 32px;
  min-width: 32px; min-height: 32px;
  max-width: 32px; max-height: 32px;
  padding: 0;
  box-sizing: border-box;
  display: flex; align-items: center; justify-content: center;
  background: var(--rd-ctrl-bg);
  color: var(--rd-ctrl-color);
  border: 1px solid var(--rd-ctrl-border, rgba(0,0,0,0.12));
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0,0,0,0.1);
  transition: transform 0.15s, box-shadow 0.15s, color 0.15s;
  flex-shrink: 0;
  touch-action: manipulation;
}
#ai-reader-close-btn:hover,
#ai-reader-save-btn:hover,
#ai-reader-back-btn:hover,
#ai-reader-library-btn:hover {
  transform: scale(1.1);
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
}
#ai-reader-close-btn:active,
#ai-reader-save-btn:active,
#ai-reader-back-btn:active,
#ai-reader-library-btn:active { transform: scale(0.92); box-shadow: 0 1px 2px rgba(0,0,0,0.1); }

#ai-reader-close-btn   { right: 24px; }
#ai-reader-save-btn    { right: 64px; }
#ai-reader-back-btn    { right: 104px; }
#ai-reader-library-btn { left: 24px; }

#ai-reader-close-btn:focus   { outline: none; }
#ai-reader-close-btn:focus-visible { outline: 2px solid var(--rd-accent); outline-offset: 2px; }
#ai-reader-save-btn.saved { color: var(--rd-accent); }
#ai-reader-save-btn:focus   { outline: none; }
#ai-reader-save-btn:focus-visible { outline: 2px solid var(--rd-accent); outline-offset: 2px; }
#ai-reader-back-btn:focus   { outline: none; }
#ai-reader-back-btn:focus-visible { outline: 2px solid var(--rd-accent); outline-offset: 2px; }
#ai-reader-library-btn.active { color: var(--rd-accent); }
#ai-reader-library-btn:focus   { outline: none; }
#ai-reader-library-btn:focus-visible { outline: 2px solid var(--rd-accent); outline-offset: 2px; opacity: 1; }

#ai-reader-library-backdrop {
  position: absolute;
  inset: 0;
  z-index: 10;
  background: rgba(0, 0, 0, 0.35);
  cursor: default;
  opacity: 0;
  transition: opacity 0.22s ease;
}
#ai-reader-library-backdrop.visible { opacity: 1; }

#ai-reader-library {
  position: absolute;
  top: 0; left: 0; bottom: 0;
  width: 300px;
  z-index: 20;
  background: var(--rd-bg);
  border-right: 1px solid var(--rd-border);
  overflow-y: auto;
  transform: translateX(-100%);
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 4px 0 24px rgba(0,0,0,0.18);
}
#ai-reader-library.open { transform: translateX(0); }

.ai-lib-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--rd-border);
  font-size: 13px; font-weight: 700; color: var(--rd-text);
  position: sticky; top: 0; background: var(--rd-bg); z-index: 1;
}
.ai-lib-close-btn {
  background: none; border: none; cursor: pointer;
  font-size: 18px; line-height: 1; color: var(--rd-muted);
  padding: 2px 6px; border-radius: 4px;
}
.ai-lib-close-btn:hover { color: var(--rd-text); }
.ai-lib-list { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.ai-lib-loading {
  padding: 32px 16px; text-align: center; color: var(--rd-muted); font-size: 13px;
}
.ai-lib-loading::after {
  content: '';
  display: inline-block; width: 18px; height: 18px;
  border: 2px solid var(--rd-border); border-top-color: var(--rd-accent);
  border-radius: 50%;
  animation: ai-lib-spin 0.7s linear infinite;
  vertical-align: middle;
}
@keyframes ai-lib-spin { to { transform: rotate(360deg); } }
.ai-lib-error { padding: 24px 16px; text-align: center; color: #ef4444; font-size: 13px; }
.ai-lib-empty { padding: 32px 16px; text-align: center; color: var(--rd-muted); font-size: 13px; font-style: italic; }
.ai-lib-item {
  padding: 10px 12px; border: 1px solid var(--rd-border); border-radius: 8px;
  cursor: pointer; transition: background 0.15s, border-color 0.15s;
  position: relative;
}
.ai-lib-item:hover { background: var(--rd-ctrl-bg); }
.ai-lib-item:active { opacity: 0.8; }
/* Current page: accent border to make it easy to spot */
.ai-lib-item--current { border-color: var(--rd-accent); }
/* Currently displayed in reader: accent border + subtle background */
.ai-lib-item--reading { border-color: var(--rd-accent); background: var(--rd-ctrl-bg); }
.ai-lib-item-top { display: flex; align-items: flex-start; gap: 6px; }
.ai-lib-title {
  flex: 1; font-size: 13px; font-weight: 600; color: var(--rd-text);
  line-height: 1.4; margin-bottom: 3px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.ai-lib-meta { font-size: 11px; color: var(--rd-muted); margin-top: 2px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ai-lib-badge {
  font-size: 10px; font-weight: 600; letter-spacing: 0.03em;
  background: var(--rd-accent); color: #fff;
  border-radius: 4px; padding: 1px 5px;
  white-space: nowrap; flex-shrink: 0;
}
/* Delete button: × icon, hidden until hover */
.ai-lib-delete-btn {
  flex-shrink: 0; width: 20px; height: 20px;
  background: none; border: none; padding: 0;
  color: var(--rd-muted); cursor: pointer;
  font-size: 15px; line-height: 1;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity 0.15s, color 0.15s, background 0.15s;
  touch-action: manipulation; margin-top: 1px;
}
.ai-lib-item:hover .ai-lib-delete-btn { opacity: 1; }
.ai-lib-delete-btn:hover { color: #ef4444; background: rgba(239,68,68,0.1); }
.ai-lib-delete-btn:active { transform: scale(0.9); }

.ai-reader-source { font-size: 12px; color: var(--rd-muted, #888); margin-top: 6px; word-break: break-all; }
.ai-reader-source a { color: var(--rd-link); }

#ai-reader-settings {
  position: absolute;
  z-index: 20;
  width: 220px;
  max-height: var(--reader-settings-max-h);
  overflow-x: hidden; overflow-y: auto;
  background: var(--rd-bg);
  border: 1px solid var(--rd-border);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08);
  opacity: 0;
  pointer-events: none;
  transform: scale(0.96);
  transform-origin: top right;
  transition: opacity 0.15s ease, transform 0.15s ease;
}
#ai-reader-settings:not(.open) * { pointer-events: none; }
#ai-reader-settings.open { opacity: 1; pointer-events: auto; transform: translateY(0) scale(1); }

.ai-rs-row {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 12px 14px; border-bottom: 1px solid var(--rd-border);
}
.ai-rs-row:last-child { border-bottom: none; }
.ai-rs-theme-btn {
  flex: 1; height: 32px; padding: 0; margin: 0; box-sizing: border-box;
  border-radius: 8px; border: 2px solid transparent; cursor: pointer;
  font-family: Georgia, serif; font-size: 14px; font-weight: 600;
  transition: border-color 0.15s, transform 0.15s;
  white-space: nowrap; min-width: 0;
  -webkit-appearance: none; appearance: none;
}
.ai-rs-theme-btn[data-theme="auto"] {
  background: var(--rd-ctrl-bg); color: var(--rd-text);
  font-family: "Plus Jakarta Sans", -apple-system, sans-serif; font-size: 11px;
}
.ai-rs-theme-btn[data-theme="light"] { background: #f9f7f4; color: #1a1a1a; }
.ai-rs-theme-btn[data-theme="sepia"] { background: #f4ecd8; color: #5b4636; }
.ai-rs-theme-btn[data-theme="dark"]  { background: #1c1c1e; color: #d0d0d0; }
.ai-rs-section-label {
  width: 100%; padding: 10px 14px 0;
  font-family: "Plus Jakarta Sans", -apple-system, sans-serif;
  font-size: 12px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;
  color: var(--rd-muted);
}
.ai-rs-theme-btn:hover  { transform: scale(1.05); }
.ai-rs-theme-btn:active { transform: scale(0.96); }
.ai-rs-theme-btn.active { border-color: var(--rd-accent); }

.ai-rs-stepper-label { flex: 1; font-family: "Plus Jakarta Sans", -apple-system, sans-serif; font-size: 12px; color: var(--rd-muted); }
.ai-rs-stepper-val { min-width: 38px; text-align: center; font-family: "Plus Jakarta Sans", -apple-system, sans-serif; font-size: 12px; font-weight: 600; color: var(--rd-text); }
.ai-rs-step-btn {
  width: 28px; height: 28px; padding: 0; margin: 0; box-sizing: border-box;
  border: 1px solid var(--rd-border); border-radius: 50%;
  background: var(--rd-ctrl-bg); color: var(--rd-text);
  font-size: 16px; line-height: 1; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.12s, transform 0.12s; flex-shrink: 0;
  -webkit-appearance: none; appearance: none;
}
.ai-rs-step-btn:hover    { background: var(--rd-ctrl-active-bg); transform: scale(1.1); }
.ai-rs-step-btn:active   { transform: scale(0.92); }
.ai-rs-step-btn:disabled { opacity: 0.3; cursor: default; transform: none; }

.ai-rs-width-btn {
  flex: 1; height: 30px; padding: 0; margin: 0; box-sizing: border-box;
  border: 1px solid var(--rd-border); border-radius: 6px;
  background: transparent; color: var(--rd-muted);
  cursor: pointer; font-family: "Plus Jakarta Sans", -apple-system, sans-serif;
  font-size: 12px; font-weight: 500;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  max-width: 90px; -webkit-appearance: none; appearance: none;
}
.ai-rs-width-btn:hover  { color: var(--rd-text); }
.ai-rs-width-btn:active { opacity: 0.75; }
.ai-rs-width-btn.active { background: var(--rd-accent); color: white; border-color: var(--rd-accent); font-weight: 600; }

#ai-reader-content {
  max-width: var(--reader-width, 680px);
  margin: 0 auto; padding: 48px 24px 60px; box-sizing: border-box;
  transition: max-width 0.2s ease;
}
#ai-reader-meta { margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px solid var(--rd-meta-border); }
#ai-reader-title {
  font-size: 28px; font-weight: 700; line-height: 1.3; margin: 0 0 10px;
  font-family: Georgia, "Times New Roman", serif; color: var(--rd-text);
}
#ai-reader-byline { font-family: "Plus Jakarta Sans", -apple-system, sans-serif; font-size: 13px; color: var(--rd-muted); line-height: 1.5; }

#ai-reader-body { font-size: var(--reader-font-size, 18px); line-height: var(--reader-line-height, 1.8); transition: font-size 0.15s, line-height 0.15s; }
#ai-reader-body p  { margin: 0 0 1.2em; line-height: var(--reader-line-height, 1.8); }
#ai-reader-body h1 { font-size: calc(var(--reader-font-size, 18px) * 1.35); font-weight: 700; line-height: 1.3; margin: 1.6em 0 0.6em; }
#ai-reader-body h2 { font-size: calc(var(--reader-font-size, 18px) * 1.2);  font-weight: 700; line-height: 1.3; margin: 1.6em 0 0.5em; }
#ai-reader-body h3,
#ai-reader-body h4,
#ai-reader-body h5,
#ai-reader-body h6 { font-size: var(--reader-font-size, 18px); font-weight: 700; line-height: 1.3; margin: 1.4em 0 0.4em; }
#ai-reader-body blockquote {
  border-left: 3px solid var(--rd-accent); margin: 1.2em 0; padding: 2px 20px;
  color: var(--rd-quote); font-style: italic; line-height: var(--reader-line-height, 1.8);
}
#ai-reader-body a   { color: var(--rd-link); }
#ai-reader-body img { max-width: 100%; border-radius: 8px; margin: 1em 0; display: block; }
#ai-reader-body ul,
#ai-reader-body ol  { padding-left: 24px; margin: 0 0 1.2em; }
#ai-reader-body li  { margin: 0.3em 0; line-height: var(--reader-line-height, 1.8); }

::selection { background: var(--rd-accent, #6366f1); color: #fff; }

@media (max-width: 480px) {
  #ai-reader-library { width: min(300px, calc(100vw - 40px)); }
}
`;

// Queries an element by ID within the reader's shadow root.
// Needed because document.getElementById() cannot pierce shadow DOM.
function readerGetById(id) {
  const root = _readerBody?.getRootNode();
  return (root instanceof ShadowRoot ? root : document).getElementById(id);
}

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

// --- Save-for-later helpers ---

let _savingInProgress = false;

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
    const { savedArticles } = await browser.storage.local.get(STORAGE_KEYS.SAVED_ARTICLES);
    const articles = Array.isArray(savedArticles) ? savedArticles : [];
    // When a library article is loaded use its URL, otherwise use the live page URL.
    const url = _libraryArticleUrl || getReaderUrl();
    const existingIdx = articles.findIndex(a => a.url === url);

    if (existingIdx >= 0) {
      articles.splice(existingIdx, 1);
      await browser.storage.local.set({ [STORAGE_KEYS.SAVED_ARTICLES]: articles });
      updateSaveBtn(btn, false);
      showToast(browser.i18n.getMessage('articleUnsaved') || 'Removed from saved');
    } else {
      if (!_articleHtml) return;
      const translations = _readerStates?.[url]?.translations || {};
      const newArticle = {
        url,
        title: _articleMeta?.title || document.title,
        byline: _articleMeta?.byline || null,
        siteName: _articleMeta?.siteName || null,
        publishedTime: _articleMeta?.publishedTime || null,
        savedAt: Date.now(),
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
      const { savedArticles } = await browser.storage.local.get(STORAGE_KEYS.SAVED_ARTICLES);
      articles = Array.isArray(savedArticles) ? savedArticles : [];
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

      const item = document.createElement('div');
      item.className = 'ai-lib-item';
      if (isCurrentPage) item.classList.add('ai-lib-item--current');
      if (isReading)     item.classList.add('ai-lib-item--reading');

      // Clicking anywhere on the item opens it (except the delete button)
      item.addEventListener('click', (e) => {
        if (e.target.closest('.ai-lib-delete-btn')) return;
        onOpen(article);
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
        const { savedArticles: current } = await browser.storage.local.get(STORAGE_KEYS.SAVED_ARTICLES);
        const updated = (Array.isArray(current) ? current : [])
          .filter(a => !(a.url === article.url && a.savedAt === article.savedAt));
        await browser.storage.local.set({ [STORAGE_KEYS.SAVED_ARTICLES]: updated });
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
    const articleDoc = new DOMParser().parseFromString(article.html || '', 'text/html');
    articleDoc.querySelectorAll('script, style').forEach(el => el.remove());
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
    const articleDoc = new DOMParser().parseFromString(snap.html, 'text/html');
    articleDoc.querySelectorAll('script, style').forEach(el => el.remove());
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
    browser.storage.local.get(STORAGE_KEYS.SAVED_ARTICLES).then(({ savedArticles }) => {
      const stillSaved = Array.isArray(savedArticles) && savedArticles.some(a => a.url === snap.url);
      updateSaveBtn(saveBtn, stillSaved);
    });
  }
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

  let article, prefs, urlState, isSaved;
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
    const [{ readerStates }, { savedArticles }] = await Promise.all([
      browser.storage.local.get(STORAGE_KEYS.READER_STATES),
      browser.storage.local.get(STORAGE_KEYS.SAVED_ARTICLES),
    ]);
    _readerStates = readerStates || {};
    urlState = _readerStates[getReaderUrl()] || {};
    isSaved = Array.isArray(savedArticles) && savedArticles.some(a => a.url === getReaderUrl());
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

  // Shadow host lives in the page DOM (carries the ID + CSS vars for shadow inheritance).
  const shadowHost = document.createElement('div');
  shadowHost.id = READER_OVERLAY_ID;
  const shadowRoot = shadowHost.attachShadow({ mode: 'open' });
  const shadowStyle = document.createElement('style');
  shadowStyle.textContent = READER_SHADOW_CSS;
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
  const settingsPanel = buildSettingsPanel(shadowHost, prefs, content);

  // Wrap the article content in a dedicated scroll container so the overlay itself
  // can be overflow:hidden — this keeps buttons/panels truly above the scroll area
  // and avoids position:fixed inside overflow:auto interaction bugs.
  const scrollEl = document.createElement('div');
  scrollEl.id = 'ai-reader-scroll';
  scrollEl.tabIndex = -1; // allow Space/PageDown to scroll when focused
  scrollEl.appendChild(content);

  overlay.append(closeBtn, saveBtn, backBtn, libraryBtn, libraryPanel, settingsPanel, scrollEl);

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

  // Restore page-mode summary before notifying the sidebar.
  SUMMARY_STATE.points = _pageSummaryBackup?.points || [];
  SUMMARY_STATE.elements = _pageSummaryBackup?.elements || [];
  _pageSummaryBackup = null;

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
      document.getElementById(FLOAT_BTN_ID)?.remove();
      document.getElementById(READER_MODE_BTN_ID)?.remove();
      document.getElementById(SCRATCHPAD_BTN_ID)?.remove();
      removePanelIfEmpty();
    }
  });
  overlay.classList.add('ai-closing');
  overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
}

