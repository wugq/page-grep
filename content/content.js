// Content script - translation & interest highlighting

function devlog(level, ...args) {
  try {
    const fn = level === 'warn' ? console.warn : level === 'error' ? console.error : console.log;
    fn('[PageGrep]', ...args);
  } catch (_) {}
  try {
    browser.runtime.sendMessage({
      action: 'log',
      level,
      args: args.map(a => (a !== null && typeof a === 'object') ? JSON.stringify(a) : String(a))
    }).catch(() => {});
  } catch (_) {}
}
const log   = (...a) => devlog('log',   ...a);
const warn  = (...a) => devlog('warn',  ...a);
const error = (...a) => devlog('error', ...a);


const STYLE_ID = 'ai-reader-styles';
const PANEL_ID = 'ai-reader-panel';
const TRANSLATE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`;
const NOTE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" style="pointer-events:none"><rect x="3.5" y="1.5" width="13" height="17" rx="1.5" stroke="currentColor" stroke-width="1.5"/><line x1="6.5" y1="7" x2="13.5" y2="7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="6.5" y1="10" x2="13.5" y2="10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="6.5" y1="13" x2="10.5" y2="13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
// Toggle btn icons: translate icon (show translated) vs undo/back arrow (show original)
const TOGGLE_TRANSLATE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`;
const TOGGLE_ORIGINAL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>`;
const _svgParser = new DOMParser();
function setTranslateIcon(el) {
  const doc = _svgParser.parseFromString(TRANSLATE_ICON, 'image/svg+xml');
  el.replaceChildren(doc.documentElement);
}
function setToggleIcon(btn, showingTranslation) {
  const src = showingTranslation ? TOGGLE_ORIGINAL_ICON : TOGGLE_TRANSLATE_ICON;
  const doc = _svgParser.parseFromString(src, 'image/svg+xml');
  btn.replaceChildren(doc.documentElement);
}
const FLOAT_BTN_ID = 'ai-translate-btn';
const SUMMARY_STATE = {
  points: null,
  elements: null
};
const HIGHLIGHT_STATE = {
  elements: null,
  items: null
};

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .ai-para-wrap { position: relative; }
    .ai-para-original { display: block; }
    .ai-para-translated { display: none; color: inherit; }
    .ai-para-wrap.show-translation .ai-para-original { display: none; }
    .ai-para-wrap.show-translation .ai-para-translated { display: block; }
    .ai-toggle-btn {
      position: absolute;
      top: 2px;
      right: 2px;
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
      color: white;
      border: none;
      border-radius: 50%;
      cursor: pointer;
      font-size: 11px;
      font-weight: bold;
      opacity: 0;
      transition: opacity 0.15s, transform 0.15s;
      z-index: 9999;
      padding: 0;
      box-shadow: 0 2px 6px rgba(99, 102, 241, 0.3);
      pointer-events: none;
    }
    .ai-para-wrap:hover .ai-toggle-btn {
      opacity: 0.85;
      pointer-events: auto;
    }
    .ai-toggle-btn:hover { opacity: 1 !important; transform: scale(1.1); }
    .ai-loading-btn {
      background: #94a3b8;
      cursor: wait;
      animation: ai-pulse 1.2s ease-in-out infinite;
    }
    .ai-error-btn { background: #ef4444; opacity: 1; }
    @keyframes ai-pulse {
      0%, 100% { opacity: 0.5; }
      50% { opacity: 1; }
    }
    #ai-reader-panel {
      position: fixed !important;
      bottom: 24px;
      right: 20px;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 6px !important;
      z-index: 2147483647 !important;
      width: 46px !important;
      padding: 8px 0 !important;
      margin: 0 !important;
      user-select: none;
      background: rgba(248, 250, 252, 0.92);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-radius: 28px;
      border: 1px solid rgba(0, 0, 0, 0.12);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
      overflow: hidden;
      resize: none !important;
      box-sizing: content-box !important;
    }
    #ai-reader-panel.dark {
      background: rgba(15, 23, 42, 0.78);
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
    }
    .ai-panel-btn {
      width: 34px !important;
      height: 34px !important;
      min-width: 34px !important;
      min-height: 34px !important;
      max-width: 34px !important;
      max-height: 34px !important;
      border-radius: 50% !important;
      border: none !important;
      cursor: grab;
      font-size: 14px;
      font-weight: 700;
      color: white;
      padding: 0 !important;
      margin: 0 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      flex-shrink: 0 !important;
      font-family: "Plus Jakarta Sans", -apple-system, sans-serif;
      transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.18s, opacity 0.18s;
    }
    .ai-panel-btn:hover { transform: scale(1.12); box-shadow: inset 0 0 0 100px rgba(255,255,255,0.16); }
    .ai-panel-btn:active { transform: scale(0.92); cursor: grabbing; }
    .ai-panel-btn:disabled { opacity: 0.45; cursor: wait; }
    #ai-translate-btn { background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); box-shadow: 0 2px 10px rgba(99, 102, 241, 0.45); }
    #ai-scratchpad-btn { background: linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%); box-shadow: 0 2px 10px rgba(14, 165, 233, 0.4); }
    #ai-translate-btn:hover { box-shadow: inset 0 0 0 100px rgba(255,255,255,0.16), 0 4px 16px rgba(99,102,241,0.55); }
    #ai-scratchpad-btn:hover { box-shadow: inset 0 0 0 100px rgba(255,255,255,0.16), 0 4px 16px rgba(14,165,233,0.5); }
    #ai-trash-zone {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      border-radius: 999px;
      background: rgba(30, 41, 59, 0.85);
      backdrop-filter: blur(8px);
      color: rgba(255,255,255,0.7);
      font-size: 13px;
      font-family: "Plus Jakarta Sans", -apple-system, sans-serif;
      white-space: nowrap;
      z-index: 2147483646;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s, transform 0.2s, background 0.15s;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }
    #ai-trash-zone.visible {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    #ai-trash-zone.active {
      background: rgba(239, 68, 68, 0.9);
      color: white;
    }
    #ai-selection-btn {
      position: fixed;
      z-index: 2147483647;
      display: flex;
      gap: 6px;
      align-items: center;
      pointer-events: all;
    }
    .ai-sel-action-btn {
      color: white;
      border: none;
      border-radius: 20px;
      padding: 5px 11px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      font-family: "Plus Jakarta Sans", -apple-system, sans-serif;
      transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.15s;
      white-space: nowrap;
      user-select: none;
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .ai-sel-action-btn:hover { transform: scale(1.05); }
    .ai-sel-translate-btn {
      background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
      box-shadow: 0 2px 10px rgba(99, 102, 241, 0.4);
    }
    .ai-sel-translate-btn:hover { box-shadow: inset 0 0 0 100px rgba(255,255,255,0.14), 0 4px 14px rgba(99,102,241,0.5); }
    .ai-sel-save-btn {
      background: rgba(15, 23, 42, 0.65);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.22) !important;
      color: rgba(255, 255, 255, 0.88);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    }
    .ai-sel-save-btn:hover { box-shadow: inset 0 0 0 100px rgba(255,255,255,0.1), 0 4px 12px rgba(0,0,0,0.3); }
    .ai-sel-save-link {
      display: block;
      background: none;
      border: none;
      border-top: 1px solid rgba(255,255,255,0.15);
      color: rgba(241,245,249,0.6);
      font-size: 11px;
      cursor: pointer;
      padding: 6px 0 0;
      margin-top: 6px;
      width: 100%;
      text-align: left;
      font-family: "Plus Jakarta Sans", -apple-system, sans-serif;
      transition: color 0.15s;
    }
    .ai-sel-save-link:hover { color: #f1f5f9; }
    #ai-toast {
      position: fixed;
      bottom: 28px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(15,23,42,0.9);
      color: #f1f5f9;
      padding: 7px 14px;
      border-radius: 20px;
      font-size: 12px;
      font-family: "Plus Jakarta Sans", -apple-system, sans-serif;
      z-index: 2147483646;
      opacity: 0;
      transition: opacity 0.3s;
      pointer-events: none;
      white-space: nowrap;
    }
    #ai-toast.ai-toast-show { opacity: 1; }
    #ai-selection-result {
      position: fixed;
      z-index: 2147483647;
      background: rgba(15, 23, 42, 0.95);
      color: #f1f5f9;
      border-radius: 10px;
      padding: 10px 14px;
      font-size: 13px;
      font-family: "Plus Jakarta Sans", -apple-system, sans-serif;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
      max-width: min(360px, 90vw);
      line-height: 1.6;
      user-select: text;
      white-space: pre-wrap;
      word-break: break-word;
      pointer-events: all;
    }
    #ai-selection-result.ai-sel-loading { color: #94a3b8; font-style: italic; }
    #ai-selection-result.ai-sel-error { color: #fca5a5; }
    #ai-panel-menu {
      position: fixed;
      z-index: 2147483647;
      background: white;
      border: 1px solid rgba(0,0,0,0.1);
      border-radius: 10px;
      padding: 4px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
      min-width: 180px;
    }
    #ai-panel-menu.dark {
      background: #1e293b;
      border-color: rgba(255,255,255,0.1);
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    }
    #ai-panel-menu button {
      display: block;
      width: 100%;
      padding: 8px 12px;
      background: none;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-family: "Plus Jakarta Sans", -apple-system, sans-serif;
      color: #0f172a;
      text-align: left;
      font-weight: 500;
      white-space: nowrap;
    }
    #ai-panel-menu.dark button { color: #f8fafc; }
    #ai-panel-menu button:hover { background: rgba(99,102,241,0.08); color: #6366f1; }
    #ai-panel-menu.dark button:hover { background: rgba(129,140,248,0.15); color: #818cf8; }
  `;
  document.head.appendChild(style);
}

