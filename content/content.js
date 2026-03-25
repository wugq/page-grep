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

// --- Content collection thresholds ---
const MAX_DESCENT_DEPTH    = 8;    // findWidestTextBlock recursion limit
const MIN_PARA_TEXT_LENGTH = 40;   // min paragraph length to count as content
const MIN_BLOCK_TEXT_LENGTH = 300; // min block text length to be a descent candidate
const WIDTH_DOMINANCE_RATIO = 1.4; // width ratio to treat one block as dominant
const MAX_ARTICLE_LINES    = 200;  // max lines for copy-to-clipboard
const MAX_ARTICLE_ELEMENTS = 180;  // max elements in article-mode collection
const MAX_LIST_ELEMENTS    = 140;  // max elements in list-mode collection
const MAX_HN_ELEMENTS      = 160;  // max elements on HackerNews

// Pre-compiled regexes for translated text link-marker processing
const LINK_MATCH_RE = /[\[【]LINK(\d+)_START[\]】]([\s\S]*?)[\[【]LINK\d+_END[\]】]/g;
const LINK_STRIP_RE = /[\[【]LINK\d+_(?:START|END)[\]】]/g;

// --- Theme helper ---

async function applyThemeToPanel() {
  const { theme } = await browser.storage.local.get(STORAGE_KEYS.THEME);
  document.getElementById(PANEL_ID)?.classList.toggle('dark', isThemeDark(theme));
}

// --- Domain blocklist helper ---

async function blockCurrentDomain() {
  const hostname = location.hostname;
  if (!hostname) return;
  const { blockedDomains } = await browser.storage.local.get(STORAGE_KEYS.BLOCKED_DOMAINS);
  const list = Array.isArray(blockedDomains) ? blockedDomains : [];
  if (!list.includes(hostname)) {
    await browser.storage.local.set({ [STORAGE_KEYS.BLOCKED_DOMAINS]: [...list, hostname] });
  }
}

// --- Shared panel ---

function getOrCreatePanel() {
  let panel = document.getElementById(PANEL_ID);
  if (!panel) {
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
  if (depth > MAX_DESCENT_DEPTH) return container;
  // If we already have ≥3 direct paragraphs, this is the content node.
  const directParas = Array.from(container.children).filter(
    c => c.tagName === 'P' && (c.innerText?.trim() || '').length > MIN_PARA_TEXT_LENGTH
  );
  if (directParas.length >= 3) return container;
  const blockChildren = Array.from(container.children).filter(el => {
    if (!['DIV', 'SECTION', 'ARTICLE', 'MAIN'].includes(el.tagName)) return false;
    if (el.tagName === 'ASIDE') return false;
    if (el.closest(CHROME_SELECTOR)) return false;
    return (el.innerText?.trim() || '').length > MIN_BLOCK_TEXT_LENGTH;
  });
  if (blockChildren.length === 0) return container;
  if (blockChildren.length === 1) return findWidestTextBlock(blockChildren[0], depth + 1);
  // Multiple candidates: if widths differ significantly, pick the widest.
  const maxW = Math.max(...blockChildren.map(c => c.offsetWidth));
  const minW = Math.min(...blockChildren.map(c => c.offsetWidth));
  if (maxW / (minW || 1) > WIDTH_DOMINANCE_RATIO) {
    const widest = blockChildren.reduce((a, b) => a.offsetWidth > b.offsetWidth ? a : b);
    return findWidestTextBlock(widest, depth + 1);
  }
  // Otherwise follow the longest text block.
  return findWidestTextBlock(
    blockChildren.reduce((a, b) => (a.innerText?.length || 0) > (b.innerText?.length || 0) ? a : b),
    depth + 1
  );
}

// Note: findMainContentScope() below serves a similar purpose but targets a broader
// "content area" scope. findArticleBodyEl targets the specific article body element.
// Step 2 here is intentionally kept separate from findMainContentScope: returning the
// <article> directly avoids the width-based descent into sub-blocks, which is correct
// for copy-to-clipboard (we want the full article container, not a narrower child).
function findArticleBodyEl() {
  // 1. Explicit semantic/class markers
  const explicit = document.querySelector(
    '[itemprop="articleBody"],[class*="article-body"],[class*="article-content"],' +
    '[class*="post-content"],[class*="entry-content"],[class*="news-content"],' +
    '[class*="story-body"],[class*="article__body"],[class*="post-body"]'
  );
  if (explicit) return explicit;

  // 2. Single <article> element — return directly without width-based descent
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
    if (lines.length >= MAX_ARTICLE_LINES) break;
  }
  return lines;
}

