// Content script - translation & interest highlighting

function devlog(level, ...args) {
  try {
    const fn = level === 'warn' ? console.warn : level === 'error' ? console.error : console.log;
    fn('[Reader]', ...args);
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
      right: -34px;
      width: 26px;
      height: 26px;
      background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
      color: white;
      border: none;
      border-radius: 50%;
      cursor: pointer;
      font-size: 11px;
      font-weight: bold;
      opacity: 0.8;
      transition: all 0.2s;
      z-index: 9999;
      padding: 0;
      box-shadow: 0 2px 6px rgba(99, 102, 241, 0.3);
    }
    .ai-toggle-btn:hover { opacity: 1; transform: scale(1.1); }
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
      position: fixed;
      bottom: 24px;
      right: 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      z-index: 2147483647;
      padding: 0;
    }
    .ai-panel-btn {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      font-size: 16px;
      font-weight: 700;
      color: white;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: "Plus Jakarta Sans", -apple-system, sans-serif;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
    }
    .ai-panel-btn:hover { transform: translateY(-2px); filter: brightness(1.1); box-shadow: 0 6px 16px rgba(99, 102, 241, 0.4); }
    .ai-panel-btn:active { transform: translateY(0) scale(0.95); }
    .ai-panel-btn:disabled { filter: grayscale(0.8); cursor: wait; }
    #ai-translate-btn { background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); }
    #ai-panel-close {
      position: absolute;
      top: -12px;
      right: -12px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 1px solid rgba(255,255,255,0.2);
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      color: white;
      background: #1e293b;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      pointer-events: none;
      transition: all 0.2s;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .dark #ai-panel-close {
      background: #475569;
      border-color: rgba(255,255,255,0.3);
    }
    #ai-reader-panel:hover #ai-panel-close {
      opacity: 1;
      pointer-events: auto;
    }
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

    const closeBtn = document.createElement('button');
    closeBtn.id = 'ai-panel-close';
    closeBtn.textContent = '×';
    closeBtn.title = '隐藏';
    closeBtn.addEventListener('click', () => {
      log('[Reader] × panel dismissed');
      panel.remove();
      browser.storage.local.set({ [STORAGE_KEYS.SHOW_FLOAT_BTN]: false });
    });
    panel.appendChild(closeBtn);

    document.body.appendChild(panel);
  }
  return panel;
}

function removePanelIfEmpty() {
  const panel = document.getElementById(PANEL_ID);
  // Only the close button remains — nothing useful left
  if (panel && panel.children.length <= 1) panel.remove();
}

// --- Translation ---