// --- Theme helper ---

async function applyThemeToPanel() {
  const { theme } = await browser.storage.local.get(STORAGE_KEYS.THEME);
  const isDark = theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const panel = document.getElementById(PANEL_ID);
  if (panel) {
    panel.classList.toggle('dark', isDark);
  }
}

// --- Shared panel ---

function getOrCreatePanel() {
  let panel = document.getElementById(PANEL_ID);
  if (!panel) {
    injectStyles();
    panel = document.createElement('div');
    panel.id = PANEL_ID;

    applyThemeToPanel();

    document.body.appendChild(panel);
  }
  return panel;
}

function removePanelIfEmpty() {
  const panel = document.getElementById(PANEL_ID);
  if (panel && panel.children.length === 0) panel.remove();
}

// --- Article detection ---

// Recursively descend the DOM following the widest / most text-rich block
// at each level to locate the true article column.
function findWidestTextBlock(container, depth) {
  if (depth > 8) return container;
  // If we already have ≥3 direct paragraphs, this is the content node.
  const directParas = Array.from(container.children).filter(
    c => c.tagName === 'P' && (c.innerText?.trim() || '').length > 40
  );
  if (directParas.length >= 3) return container;
  const blockChildren = Array.from(container.children).filter(el => {
    if (!['DIV', 'SECTION', 'ARTICLE', 'MAIN'].includes(el.tagName)) return false;
    if (el.tagName === 'ASIDE') return false;
    if (el.closest(CHROME_SELECTOR)) return false;
    return (el.innerText?.trim() || '').length > 300;
  });
  if (blockChildren.length === 0) return container;
  if (blockChildren.length === 1) return findWidestTextBlock(blockChildren[0], depth + 1);
  // Multiple candidates: if widths differ significantly, pick the widest.
  const maxW = Math.max(...blockChildren.map(c => c.offsetWidth));
  const minW = Math.min(...blockChildren.map(c => c.offsetWidth));
  if (maxW / (minW || 1) > 1.4) {
    const widest = blockChildren.reduce((a, b) => a.offsetWidth > b.offsetWidth ? a : b);
    return findWidestTextBlock(widest, depth + 1);
  }
  // Otherwise follow the longest text block.
  return findWidestTextBlock(
    blockChildren.reduce((a, b) => (a.innerText?.length || 0) > (b.innerText?.length || 0) ? a : b),
    depth + 1
  );
}

function findArticleBodyEl() {
  // 1. Explicit semantic/class markers
  const explicit = document.querySelector(
    '[itemprop="articleBody"],[class*="article-body"],[class*="article-content"],' +
    '[class*="post-content"],[class*="entry-content"],[class*="news-content"],' +
    '[class*="story-body"],[class*="article__body"],[class*="post-body"]'
  );
  if (explicit) return explicit;

  // 2. Single <article> element
  const articleEls = document.querySelectorAll('article');
  if (articleEls.length === 1) return articleEls[0];

  // 3. Recursive width-based descent from main content scope
  return findWidestTextBlock(findMainContentScope(), 0);
}

