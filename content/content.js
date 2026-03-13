// Content script - translation & interest highlighting

function devlog(level, ...args) {
  try {
    const fn = level === 'warn' ? console.warn : level === 'error' ? console.error : console.log;
    fn('[AI Reader]', ...args);
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
      background: #34a853;
      color: white;
      border: none;
      border-radius: 50%;
      cursor: pointer;
      font-size: 11px;
      font-weight: bold;
      opacity: 0.7;
      transition: opacity 0.15s;
      z-index: 9999;
      padding: 0;
      box-shadow: 0 1px 4px rgba(0,0,0,0.2);
    }
    .ai-toggle-btn:hover { opacity: 1; }
    .ai-loading-btn {
      background: #aaa;
      cursor: wait;
      animation: ai-pulse 0.9s ease-in-out infinite;
    }
    .ai-error-btn { background: #d32f2f; opacity: 1; }
    @keyframes ai-pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }
    .ai-highlight {
      background: #fff176 !important;
      outline: 2px solid #f9a825 !important;
      border-radius: 3px;
    }
    .ai-summary-highlight {
      background: #e8f0fe !important;
      outline: 2px solid #1a73e8 !important;
      border-radius: 3px;
    }
    .ai-summary-highlight-active {
      background: #c5d8fd !important;
      outline: 2px solid #1a73e8 !important;
    }
    .ai-summary-highlight-ping {
      animation: ai-summary-ping 0.8s ease-out !important;
    }
    @keyframes ai-highlight-ping {
      0%   { box-shadow: 0 0 0 0 rgba(249, 168, 37, 0.9); }
      60%  { box-shadow: 0 0 0 14px rgba(249, 168, 37, 0); }
      100% { box-shadow: 0 0 0 0 rgba(249, 168, 37, 0); }
    }
    @keyframes ai-summary-ping {
      0%   { box-shadow: 0 0 0 0 rgba(26, 115, 232, 0.7); }
      60%  { box-shadow: 0 0 0 16px rgba(26, 115, 232, 0); }
      100% { box-shadow: 0 0 0 0 rgba(26, 115, 232, 0); }
    }
    .ai-highlight-active {
      animation: ai-highlight-ping 0.7s ease-out !important;
    }
    #ai-reader-panel {
      position: fixed;
      bottom: 24px;
      right: 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      z-index: 2147483647;
      padding: 0;
    }
    .ai-panel-btn {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      font-size: 13px;
      font-weight: 700;
      color: white;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      transition: transform 0.12s, filter 0.12s;
    }
    .ai-panel-btn:hover { transform: scale(1.12); filter: brightness(1.15); }
    .ai-panel-btn:active { transform: scale(0.92); }
    .ai-panel-btn:disabled { filter: brightness(0.55); cursor: wait; }
    #ai-translate-btn { background: #1a73e8; box-shadow: 0 4px 14px rgba(0,0,0,0.35); }
    #ai-panel-close {
      position: absolute;
      top: -10px;
      right: -10px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      font-size: 11px;
      line-height: 1;
      color: rgba(255,255,255,0.85);
      background: rgba(80,80,85,0.95);
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.15s;
      box-shadow: 0 1px 4px rgba(0,0,0,0.4);
    }
    #ai-reader-panel:hover #ai-panel-close {
      opacity: 1;
      pointer-events: auto;
    }
  `;
  document.head.appendChild(style);
}

// --- Shared panel ---

function getOrCreatePanel() {
  let panel = document.getElementById(PANEL_ID);
  if (!panel) {
    injectStyles();
    panel = document.createElement('div');
    panel.id = PANEL_ID;

    const closeBtn = document.createElement('button');
    closeBtn.id = 'ai-panel-close';
    closeBtn.textContent = '×';
    closeBtn.title = '隐藏';
    closeBtn.addEventListener('click', () => {
      log('[AI Reader] × panel dismissed');
      panel.remove();
      browser.storage.local.set({ showFloatBtn: false });
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

function createFloatButton() {
  if (document.getElementById(FLOAT_BTN_ID)) return;
  const panel = getOrCreatePanel();
  const btn = document.createElement('button');
  btn.id = FLOAT_BTN_ID;
  btn.className = 'ai-panel-btn';
  btn.textContent = '译';
  btn.title = '翻译屏幕内容';
  panel.appendChild(btn);

  btn.addEventListener('click', async () => {
    log('[AI Reader] 译 clicked');
    const { openaiApiKey, preferredModel } = await browser.storage.local.get(['openaiApiKey', 'preferredModel']);
    if (!openaiApiKey) {
      warn('[AI Reader] 译: no API key set');
      btn.title = '未设置 API Key';
      btn.textContent = '!';
      setTimeout(() => { btn.textContent = '译'; btn.title = '翻译屏幕内容'; }, 2000);
      return;
    }
    const model = preferredModel || 'gpt-4o-mini';
    injectStyles();
    const visible = findVisibleParagraphs();
    log(`[AI Reader] 译: found ${visible.length} visible paragraphs`);
    if (visible.length === 0) {
      btn.title = '无可翻译内容';
      setTimeout(() => { btn.title = '翻译屏幕内容'; }, 1500);
      return;
    }
    btn.disabled = true;
    btn.textContent = '…';
    let done = 0;
    btn.title = `翻译中 0/${visible.length}`;
    await Promise.all(visible.map(async el => {
      await wrapAndTranslate(el, openaiApiKey, model);
      btn.title = `翻译中 ${++done}/${visible.length}`;
    }));
    log(`[AI Reader] 译: done, translated ${visible.length} paragraphs`);
    btn.disabled = false;
    btn.textContent = '译';
    btn.title = '翻译屏幕内容';
  });
}

function findVisibleParagraphs() {
  const candidates = document.body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, td, figcaption');
  return Array.from(candidates).filter(el => {
    if (el.dataset.aiWrapped) return false;
    if (el.closest('[data-ai-wrapped]')) return false;
    const text = el.innerText?.trim();
    if (!text || text.length < 20) return false;
    const rect = el.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  });
}

async function wrapAndTranslate(el, apiKey, model) {
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
  if (!text) { btn.remove(); return; }

  try {
    const response = await browser.runtime.sendMessage({ action: 'translateParagraph', text, apiKey, model });
    if (!response.success) throw new Error(response.error);
    log('[AI Reader] paragraph translated:', { original: text.slice(0, 60), result: response.result.slice(0, 60) });
    el.querySelector('.ai-para-translated').textContent = response.result;
    el.classList.add('show-translation');
    btn.classList.remove('ai-loading-btn');
    btn.textContent = '原';
    btn.title = '显示原文';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const showing = el.classList.toggle('show-translation');
      log(`[AI Reader] toggle paragraph → ${showing ? 'translation' : 'original'}`);
      btn.textContent = showing ? '原' : '译';
      btn.title = showing ? '显示原文' : '显示译文';
    });
  } catch (err) {
    error('[AI Reader] paragraph translation failed:', err.message);
    btn.classList.remove('ai-loading-btn');
    btn.classList.add('ai-error-btn');
    btn.textContent = '!';
    btn.title = '翻译失败：' + err.message;
  }
}

// --- Summary ---

function clearSummaryHighlights() {
  document.querySelectorAll('.ai-summary-highlight, .ai-summary-highlight-active, .ai-summary-highlight-ping').forEach(el => {
    el.classList.remove('ai-summary-highlight', 'ai-summary-highlight-active', 'ai-summary-highlight-ping');
  });
}

function activateSummaryTarget(index, autoClearMs) {
  clearSummaryHighlights();
  const target = SUMMARY_STATE.elements?.[index]?.el;
  if (target) {
    target.classList.add('ai-summary-highlight', 'ai-summary-highlight-active');
    target.classList.remove('ai-summary-highlight-ping');
    void target.offsetWidth;
    target.classList.add('ai-summary-highlight-ping');
    target.addEventListener('animationend', () => target.classList.remove('ai-summary-highlight-ping'), { once: true });
    if (autoClearMs) {
      setTimeout(() => {
        target.classList.remove('ai-summary-highlight', 'ai-summary-highlight-active');
      }, autoClearMs);
    }
  }
}

function updateSummarySidebar(points, elements) {
  SUMMARY_STATE.points = points;
  SUMMARY_STATE.elements = elements;
  clearSummaryHighlights();
  browser.runtime.sendMessage({ action: 'summaryUpdated', points });
  browser.runtime.sendMessage({ action: 'openSidebar' });
}

async function runSummaryFromPage() {
  log('[AI Reader] runSummary triggered');
  const { openaiApiKey, preferredModel } = await browser.storage.local.get(['openaiApiKey', 'preferredModel']);
  if (!openaiApiKey) {
    warn('[AI Reader] summary: no API key set');
    browser.runtime.sendMessage({ action: 'summaryError', error: '未设置 API Key' });
    return;
  }

  const model = preferredModel || 'gpt-4o-mini';
  const elements = collectPageElements();
  log(`[AI Reader] summary: collected ${elements.length} page elements`);
  if (elements.length === 0) {
    browser.runtime.sendMessage({ action: 'summaryError', error: '无可分析内容' });
    return;
  }

  try {
    const response = await browser.runtime.sendMessage({
      action: 'summarize',
      elements: elements.map(e => e.text),
      apiKey: openaiApiKey,
      model
    });

    if (!response.success) throw new Error(response.error);
    log(`[AI Reader] summary: received ${response.points.length} points`, response.points);
    updateSummarySidebar(response.points, elements);
  } catch (err) {
    error('[AI Reader] summary: failed:', err.message);
    browser.runtime.sendMessage({ action: 'summaryError', error: err.message });
  }
}

// --- Interest Highlighting ---

function collectPageElements() {
  if (location.hostname.endsWith('news.ycombinator.com')) {
    const hn = collectHackerNewsElements();
    if (hn.length > 0) return hn;
  }

  const seen = new Set();
  const results = [];
  const candidates = document.querySelectorAll('h1, h2, h3, h4, h5, h6, li, p');
  for (const el of candidates) {
    const text = el.innerText?.trim().replace(/\s+/g, ' ');
    if (!text || text.length < 4 || text.length > 260) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    results.push({ el, text });
    if (results.length >= 140) break;
  }
  return results;
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
    results.push({ el: row, text });
  });

  const commentEls = document.querySelectorAll('.comment-tree .commtext');
  commentEls.forEach(el => {
    const text = el.innerText?.trim().replace(/\s+/g, ' ');
    if (!text || text.length < 20 || text.length > 260) return;
    if (seen.has(text)) return;
    seen.add(text);
    results.push({ el, text: `[comment] ${text}` });
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

function clearHighlights() {
  document.querySelectorAll('.ai-highlight').forEach(el => el.classList.remove('ai-highlight'));
}

async function runInterestingFromPage() {
  log('[AI Reader] ★ (highlight) clicked');
  const { openaiApiKey, preferredModel, userInterests } = await browser.storage.local.get(['openaiApiKey', 'preferredModel', 'userInterests']);
  if (!openaiApiKey) {
    warn('[AI Reader] ★: no API key set');
    browser.runtime.sendMessage({ action: 'highlightError', error: '未设置 API Key' });
    return;
  }
  if (!userInterests) {
    warn('[AI Reader] ★: no user interests set');
    browser.runtime.sendMessage({ action: 'highlightError', error: '请先在插件中设置兴趣' });
    return;
  }

  const model = preferredModel || 'gpt-4o-mini';
  const elements = collectPageElements();
  HIGHLIGHT_STATE.elements = elements;
  log(`[AI Reader] ★: collected ${elements.length} elements, interests: "${userInterests}"`);
  if (elements.length === 0) {
    browser.runtime.sendMessage({ action: 'highlightError', error: '无可分析内容' });
    return;
  }

  try {
    const response = await browser.runtime.sendMessage({
      action: 'findInteresting',
      interests: userInterests,
      elements: elements.map(e => e.text),
      apiKey: openaiApiKey,
      model
    });

    if (!response.success) throw new Error(response.error);
    log(`[AI Reader] ★: matched indices:`, response.indices);

    const items = response.indices
      .filter(i => elements[i])
      .map(i => ({ index: i, text: elements[i].text }));
    HIGHLIGHT_STATE.items = items;
    browser.runtime.sendMessage({ action: 'highlightDone', items });
    log(`[AI Reader] ★: found ${items.length} interesting elements`);
  } catch (err) {
    error('[AI Reader] ★: highlight failed:', err.message);
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
    if (typeof message.index === 'number') {
      activateSummaryTarget(message.index);
    }
    return;
  }

  if (message.action === 'summaryUnhover') {
    clearSummaryHighlights();
    return;
  }

  if (message.action === 'summaryClick') {
    const target = SUMMARY_STATE.elements?.[message.index]?.el;
    if (target) {
      log(`[AI Reader] summary item clicked (sidebar): index ${message.index}`);
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      activateSummaryTarget(message.index, 1200);
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
    if (target) target.classList.add('ai-highlight');
    return;
  }

  if (message.action === 'highlightUnhover') {
    const target = HIGHLIGHT_STATE.elements?.[message.index]?.el;
    if (target && !target.classList.contains('ai-highlight-active')) {
      target.classList.remove('ai-highlight');
    }
    return;
  }

  if (message.action === 'highlightClick') {
    const target = HIGHLIGHT_STATE.elements?.[message.index]?.el;
    if (target) {
      log(`[AI Reader] interesting item clicked (sidebar): index ${message.index}`);
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('ai-highlight');
      target.classList.remove('ai-highlight-active');
      void target.offsetWidth;
      target.classList.add('ai-highlight-active');
      target.addEventListener('animationend', () => target.classList.remove('ai-highlight-active'), { once: true });
      setTimeout(() => target.classList.remove('ai-highlight', 'ai-highlight-active'), 1200);
    }
    return;
  }
});

// --- Initialization ---

log('[AI Reader] content script loaded', location.href);
browser.storage.local.get(['showFloatBtn']).then(({ showFloatBtn }) => {
  if (showFloatBtn !== false) { createFloatButton(); }
});

browser.storage.onChanged.addListener((changes) => {
  if ('showFloatBtn' in changes) {
    const show = changes.showFloatBtn.newValue !== false;
    if (show) {
      createFloatButton();
    } else {
      document.getElementById(FLOAT_BTN_ID)?.remove();
      clearSummaryHighlights();
      clearHighlights();
      removePanelIfEmpty();
    }
  }
});