// --- API key error helpers ---

function isApiKeyError(msg, code) {
  if (code === 'NO_API_KEY') return true;
  const noKeyMsg = browser.i18n.getMessage('enterApiKey');
  return msg === noKeyMsg;
}

function throwFromResponse(response) {
  const err = new Error(response.error);
  if (response.code) err.code = response.code;
  throw err;
}

function showApiKeyToast() {
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
  link.textContent = browser.i18n.getMessage('settingsLinkLabel') || 'Settings';
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
  let _trashZoneEl = null;   // cached element reference during drag
  let _trashZoneRect = null; // cached rect during drag to avoid getBoundingClientRect on every mousemove
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
    if (!_trashZoneRect) return false;
    return clientX >= _trashZoneRect.left && clientX <= _trashZoneRect.right &&
           clientY >= _trashZoneRect.top  && clientY <= _trashZoneRect.bottom;
  }

  function onDragStart(e) {
    if (isDragging) return;
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
      _trashZoneEl = getOrCreateTrashZone();
      _trashZoneEl.classList.add('visible');
      _trashZoneRect = _trashZoneEl.getBoundingClientRect(); // cache once; zone is fixed-position
    }

    if (!hasMoved) return;

    const panelW = panel.offsetWidth;
    const panelH = panel.offsetHeight;
    const newLeft = Math.max(0, Math.min(window.innerWidth - panelW, startLeft + dx));
    const newTop = Math.max(0, Math.min(window.innerHeight - panelH, startTop + dy));

    panel.style.left = newLeft + 'px';
    panel.style.top = newTop + 'px';

    if (_trashZoneEl) _trashZoneEl.classList.toggle('active', isOverTrashZone(point.clientX, point.clientY));
  }

  function onDragEnd(e) {
    if (!isDragging) return;
    isDragging = false;
    panel.style.cursor = '';

    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('touchmove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    document.removeEventListener('touchend', onDragEnd);

    const zone = _trashZoneEl; // capture before clearing
    if (zone) zone.classList.remove('visible', 'active');

    if (!hasMoved) {
      _trashZoneEl = null;
      _trashZoneRect = null;
      return;
    }

    const point = e.changedTouches ? e.changedTouches[0] : e;
    const overTrash = isOverTrashZone(point.clientX, point.clientY);
    _trashZoneEl = null;
    _trashZoneRect = null;

    if (overTrash) {
      panel.remove();
      if (zone) zone.remove();
      blockCurrentDomain();
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
  const filtered = Array.from(candidates).filter(el => {
    if (el.dataset.aiWrapped) return false;
    if (el.closest('[data-ai-wrapped]')) return false;
    if (excludeChrome && el.closest(CHROME_SELECTOR)) return false;
    const text = el.innerText?.trim();
    if (!text || text.length < 20) return false;
    const rect = el.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  });
  // Drop ancestors: if el contains another candidate, only translate the inner one.
  return filtered.filter(el => !filtered.some(other => other !== el && el.contains(other)));
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

  const links = [];
  function extractTextWithPlaceholders(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeName === 'A') {
      const linkText = node.innerText.trim();
      if (!linkText) return '';
      const idx = links.length;
      links.push({ href: node.href });
      return `[LINK${idx}_START]${linkText}[LINK${idx}_END]`;
    }
    return Array.from(node.childNodes).map(extractTextWithPlaceholders).join('');
  }
  const text = extractTextWithPlaceholders(originalSpan).trim();
  if (!text) {
    restore();
    return;
  }

  try {
    const response = await browser.runtime.sendMessage({ action: 'translateParagraph', text, hasLinks: links.length > 0 });
    if (!response.success) throwFromResponse(response);
    log('[PageGrep] paragraph translated:', { original: text.slice(0, 60), result: response.result.slice(0, 60) });
    if (links.length > 0) {
      LINK_MATCH_RE.lastIndex = 0; // reset before reuse of module-level regex
      let lastIndex = 0;
      let match;
      while ((match = LINK_MATCH_RE.exec(response.result)) !== null) {
        if (match.index > lastIndex) {
          const t = response.result.slice(lastIndex, match.index).replace(LINK_STRIP_RE, '');
          if (t) translatedSpan.appendChild(document.createTextNode(t));
        }
        const link = links[parseInt(match[1])];
        if (link) {
          const a = document.createElement('a');
          a.href = link.href;
          a.textContent = match[2];
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          translatedSpan.appendChild(a);
        } else {
          translatedSpan.appendChild(document.createTextNode(match[2]));
        }
        lastIndex = LINK_MATCH_RE.lastIndex;
      }
      if (lastIndex < response.result.length) {
        const t = response.result.slice(lastIndex).replace(LINK_STRIP_RE, '');
        if (t) translatedSpan.appendChild(document.createTextNode(t));
      }
    } else {
      translatedSpan.textContent = response.result.replace(LINK_STRIP_RE, '');
    }
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
    if (isApiKeyError(err.message, err.code)) showApiKeyToast();
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

    if (!response.success) throwFromResponse(response);
    log(`[PageGrep] summary: received ${response.points.length} points`, response.points);
    updateSummarySidebar(response.points, elements);
  } catch (err) {
    error('[PageGrep] summary: failed:', err.message);
    browser.runtime.sendMessage({ action: 'summaryError', error: err.message, code: err.code });
  }
}

// --- Interest Highlighting ---

// Registry of site-specific element collectors. Add new entries here to support
// additional sites without modifying the general-purpose collection logic below.
const SITE_COLLECTORS = {
  'news.ycombinator.com': collectHackerNewsElements,
};

function collectPageElements() {
  for (const [domain, collector] of Object.entries(SITE_COLLECTORS)) {
    if (location.hostname.endsWith(domain)) {
      const result = collector();
      if (result.length > 0) return result;
    }
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
    return listItems.slice(0, MAX_LIST_ELEMENTS);
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
    if (results.length >= MAX_ARTICLE_ELEMENTS) break;
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

  return results.slice(0, MAX_HN_ELEMENTS);
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

    if (!response.success) throwFromResponse(response);
    log(`[PageGrep] ★: matched items:`, response.items);

    const textSeen = new Set();
    const items = response.items
      .filter(item => elements[item.index])
      .map(item => ({ index: item.index, text: elements[item.index].label || elements[item.index].text, reason: item.reason }))
      .filter(item => {
        const key = item.text.toLowerCase().slice(0, 60);
        if (textSeen.has(key)) return false;
        textSeen.add(key);
        return true;
      });
    HIGHLIGHT_STATE.items = items;
    browser.runtime.sendMessage({ action: 'highlightDone', items });
    log(`[PageGrep] ★: found ${items.length} interesting elements`);
  } catch (err) {
    error('[PageGrep] ★: highlight failed:', err.message);
    browser.runtime.sendMessage({ action: 'highlightError', error: err.message, code: err.code });
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

// --- Domain Block (right-click float panel) ---

function showPanelContextMenu(x, y) {
  document.getElementById('ai-panel-menu')?.remove();
  const hostname = location.hostname;
  const menu = document.createElement('div');
  menu.id = 'ai-panel-menu';
  if (isThemeDark(_cachedTheme)) menu.classList.add('dark');
  const item = document.createElement('button');
  item.textContent = browser.i18n.getMessage('hideOnSite', [hostname]) || `Hide on ${hostname}`;
  item.addEventListener('click', async () => {
    document.removeEventListener('mousedown', onOutsideMousedown);
    menu.remove();
    await blockCurrentDomain();
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
let _cachedTheme; // set on init and on storage change; used to avoid async reads in hot paths

function showToast(msg) {
  let toast = document.getElementById('ai-toast');
  if (!toast) {
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
  } catch (err) {
    error('[PageGrep] saveArticleToClipboard failed:', err.message);
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
      if (!response.success) throwFromResponse(response);
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
      if (isApiKeyError(err.message, err.code)) showApiKeyToast();
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

// i18n initialization delegates to the shared applyI18nOverride() from shared/i18n-override.js

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
      selectionTranslateEnabled = false;
      document.getElementById(FLOAT_BTN_ID)?.remove();
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