function collectArticleText() {
  const body = findArticleBodyEl();
  const INLINE_EXCLUDE = 'aside,[class*="related"],[class*="recommend"],[class*="sidebar"],[class*="widget"]';
  const seen = new Set();
  const lines = [];
  const HEADING_PREFIX = { H1: '# ', H2: '## ', H3: '### ', H4: '#### ', H5: '##### ', H6: '###### ' };
  for (const el of body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,blockquote,li')) {
    if (el.closest(CHROME_SELECTOR) || el.closest(INLINE_EXCLUDE)) continue;
    // Skip <li> nested inside another <li> (sub-items handled via their direct parent li)
    if (el.tagName === 'LI' && el.parentElement?.closest('li')) continue;

    // For LI, strip nested list elements so sub-items don't bleed into parent text
    let raw;
    if (el.tagName === 'LI') {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('ul,ol').forEach(n => n.remove());
      raw = clone.innerText?.trim().replace(/\s+/g, ' ') || '';
    } else {
      raw = el.innerText?.trim().replace(/\s+/g, ' ');
    }

    const minLen = el.tagName === 'LI' ? 2 : (el.tagName.startsWith('H') ? 2 : 20);
    if (!raw || raw.length < minLen || seen.has(raw)) continue;
    seen.add(raw);

    let formatted;
    if (HEADING_PREFIX[el.tagName]) {
      formatted = HEADING_PREFIX[el.tagName] + raw;
    } else if (el.tagName === 'BLOCKQUOTE') {
      formatted = '> ' + raw.replace(/\n/g, '\n> ');
    } else if (el.tagName === 'LI') {
      // Use parentElement directly (not closest) for correct index among siblings
      const isOrdered = el.parentElement?.tagName === 'OL';
      if (isOrdered) {
        const siblings = Array.from(el.parentElement.children).filter(c => c.tagName === 'LI');
        const idx = siblings.indexOf(el) + 1;
        formatted = `${idx}. ${raw}`;
      } else {
        formatted = `- ${raw}`;
      }
    } else {
      formatted = raw;
    }
    lines.push(formatted);
    if (lines.length >= 200) break;
  }
  return lines;
}

// --- API key error helpers ---

function isApiKeyError(msg) {
  const noKeyMsg = browser.i18n.getMessage('enterApiKey');
  return msg === noKeyMsg || msg === 'Please enter an API Key' || msg === '请输入 API Key';
}

function showApiKeyToast() {
  injectStyles();
  let toast = document.getElementById('ai-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'ai-toast';
    document.body.appendChild(toast);
  }
  toast.innerHTML = '';
  const msgNode = document.createTextNode((browser.i18n.getMessage('enterApiKey') || 'No API key set') + ' — ');
  const link = document.createElement('a');
  link.href = '#';
  link.style.cssText = 'color:#818cf8;text-decoration:underline;cursor:pointer;';
  link.textContent = browser.i18n.getMessage('settingsTitle').replace('PageGrep - ', '') || 'Settings';
  link.addEventListener('click', (e) => { e.preventDefault(); browser.runtime.sendMessage({ action: 'openOptionsPage' }); });
  toast.appendChild(msgNode);
  toast.appendChild(link);
  toast.style.pointerEvents = 'auto';
  clearTimeout(toast._hideTimer);
  toast.classList.add('ai-toast-show');
  toast._hideTimer = setTimeout(() => { toast.classList.remove('ai-toast-show'); toast.style.pointerEvents = ''; }, 4000);
}

// --- Translation ---

async function runTranslateOnPage(btn) {
  log('[PageGrep] 译 triggered');
  injectStyles();
  const visible = findVisibleParagraphs();
  log(`[PageGrep] 译: found ${visible.length} visible paragraphs`);
  if (visible.length === 0) {
    if (btn) { btn.title = browser.i18n.getMessage('noTranslatableContent'); setTimeout(() => { btn.title = browser.i18n.getMessage('translateScreenContent'); }, 1500); }
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  let done = 0;
  await Promise.all(visible.map(async el => {
    await wrapAndTranslate(el);
    if (btn) btn.title = browser.i18n.getMessage('translatingProgress', [String(++done), String(visible.length)]);
  }));
  log(`[PageGrep] 译: done, translated ${visible.length} paragraphs`);
  if (btn) { btn.disabled = false; setTranslateIcon(btn); btn.title = browser.i18n.getMessage('translateScreenContent'); }
}

function createFloatButton() {
  if (document.getElementById(FLOAT_BTN_ID)) return;
  const panel = getOrCreatePanel();
  const btn = document.createElement('button');
  btn.id = FLOAT_BTN_ID;
  btn.className = 'ai-panel-btn';
  setTranslateIcon(btn);
  btn.title = browser.i18n.getMessage('translateScreenContent');
  panel.appendChild(btn);
  btn.addEventListener('click', () => runTranslateOnPage(btn));

  const saveBtn = document.createElement('button');
  saveBtn.id = 'ai-scratchpad-btn';
  saveBtn.className = 'ai-panel-btn';
  const noteSvg = _svgParser.parseFromString(NOTE_ICON, 'image/svg+xml').documentElement;
  noteSvg.setAttribute('width', '16');
  noteSvg.setAttribute('height', '16');
  saveBtn.appendChild(noteSvg);
  saveBtn.title = browser.i18n.getMessage('saveArticle') || 'Copy article to clipboard';
  panel.appendChild(saveBtn);
  saveBtn.addEventListener('click', () => saveArticleToClipboard(saveBtn));

  panel.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showPanelContextMenu(e.clientX, e.clientY);
  });

  makeDraggable(panel);

  browser.storage.local.get([STORAGE_KEYS.PANEL_POSITION]).then(({ panelPosition }) => {
    if (panelPosition) {
      const MARGIN = 10;
      const panelSize = panel.offsetWidth || 48;
      // Support ratio-based (new) and legacy pixel-based (old) stored positions
      const rawLeft = panelPosition.leftRatio != null
        ? panelPosition.leftRatio * window.innerWidth
        : parseFloat(panelPosition.left) || 0;
      const rawTop = panelPosition.topRatio != null
        ? panelPosition.topRatio * window.innerHeight
        : parseFloat(panelPosition.top) || 0;
      const left = Math.max(MARGIN, Math.min(window.innerWidth - panelSize - MARGIN, rawLeft));
      const top = Math.max(MARGIN, Math.min(window.innerHeight - panelSize - MARGIN, rawTop));
      panel.style.bottom = 'auto';
      panel.style.right = 'auto';
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
    }
  });
}