async function runTranslateOnPage(btn) {
  log('[Reader] 译 triggered');
  injectStyles();
  const visible = findVisibleParagraphs();
  log(`[Reader] 译: found ${visible.length} visible paragraphs`);
  if (visible.length === 0) {
    if (btn) { btn.title = '无可翻译内容'; setTimeout(() => { btn.title = '翻译屏幕内容'; }, 1500); }
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  let done = 0;
  await Promise.all(visible.map(async el => {
    await wrapAndTranslate(el);
    if (btn) btn.title = `翻译中 ${++done}/${visible.length}`;
  }));
  log(`[Reader] 译: done, translated ${visible.length} paragraphs`);
  if (btn) { btn.disabled = false; btn.textContent = '译'; btn.title = '翻译屏幕内容'; }
}

function createFloatButton() {
  if (document.getElementById(FLOAT_BTN_ID)) return;
  const panel = getOrCreatePanel();
  const btn = document.createElement('button');
  btn.id = FLOAT_BTN_ID;
  btn.className = 'ai-panel-btn';
  btn.textContent = '译';
  btn.title = '翻译屏幕内容';
  panel.appendChild(btn);
  btn.addEventListener('click', () => runTranslateOnPage(btn));
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

  const originalHTML = el.innerHTML;
  el.innerHTML = `<span class="ai-para-original">${originalHTML}</span><span class="ai-para-translated"></span>`;
  el.classList.add('ai-para-wrap');

  const btn = document.createElement('button');
  btn.className = 'ai-toggle-btn ai-loading-btn';
  btn.textContent = '…';
  btn.title = '翻译中...';
  el.appendChild(btn);

  const text = el.querySelector('.ai-para-original')?.innerText?.trim();
  if (!text) {
    el.innerHTML = originalHTML;
    el.classList.remove('ai-para-wrap');
    delete el.dataset.aiWrapped;
    if (pos === 'static') el.style.position = '';
    return;
  }

  try {
    const response = await browser.runtime.sendMessage({ action: 'translateParagraph', text });
    if (!response.success) throw new Error(response.error);
    log('[Reader] paragraph translated:', { original: text.slice(0, 60), result: response.result.slice(0, 60) });
    el.querySelector('.ai-para-translated').textContent = response.result;
    el.classList.add('show-translation');
    btn.classList.remove('ai-loading-btn');
    btn.textContent = '原';
    btn.title = '显示原文';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const showing = el.classList.toggle('show-translation');
      log(`[Reader] toggle paragraph → ${showing ? 'translation' : 'original'}`);
      btn.textContent = showing ? '原' : '译';
      btn.title = showing ? '显示原文' : '显示译文';
    });
  } catch (err) {
    error('[Reader] paragraph translation failed:', err.message);
    el.innerHTML = originalHTML;
    el.classList.remove('ai-para-wrap', 'show-translation');
    delete el.dataset.aiWrapped;
    if (pos === 'static') el.style.position = '';
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
  log('[Reader] runSummary triggered');
  const elements = collectPageElements();
  const pageLanguage = detectPageLanguage();
  log(`[Reader] summary: collected ${elements.length} page elements, language: ${pageLanguage}`);
  if (elements.length === 0) {
    browser.runtime.sendMessage({ action: 'summaryError', error: '无可分析内容' });
    return;
  }

  try {
    const response = await browser.runtime.sendMessage({
      action: 'summarize',
      elements: elements.map(e => e.text),
      pageLanguage,
    });

    if (!response.success) throw new Error(response.error);
    log(`[Reader] summary: received ${response.points.length} points`, response.points);
    updateSummarySidebar(response.points, elements);
  } catch (err) {
    error('[Reader] summary: failed:', err.message);
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
    log(`[Reader] article-style collection (detected ${paras.length} long paragraphs)`);
    return collectArticleElements(scope);
  }

  // 2. Otherwise try list-style collection (grouping headlines + snippets)
  const listItems = collectGenericListElements(scope);
  if (listItems && listItems.length >= 4) {
    log(`[Reader] list-style collection: found ${listItems.length} items`);
    return listItems.slice(0, 140);
  }

  // 3. Fallback to article-style collection if list items are few or detection failed
  log(`[Reader] fallback to article-style collection`);
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
  log('[Reader] ★ (highlight) clicked');
  const { userInterests } = await browser.storage.local.get([STORAGE_KEYS.USER_INTERESTS]);
  if (!userInterests) {
    warn('[Reader] ★: no user interests set');
    browser.runtime.sendMessage({ action: 'highlightError', error: '请先在插件中设置兴趣' });
    return;
  }

  const elements = collectPageElements();
  HIGHLIGHT_STATE.elements = elements;
  log(`[Reader] ★: collected ${elements.length} elements, interests: "${userInterests}"`);
  if (elements.length === 0) {
    browser.runtime.sendMessage({ action: 'highlightError', error: '无可分析内容' });
    return;
  }

  try {
    const response = await browser.runtime.sendMessage({
      action: 'findInteresting',
      interests: userInterests,
      elements: elements.map(e => e.text),
    });

    if (!response.success) throw new Error(response.error);
    log(`[Reader] ★: matched items:`, response.items);

    const items = response.items
      .filter(item => elements[item.index])
      .map(item => ({ index: item.index, text: elements[item.index].label || elements[item.index].text, reason: item.reason }));
    HIGHLIGHT_STATE.items = items;
    browser.runtime.sendMessage({ action: 'highlightDone', items });
    log(`[Reader] ★: found ${items.length} interesting elements`);
  } catch (err) {
    error('[Reader] ★: highlight failed:', err.message);
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
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
      log(`[Reader] summary item clicked (sidebar): index ${message.index}`);
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
      log(`[Reader] interesting item clicked (sidebar): index ${message.index}`);
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flashElement(target, 'highlight');
    }
    return;
  }
});

// --- Initialization ---

log('[Reader] content script loaded', location.href);
browser.storage.local.get([STORAGE_KEYS.SHOW_FLOAT_BTN]).then(({ showFloatBtn }) => {
  if (showFloatBtn !== false) createFloatButton();
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
      createFloatButton();
    } else {
      document.getElementById(FLOAT_BTN_ID)?.remove();
      clearAllHighlights();
      removePanelIfEmpty();
    }
  }
  if (STORAGE_KEYS.THEME in changes) {
    applyThemeToPanel();
  }
});