function makeDraggable(panel) {
  let isDragging = false;
  let hasMoved = false;
  let startX, startY, startLeft, startTop;
  const DRAG_THRESHOLD = 5;

  panel.addEventListener('mousedown', onDragStart);
  panel.addEventListener('touchstart', onDragStart, { passive: true });

  function getOrCreateTrashZone() {
    let zone = document.getElementById('ai-trash-zone');
    if (!zone) {
      zone = document.createElement('div');
      zone.id = 'ai-trash-zone';
      const trashSvg = _svgParser.parseFromString('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>', 'image/svg+xml').documentElement;
      const trashLabel = document.createElement('span');
      trashLabel.textContent = browser.i18n.getMessage('dropToHide');
      zone.append(trashSvg, trashLabel);
      document.body.appendChild(zone);
    }
    return zone;
  }

  function isOverTrashZone(clientX, clientY) {
    const zone = document.getElementById('ai-trash-zone');
    if (!zone) return false;
    const rect = zone.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  function onDragStart(e) {
    const point = e.touches ? e.touches[0] : e;
    startX = point.clientX;
    startY = point.clientY;
    const rect = panel.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    isDragging = true;
    hasMoved = false;

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('mouseup', onDragEnd);
    document.addEventListener('touchend', onDragEnd);
  }

  function onDragMove(e) {
    if (!isDragging) return;
    if (e.cancelable) e.preventDefault();
    const point = e.touches ? e.touches[0] : e;
    const dx = point.clientX - startX;
    const dy = point.clientY - startY;

    if (!hasMoved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
      hasMoved = true;
      panel.style.bottom = 'auto';
      panel.style.right = 'auto';
      panel.style.left = startLeft + 'px';
      panel.style.top = startTop + 'px';
      panel.style.cursor = 'grabbing';
      getOrCreateTrashZone().classList.add('visible');
    }

    if (!hasMoved) return;

    const panelW = panel.offsetWidth;
    const panelH = panel.offsetHeight;
    const newLeft = Math.max(0, Math.min(window.innerWidth - panelW, startLeft + dx));
    const newTop = Math.max(0, Math.min(window.innerHeight - panelH, startTop + dy));

    panel.style.left = newLeft + 'px';
    panel.style.top = newTop + 'px';

    const zone = document.getElementById('ai-trash-zone');
    if (zone) zone.classList.toggle('active', isOverTrashZone(point.clientX, point.clientY));
  }

  function onDragEnd(e) {
    if (!isDragging) return;
    isDragging = false;
    panel.style.cursor = '';

    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('touchmove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    document.removeEventListener('touchend', onDragEnd);

    const zone = document.getElementById('ai-trash-zone');
    if (zone) {
      zone.classList.remove('visible', 'active');
    }

    if (!hasMoved) return;

    const point = e.changedTouches ? e.changedTouches[0] : e;
    if (isOverTrashZone(point.clientX, point.clientY)) {
      panel.remove();
      if (zone) zone.remove();
      const hostname = location.hostname;
      if (hostname) {
        browser.storage.local.get(STORAGE_KEYS.BLOCKED_DOMAINS).then(({ blockedDomains }) => {
          const list = Array.isArray(blockedDomains) ? blockedDomains : [];
          if (!list.includes(hostname)) {
            browser.storage.local.set({ [STORAGE_KEYS.BLOCKED_DOMAINS]: [...list, hostname] });
          }
        });
      }
      return;
    }

    browser.storage.local.set({
      [STORAGE_KEYS.PANEL_POSITION]: {
        leftRatio: parseFloat(panel.style.left) / window.innerWidth,
        topRatio: parseFloat(panel.style.top) / window.innerHeight,
      }
    });
    panel.addEventListener('click', stopClick, { capture: true, once: true });
  }

  function stopClick(e) { e.stopPropagation(); }
}

function findMainContentScope() {
  // 1. Try to find a clear "main" container first
  const mainSelectors = [
    '[role="main"]',
    'main',
    '#main-content', '#content', '#main',
    '#primary', '.main-content', '.main', '.content'
  ];
  for (const sel of mainSelectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }

  // 2. If no clear main container, check for article.
  // If there's exactly one article, it's likely a single-article page.
  const articles = document.querySelectorAll('article');
  if (articles.length === 1) return articles[0];

  // 3. Fallback to common class-based content areas
  const fallbackSelectors = [
    '.post-content', '.article-content', '.entry-content',
    '.article-body', '.article__body', '.post-body', '.story-body', '.content-body',
    '.post-text', '.entry-text'
  ];
  for (const sel of fallbackSelectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }

  // 4. If nothing else matches, use the whole body
  return document.body;
}

const CHROME_SELECTOR = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], .sidebar, #sidebar, .nav, #nav, .menu, #menu, .footer, #footer';

function findVisibleParagraphs() {
  const scope = findMainContentScope();
  const excludeChrome = scope === document.body;
  const candidates = scope.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, td, figcaption, dd');
  return Array.from(candidates).filter(el => {
    if (el.dataset.aiWrapped) return false;
    if (el.closest('[data-ai-wrapped]')) return false;
    if (excludeChrome && el.closest(CHROME_SELECTOR)) return false;
    const text = el.innerText?.trim();
    if (!text || text.length < 20) return false;
    const rect = el.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  });
}

async function wrapAndTranslate(el) {
  el.dataset.aiWrapped = '1';
  const pos = window.getComputedStyle(el).position;
  if (pos === 'static') el.style.position = 'relative';

  const originalNodes = [...el.childNodes];
  const originalSpan = document.createElement('span');
  originalSpan.className = 'ai-para-original';
  while (el.firstChild) originalSpan.appendChild(el.firstChild);
  const translatedSpan = document.createElement('span');
  translatedSpan.className = 'ai-para-translated';
  el.append(originalSpan, translatedSpan);
  el.classList.add('ai-para-wrap');

  function restore() {
    el.replaceChildren(...originalNodes);
    el.classList.remove('ai-para-wrap', 'show-translation');
    delete el.dataset.aiWrapped;
    if (pos === 'static') el.style.position = '';
  }

  const btn = document.createElement('button');
  btn.className = 'ai-toggle-btn ai-loading-btn';
  btn.textContent = '…';
  btn.title = browser.i18n.getMessage('translating');
  el.appendChild(btn);

  const text = originalSpan.innerText?.trim();
  if (!text) {
    restore();
    return;
  }

  try {
    const response = await browser.runtime.sendMessage({ action: 'translateParagraph', text });
    if (!response.success) throw new Error(response.error);
    log('[PageGrep] paragraph translated:', { original: text.slice(0, 60), result: response.result.slice(0, 60) });
    translatedSpan.textContent = response.result;
    el.classList.add('show-translation');
    btn.classList.remove('ai-loading-btn');
    setToggleIcon(btn, true);
    btn.title = browser.i18n.getMessage('showOriginal');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const showing = el.classList.toggle('show-translation');
      log(`[PageGrep] toggle paragraph → ${showing ? 'translation' : 'original'}`);
      setToggleIcon(btn, showing);
      btn.title = browser.i18n.getMessage(showing ? 'showOriginal' : 'showTranslated');
    });
  } catch (err) {
    error('[PageGrep] paragraph translation failed:', err.message);
    restore();
    if (isApiKeyError(err.message)) showApiKeyToast();
  }
}

// --- Summary ---

const HOVER_ELEMENTS = new Set();

function hoverElement(el, type) {
  const color = type === 'summary' ? '168, 85, 247' : '99, 102, 241';
  el.style.setProperty('outline', `2px solid rgba(${color}, 0.6)`, 'important');
  el.style.setProperty('background-color', `rgba(${color}, 0.1)`, 'important');
  el.style.setProperty('border-radius', '4px', 'important');
  HOVER_ELEMENTS.add(el);
}

function unhoverElement(el) {
  el.style.removeProperty('outline');
  el.style.removeProperty('background-color');
  el.style.removeProperty('border-radius');
  HOVER_ELEMENTS.delete(el);
}

function flashElement(el, type) {
  const color = type === 'summary' ? '168, 85, 247' : '99, 102, 241';
  el.animate([
    { boxShadow: `0 0 0 0 rgba(${color}, 0.9)`, backgroundColor: `rgba(${color}, 0.28)`, outline: `3px solid rgba(${color}, 1)`, borderRadius: '4px' },
    { boxShadow: `0 0 0 18px rgba(${color}, 0)`, backgroundColor: `rgba(${color}, 0.06)`, outline: `2px solid rgba(${color}, 0.3)`, borderRadius: '4px' },
    { boxShadow: `0 0 0 0 rgba(${color}, 0)`, backgroundColor: 'transparent', outline: '2px solid transparent', borderRadius: '4px' }
  ], { duration: 900, easing: 'ease-out' });
}

function clearAllHighlights() {
  HOVER_ELEMENTS.forEach(el => unhoverElement(el));
}

function updateSummarySidebar(points, elements) {
  SUMMARY_STATE.points = points;
  SUMMARY_STATE.elements = elements;
  clearAllHighlights();
  browser.runtime.sendMessage({ action: 'summaryUpdated', points });
  browser.runtime.sendMessage({ action: 'openSidebar' });
}

function detectPageLanguage() {
  const lang = (document.documentElement.lang || '').toLowerCase();
  if (lang.startsWith('zh')) return 'Chinese';
  if (lang.startsWith('ja')) return 'Japanese';
  if (lang.startsWith('ko')) return 'Korean';
  // Fall back to content analysis
  const sample = document.body?.innerText?.slice(0, 600) || '';
  const cjkChars = (sample.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  if (cjkChars > 15) return 'Chinese';
  return 'English';
}

async function runSummaryFromPage() {
  log('[PageGrep] runSummary triggered');
  const elements = collectPageElements();
  const pageLanguage = detectPageLanguage();
  log(`[PageGrep] summary: collected ${elements.length} page elements, language: ${pageLanguage}`);
  if (elements.length === 0) {
    browser.runtime.sendMessage({ action: 'summaryError', error: browser.i18n.getMessage('noAnalyzableContent') });
    return;
  }

  try {
    const response = await browser.runtime.sendMessage({
      action: 'summarize',
      elements: elements.map(e => e.text),
      pageLanguage,
    });

    if (!response.success) throw new Error(response.error);
    log(`[PageGrep] summary: received ${response.points.length} points`, response.points);
    updateSummarySidebar(response.points, elements);
  } catch (err) {
    error('[PageGrep] summary: failed:', err.message);
    browser.runtime.sendMessage({ action: 'summaryError', error: err.message });
  }
}

// --- Interest Highlighting ---

function collectPageElements() {
  if (location.hostname.endsWith('news.ycombinator.com')) {
    const hn = collectHackerNewsElements();
    if (hn.length > 0) return hn;
  }

  const scope = findMainContentScope();

  // 1. Detect if it is likely an article page first.
  // We look for many long paragraphs. If we see a high density of text in paragraphs,
  // it is almost certainly an article page, even if there are sidebar lists.
  const paras = Array.from(scope.querySelectorAll('p')).filter(p => {
    const text = p.innerText?.trim() || '';
    return text.length > 100 && !p.closest(CHROME_SELECTOR);
  });

  const isLikelyArticle = paras.length >= 3;
  if (isLikelyArticle) {
    log(`[PageGrep] article-style collection (detected ${paras.length} long paragraphs)`);
    return collectArticleElements(scope);
  }

  // 2. Otherwise try list-style collection (grouping headlines + snippets)
  const listItems = collectGenericListElements(scope);
  if (listItems && listItems.length >= 4) {
    log(`[PageGrep] list-style collection: found ${listItems.length} items`);
    return listItems.slice(0, 140);
  }

  // 3. Fallback to article-style collection if list items are few or detection failed
  log(`[PageGrep] fallback to article-style collection`);
  return collectArticleElements(scope);
}

function collectArticleElements(scope) {
  const excludeChrome = scope === document.body;
  const seen = new Set();
  const results = [];
  const candidates = scope.querySelectorAll('h1, h2, h3, h4, h5, h6, li, p, blockquote, dt, dd, figcaption');
  for (const el of candidates) {
    if (excludeChrome && el.closest(CHROME_SELECTOR)) continue;
    const text = el.innerText?.trim().replace(/\s+/g, ' ');
    if (!text || text.length < 10 || text.length > 3000) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    results.push({ el, text });
    if (results.length >= 180) break;
  }
  return results;
}

function collectGenericListElements(scope) {
  const itemSelectors = [
    'article',
    'section',
    '.post', '.entry', '.item', '.card', '.story', '.topic',
    '[class*="post-"]', '[class*="item-"]', '[class*="card-"]', '[class*="article-"]',
    'li'
  ];

  let candidates = [];
  for (const sel of itemSelectors) {
    const found = Array.from(scope.querySelectorAll(sel)).filter(el => {
      if (el.closest(CHROME_SELECTOR)) return false;
      return el.querySelector('h1, h2, h3, h4, h5, h6, a[class*="title"], a[class*="headline"]');
    });
    if (found.length >= 4) {
      candidates = found;
      break;
    }
  }

  if (candidates.length < 4) {
    const headings = scope.querySelectorAll('h2, h3, h4');
    if (headings.length >= 5) {
      const parents = new Set();
      headings.forEach(h => {
        const parent = h.parentElement;
        if (parent && parent !== scope && parent !== document.body && !parent.closest(CHROME_SELECTOR)) {
          parents.add(parent);
        }
      });
      if (parents.size >= 4) candidates = Array.from(parents);
    }
  }

  if (candidates.length < 4) return null;

  const results = [];
  const seen = new Set();

  candidates.forEach(container => {
    const head = container.querySelector('h1, h2, h3, h4, h5, h6, .title, .headline, [class*="title"], [class*="headline"]');
    const title = head?.innerText?.trim();
    if (!title || title.length < 6) return;

    const p = container.querySelector('p, .excerpt, .dek, .summary, .description, [class*="excerpt"], [class*="summary"], [class*="description"]');
    const snippet = p?.innerText?.trim();

    if (seen.has(title)) return;
    seen.add(title);

    let text = `[item] ${title}`;
    if (snippet && snippet.length > 10) {
      const cleanSnippet = snippet.replace(/\s+/g, ' ').slice(0, 240);
      text += ` — ${cleanSnippet}${snippet.length > 240 ? '...' : ''}`;
    }

    results.push({ el: container, text, label: title });
  });

  return results.length >= 4 ? results : null;
}

function collectHackerNewsElements() {
  const results = [];
  const seen = new Set();
  const rows = document.querySelectorAll('tr.athing');
  rows.forEach(row => {
    const titleEl = row.querySelector('.titleline a');
    const subtext = row.nextElementSibling?.querySelector('.subtext');
    const title = titleEl?.innerText?.trim();
    if (!title) return;

    const score = subtext?.querySelector('.score')?.innerText?.trim();
    const user = subtext?.querySelector('.hnuser')?.innerText?.trim();
    const age = subtext?.querySelector('.age')?.innerText?.trim();
    const comments = subtext?.querySelector('a:last-of-type')?.innerText?.trim();
    const site = row.querySelector('.sitebit a')?.innerText?.trim();
    const tags = inferHackerNewsTags(title, site);

    const metaParts = [score, user ? `by ${user}` : null, age, comments, site ? `source ${site}` : null]
      .filter(Boolean)
      .join(' · ');

    const tagText = tags.length ? `tags=${tags.join(',')}` : '';
    const prefix = ['story', score ? score.replace(/\s+/g, '') : null, comments ? comments.replace(/\s+/g, '') : null, tagText]
      .filter(Boolean)
      .map(t => `[${t}]`)
      .join('');
    const text = metaParts ? `${prefix} ${title} — ${metaParts}` : `${prefix} ${title}`;
    if (seen.has(text)) return;
    seen.add(text);
    results.push({ el: row, text, label: title });
  });

  const commentEls = document.querySelectorAll('.comment-tree .commtext');
  commentEls.forEach(el => {
    const text = el.innerText?.trim().replace(/\s+/g, ' ');
    if (!text || text.length < 20 || text.length > 260) return;
    if (seen.has(text)) return;
    seen.add(text);
    results.push({ el, text: `[comment] ${text}`, label: text });
  });

  return results.slice(0, 160);
}

function inferHackerNewsTags(title, site) {
  const haystack = `${title} ${site || ''}`.toLowerCase();
  const tags = new Set();
  const rules = [
    { tag: 'ai', words: ['ai', 'ml', 'llm', 'neural', 'openai', 'anthropic', 'model'] },
    { tag: 'dev', words: ['release', 'v', 'version', 'compiler', 'runtime', 'sdk', 'framework', 'library', 'api', 'tool'] },
    { tag: 'security', words: ['security', 'vuln', 'vulnerability', 'exploit', 'breach', 'malware', 'ransomware'] },
    { tag: 'systems', words: ['kernel', 'os', 'linux', 'network', 'database', 'infra', 'cloud', 'server'] },
    { tag: 'hardware', words: ['chip', 'cpu', 'gpu', 'hardware', 'device', 'iphone', 'macbook', 'battery'] },
    { tag: 'data', words: ['data', 'dataset', 'benchmark', 'analytics', 'statistics'] },
    { tag: 'business', words: ['startup', 'funding', 'acquisition', 'ipo', 'company', 'business'] },
    { tag: 'policy', words: ['policy', 'law', 'regulation', 'court', 'legal', 'government'] }
  ];
  rules.forEach(rule => {
    if (rule.words.some(w => haystack.includes(w))) tags.add(rule.tag);
  });
  return Array.from(tags).slice(0, 2);
}


async function runInterestingFromPage() {
  log('[PageGrep] ★ (highlight) clicked');
  const { userInterests } = await browser.storage.local.get([STORAGE_KEYS.USER_INTERESTS]);
  if (!userInterests) {
    warn('[PageGrep] ★: no user interests set');
    browser.runtime.sendMessage({ action: 'highlightError', error: browser.i18n.getMessage('setInterestsFirst') });
    return;
  }

  const elements = collectPageElements();
  HIGHLIGHT_STATE.elements = elements;
  log(`[PageGrep] ★: collected ${elements.length} elements, interests: "${userInterests}"`);
  if (elements.length === 0) {
    browser.runtime.sendMessage({ action: 'highlightError', error: browser.i18n.getMessage('noAnalyzableContent') });
    return;
  }

  try {
    const response = await browser.runtime.sendMessage({
      action: 'findInteresting',
      interests: userInterests,
      elements: elements.map(e => e.text),
    });

    if (!response.success) throw new Error(response.error);
    log(`[PageGrep] ★: matched items:`, response.items);

    const items = response.items
      .filter(item => elements[item.index])
      .map(item => ({ index: item.index, text: elements[item.index].label || elements[item.index].text, reason: item.reason }));
    HIGHLIGHT_STATE.items = items;
    browser.runtime.sendMessage({ action: 'highlightDone', items });
    log(`[PageGrep] ★: found ${items.length} interesting elements`);
  } catch (err) {
    error('[PageGrep] ★: highlight failed:', err.message);
    browser.runtime.sendMessage({ action: 'highlightError', error: err.message });
  }
}

// --- Message listeners ---

browser.runtime.onMessage.addListener((message) => {
  if (message.action === 'getSummaryData') {
    return Promise.resolve({ points: SUMMARY_STATE.points || [] });
  }

  if (message.action === 'getHighlightData') {
    return Promise.resolve({ items: HIGHLIGHT_STATE.items || [] });
  }

  if (message.action === 'summaryHover') {
    const target = SUMMARY_STATE.elements?.[message.index]?.el;
    if (target) {
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
    if (target) {
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
    if (target) hoverElement(target, 'highlight');
    return;
  }

  if (message.action === 'highlightUnhover') {
    const target = HIGHLIGHT_STATE.elements?.[message.index]?.el;
    if (target) unhoverElement(target);
    return;
  }

  if (message.action === 'highlightClick') {
    const target = HIGHLIGHT_STATE.elements?.[message.index]?.el;
    if (target) {
      log(`[PageGrep] interesting item clicked (sidebar): index ${message.index}`);
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flashElement(target, 'highlight');
    }
    return;
  }
});

// --- Domain Block (right-click float panel) ---

function showPanelContextMenu(x, y) {
  document.getElementById('ai-panel-menu')?.remove();
  const hostname = location.hostname;
  const menu = document.createElement('div');
  menu.id = 'ai-panel-menu';
  browser.storage.local.get(STORAGE_KEYS.THEME).then(({ theme }) => {
    const isDark = theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) menu.classList.add('dark');
  });
  const item = document.createElement('button');
  item.textContent = browser.i18n.getMessage('hideOnSite', [hostname]) || `Hide on ${hostname}`;
  item.addEventListener('click', async () => {
    document.removeEventListener('mousedown', onOutsideMousedown);
    menu.remove();
    const { blockedDomains } = await browser.storage.local.get(STORAGE_KEYS.BLOCKED_DOMAINS);
    const list = Array.isArray(blockedDomains) ? blockedDomains : [];
    if (!list.includes(hostname)) {
      await browser.storage.local.set({ [STORAGE_KEYS.BLOCKED_DOMAINS]: [...list, hostname] });
    }
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById('ai-trash-zone')?.remove();
  });
  menu.appendChild(item);
  menu.style.cssText = `left:${x}px;top:${y}px`;
  document.body.appendChild(menu);
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) menu.style.left = (x - rect.width) + 'px';
    if (rect.bottom > window.innerHeight - 8) menu.style.top = (y - rect.height) + 'px';
  });
  const onOutsideMousedown = (e) => {
    if (menu.contains(e.target)) return;
    menu.remove();
    document.removeEventListener('mousedown', onOutsideMousedown);
  };
  setTimeout(() => document.addEventListener('mousedown', onOutsideMousedown), 0);
}

// --- Text Selection Translate ---

const SELECTION_BTN_ID = 'ai-selection-btn';
const SELECTION_RESULT_ID = 'ai-selection-result';

let selectionTranslateEnabled = false;

function showToast(msg) {
  let toast = document.getElementById('ai-toast');
  if (!toast) {
    injectStyles();
    toast = document.createElement('div');
    toast.id = 'ai-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.pointerEvents = '';
  clearTimeout(toast._hideTimer);
  toast.classList.add('ai-toast-show');
  toast._hideTimer = setTimeout(() => toast.classList.remove('ai-toast-show'), 2000);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  showToast(browser.i18n.getMessage('copied') || 'Copied ✓');
}

async function saveArticleToClipboard(btn) {
  if (btn) { btn.disabled = true; btn.classList.add('ai-loading-btn'); }
  try {
    const lines = collectArticleText();
    if (lines.length === 0) { showToast(browser.i18n.getMessage('noAnalyzableContent') || 'No content found'); return; }
    const markdown = `# ${document.title || location.hostname}\n\n${location.href}\n\n${lines.join('\n\n')}\n`;
    await copyToClipboard(markdown);
  } catch (_) {
    showToast(browser.i18n.getMessage('operationFailed') || 'Copy failed');
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('ai-loading-btn'); }
  }
}

function removeSelectionUI() {
  document.getElementById(SELECTION_BTN_ID)?.remove();
  document.getElementById(SELECTION_RESULT_ID)?.remove();
}

function positionSelectionEl(el, anchorLeft, anchorTop, anchorBottom) {
  requestAnimationFrame(() => {
    const GAP = 8;
    const MARGIN = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(w / 2 + MARGIN, Math.min(window.innerWidth - w / 2 - MARGIN, anchorLeft));
    const top = (anchorTop - h - GAP >= MARGIN) ? anchorTop - h - GAP : anchorBottom + GAP;
    el.style.left = (left - w / 2) + 'px';
    el.style.top = top + 'px';
  });
}

function showSelectionResult(anchorLeft, anchorTop, anchorBottom, text) {
  document.getElementById(SELECTION_BTN_ID)?.remove();
  const popup = document.createElement('div');
  popup.id = SELECTION_RESULT_ID;
  popup.classList.add('ai-sel-loading');
  popup.textContent = browser.i18n.getMessage('translating');
  popup.style.cssText = 'left:-9999px;top:-9999px';
  document.body.appendChild(popup);
  positionSelectionEl(popup, anchorLeft, anchorTop, anchorBottom);

  browser.runtime.sendMessage({ action: 'translateParagraph', text })
    .then(response => {
      if (!response.success) throw new Error(response.error || 'Translation failed');
      popup.classList.remove('ai-sel-loading');
      popup.textContent = response.result;
      const saveLink = document.createElement('button');
      saveLink.className = 'ai-sel-save-link';
      saveLink.textContent = browser.i18n.getMessage('copyMarkdown') || 'Copy';
      saveLink.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        copyToClipboard(`> ${text}\n\n**Translation:** ${response.result}\n\n*[${document.title}](${location.href})*\n`);
        saveLink.textContent = browser.i18n.getMessage('copied') || 'Copied ✓';
        saveLink.disabled = true;
      });
      popup.appendChild(saveLink);
      positionSelectionEl(popup, anchorLeft, anchorTop, anchorBottom);
    })
    .catch(err => {
      popup.classList.remove('ai-sel-loading');
      popup.classList.add('ai-sel-error');
      popup.textContent = '\u26a0 ' + (err.message || 'Translation failed');
      if (isApiKeyError(err.message)) showApiKeyToast();
    });
}

function onTextSelectionEnd(e) {
  if (!selectionTranslateEnabled) return;
  if (e.target.closest('#' + SELECTION_BTN_ID) || e.target.closest('#' + SELECTION_RESULT_ID)) return;

  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) {
    document.getElementById(SELECTION_BTN_ID)?.remove();
    return;
  }
  if (sel.toString().trim().length < 3) {
    document.getElementById(SELECTION_BTN_ID)?.remove();
    return;
  }

  let rect;
  try { rect = sel.getRangeAt(0).getBoundingClientRect(); } catch (_) { return; }
  if (!rect || (!rect.width && !rect.height)) return;

  const anchorLeft = rect.left + rect.width / 2;
  const anchorTop = rect.top;
  const anchorBottom = rect.bottom;
  const capturedText = sel.toString().trim();

  document.getElementById(SELECTION_BTN_ID)?.remove();
  injectStyles();

  // Detect if selection is inside an already-translated paragraph
  let translatedWrap = null;
  try {
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    translatedWrap = el?.closest('.ai-para-wrap.show-translation') || null;
  } catch (_) {}

  const container = document.createElement('div');
  container.id = SELECTION_BTN_ID;
  container.style.cssText = 'left:-9999px;top:-9999px';

  if (translatedWrap) {
    // Selection is inside a translated paragraph — replace translate btn with "↩ Original"
    const showOrigBtn = document.createElement('button');
    showOrigBtn.className = 'ai-sel-action-btn ai-sel-translate-btn';
    const undoSvg = _svgParser.parseFromString(TOGGLE_ORIGINAL_ICON, 'image/svg+xml').documentElement;
    undoSvg.setAttribute('width', '13');
    undoSvg.setAttribute('height', '13');
    showOrigBtn.appendChild(undoSvg);
    showOrigBtn.appendChild(document.createTextNode('\u00a0' + (browser.i18n.getMessage('showOriginal') || 'Original')));
    showOrigBtn.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      window.getSelection()?.removeAllRanges();
      document.getElementById(SELECTION_BTN_ID)?.remove();
      translatedWrap.classList.remove('show-translation');
      const toggleBtn = translatedWrap.querySelector('.ai-toggle-btn');
      if (toggleBtn) setToggleIcon(toggleBtn, false);
    });

    const copyOrigBtn = document.createElement('button');
    copyOrigBtn.className = 'ai-sel-action-btn ai-sel-save-btn';
    copyOrigBtn.textContent = browser.i18n.getMessage('copyWithOriginal') || 'Copy + Original';
    copyOrigBtn.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      window.getSelection()?.removeAllRanges();
      document.getElementById(SELECTION_BTN_ID)?.remove();
      const originalText = translatedWrap.querySelector('.ai-para-original')?.innerText?.trim() || '';
      const text = originalText
        ? `${originalText}\n\n↳ ${capturedText}\n\n*[${document.title}](${location.href})*\n`
        : `> ${capturedText}\n\n*[${document.title}](${location.href})*\n`;
      copyToClipboard(text);
    });

    container.appendChild(showOrigBtn);
    container.appendChild(copyOrigBtn);
  } else {
    // Normal selection — original behavior
    const translateBtn = document.createElement('button');
    translateBtn.className = 'ai-sel-action-btn ai-sel-translate-btn';
    const svgEl = _svgParser.parseFromString(TRANSLATE_ICON, 'image/svg+xml').documentElement;
    svgEl.setAttribute('width', '13');
    svgEl.setAttribute('height', '13');
    svgEl.style.pointerEvents = 'none';
    translateBtn.appendChild(svgEl);
    translateBtn.appendChild(document.createTextNode('\u00a0' + (browser.i18n.getMessage('translateSelection') || 'Translate')));
    translateBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.getSelection()?.removeAllRanges();
      showSelectionResult(anchorLeft, anchorTop, anchorBottom, capturedText);
    });

    const saveSelBtn = document.createElement('button');
    saveSelBtn.className = 'ai-sel-action-btn ai-sel-save-btn';
    saveSelBtn.textContent = browser.i18n.getMessage('copyMarkdown') || 'Copy';
    saveSelBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.getSelection()?.removeAllRanges();
      document.getElementById(SELECTION_BTN_ID)?.remove();
      copyToClipboard(`> ${capturedText}\n\n*[${document.title}](${location.href})*\n`);
    });

    container.appendChild(translateBtn);
    container.appendChild(saveSelBtn);
  }

  document.body.appendChild(container);
  positionSelectionEl(container, anchorLeft, anchorTop, anchorBottom);
}

document.addEventListener('mouseup', onTextSelectionEnd);
document.addEventListener('mousedown', (e) => {
  if (e.target.closest('#' + SELECTION_BTN_ID) || e.target.closest('#' + SELECTION_RESULT_ID)) return;
  removeSelectionUI();
});

// --- i18n initialization ---

async function initI18n() {
  try {
    const { uiLang } = await browser.storage.local.get(STORAGE_KEYS.UI_LANG);
    if (!uiLang) return;
    const url = browser.runtime.getURL(`_locales/${uiLang}/messages.json`);
    const resp = await fetch(url);
    if (!resp.ok) return;
    const messages = await resp.json();
    const orig = browser.i18n.getMessage.bind(browser.i18n);
    browser.i18n.getMessage = function(key, substitutions) {
      const entry = messages[key];
      if (!entry) return orig(key, substitutions);
      let msg = entry.message;
      if (substitutions && entry.placeholders) {
        const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
        Object.keys(entry.placeholders).forEach((name, idx) => {
          msg = msg.replace(new RegExp('\\$' + name + '\\$', 'gi'), subs[idx] ?? '');
        });
      }
      return msg;
    };
  } catch (_) {}
}

// --- Initialization ---

log('[PageGrep] content script loaded', location.href);
browser.storage.local.get([STORAGE_KEYS.SHOW_FLOAT_BTN, STORAGE_KEYS.BLOCKED_DOMAINS]).then(async ({ showFloatBtn, blockedDomains }) => {
  await initI18n();
  selectionTranslateEnabled = true;
  const blocked = Array.isArray(blockedDomains) ? blockedDomains : [];
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
          browser.storage.local.remove(STORAGE_KEYS.PANEL_POSITION);
          createFloatButton();
        }
      });
    } else {
      document.getElementById(FLOAT_BTN_ID)?.remove();
      document.getElementById('ai-scratchpad-btn')?.remove();
      clearAllHighlights();
      removePanelIfEmpty();
    }
  }
  if (STORAGE_KEYS.BLOCKED_DOMAINS in changes) {
    const blocked = Array.isArray(changes[STORAGE_KEYS.BLOCKED_DOMAINS].newValue)
      ? changes[STORAGE_KEYS.BLOCKED_DOMAINS].newValue : [];
    if (blocked.includes(location.hostname)) {
      document.getElementById(FLOAT_BTN_ID)?.remove();
      document.getElementById('ai-scratchpad-btn')?.remove();
      clearAllHighlights();
      removePanelIfEmpty();
    } else {
      browser.storage.local.get(STORAGE_KEYS.SHOW_FLOAT_BTN).then(({ showFloatBtn }) => {
        if (showFloatBtn !== false) {
          createFloatButton();
        }
      });
    }
  }
  if (STORAGE_KEYS.THEME in changes) {
    applyThemeToPanel();
  }
  if (STORAGE_KEYS.UI_LANG in changes) {
    initI18n();
  }
});
