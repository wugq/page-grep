// Content script - translation & interest highlighting

function extractPageText() {
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('script, style, noscript, iframe, nav, footer, header, aside, .ad, .advertisement, [aria-hidden="true"]')
    .forEach(el => el.remove());
  const main = clone.querySelector('article, main, [role="main"], .post-content, .article-body, .entry-content');
  return (main || clone).innerText
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

const STYLE_ID = 'ai-reader-styles';
const PANEL_ID = 'ai-reader-panel';
const FLOAT_BTN_ID = 'ai-translate-btn';
const HIGHLIGHT_BTN_ID = 'ai-highlight-btn';
const HIGHLIGHT_NAV_ID = 'ai-highlight-nav-row';

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
    @keyframes ai-highlight-ping {
      0%   { box-shadow: 0 0 0 0 rgba(249, 168, 37, 0.9); }
      60%  { box-shadow: 0 0 0 14px rgba(249, 168, 37, 0); }
      100% { box-shadow: 0 0 0 0 rgba(249, 168, 37, 0); }
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
      padding: 8px 6px;
      background: rgba(28, 28, 30, 0.85);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border-radius: 18px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.35);
    }
    #ai-highlight-nav-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    #ai-highlight-nav-row.ai-nav-hidden { display: none; }
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
    #ai-translate-btn { background: #1a73e8; }
    #ai-highlight-btn { background: #f09300; }
    #ai-highlight-btn.ai-hl-active { background: #e65100; }
    .ai-nav-btn {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      font-size: 11px;
      color: rgba(255,255,255,0.85);
      background: rgba(255,255,255,0.15);
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      transition: background 0.12s, transform 0.1s;
    }
    .ai-nav-btn:hover { background: rgba(255,255,255,0.28); transform: scale(1.1); }
    .ai-nav-btn:active { transform: scale(0.9); }
    #ai-panel-close {
      position: absolute;
      top: -7px;
      right: -7px;
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
    const { openaiApiKey, preferredModel } = await browser.storage.local.get(['openaiApiKey', 'preferredModel']);
    if (!openaiApiKey) {
      btn.title = '未设置 API Key';
      btn.textContent = '!';
      setTimeout(() => { btn.textContent = '译'; btn.title = '翻译屏幕内容'; }, 2000);
      return;
    }
    const model = preferredModel || 'gpt-4o-mini';
    injectStyles();
    const visible = findVisibleParagraphs();
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

  // If a child element was highlighted, hoist the class to el so it survives innerHTML replacement
  if (!el.classList.contains('ai-highlight') && el.querySelector('.ai-highlight')) {
    el.classList.add('ai-highlight');
  }

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
    el.querySelector('.ai-para-translated').textContent = response.result;
    el.classList.add('show-translation');
    btn.classList.remove('ai-loading-btn');
    btn.textContent = '原';
    btn.title = '显示原文';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const showing = el.classList.toggle('show-translation');
      btn.textContent = showing ? '原' : '译';
      btn.title = showing ? '显示原文' : '显示译文';
    });
  } catch (err) {
    btn.classList.remove('ai-loading-btn');
    btn.classList.add('ai-error-btn');
    btn.textContent = '!';
    btn.title = '翻译失败：' + err.message;
  }
}

// --- Interest Highlighting ---

function collectPageElements() {
  const seen = new Set();
  const results = [];
  const candidates = document.querySelectorAll('h1, h2, h3, h4, h5, h6, li, p');
  for (const el of candidates) {
    const text = el.innerText?.trim().replace(/\s+/g, ' ');
    if (!text || text.length < 4 || text.length > 200) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    results.push({ el, text });
    if (results.length >= 120) break;
  }
  return results;
}

function clearHighlights() {
  document.querySelectorAll('.ai-highlight').forEach(el => el.classList.remove('ai-highlight'));
}

function createHighlightButton() {
  if (document.getElementById(HIGHLIGHT_BTN_ID)) return;
  const panel = getOrCreatePanel();

  // Nav row (prev / next) — inserted before highlight btn
  const nav = document.createElement('div');
  nav.id = HIGHLIGHT_NAV_ID;
  nav.classList.add('ai-nav-hidden');

  const prevBtn = document.createElement('button');
  prevBtn.className = 'ai-nav-btn';
  prevBtn.textContent = '▲';
  prevBtn.title = '上一条';

  const nextBtn = document.createElement('button');
  nextBtn.className = 'ai-nav-btn';
  nextBtn.textContent = '▼';
  nextBtn.title = '下一条';

  nav.appendChild(prevBtn);
  nav.appendChild(nextBtn);

  const btn = document.createElement('button');
  btn.id = HIGHLIGHT_BTN_ID;
  btn.className = 'ai-panel-btn';
  btn.textContent = '★';
  btn.title = '高亮兴趣内容';

  // Insert nav + highlight btn before translate btn so order is: nav, ★, 译
  const translateBtn = document.getElementById(FLOAT_BTN_ID);
  panel.insertBefore(btn, translateBtn);
  panel.insertBefore(nav, btn);

  let highlighted = false;
  let highlightedEls = [];
  let currentIdx = -1;

  function scrollToHighlight(idx) {
    if (highlightedEls.length === 0) return;
    highlightedEls.forEach(el => el.classList.remove('ai-highlight-active'));
    currentIdx = ((idx % highlightedEls.length) + highlightedEls.length) % highlightedEls.length;
    const el = highlightedEls[currentIdx];
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    void el.offsetWidth;
    el.classList.add('ai-highlight-active');
    el.addEventListener('animationend', () => el.classList.remove('ai-highlight-active'), { once: true });
  }

  prevBtn.addEventListener('click', () => scrollToHighlight(currentIdx - 1));
  nextBtn.addEventListener('click', () => scrollToHighlight(currentIdx + 1));

  btn.addEventListener('click', async () => {
    if (highlighted) {
      clearHighlights();
      highlighted = false;
      highlightedEls = [];
      currentIdx = -1;
      nav.classList.add('ai-nav-hidden');
      btn.classList.remove('ai-hl-active');
      btn.title = '高亮兴趣内容';
      return;
    }

    const { openaiApiKey, preferredModel, userInterests } = await browser.storage.local.get(['openaiApiKey', 'preferredModel', 'userInterests']);
    if (!openaiApiKey) {
      btn.title = '未设置 API Key';
      setTimeout(() => { btn.title = '高亮兴趣内容'; }, 2000);
      return;
    }
    if (!userInterests) {
      btn.title = '请先在插件中设置兴趣';
      setTimeout(() => { btn.title = '高亮兴趣内容'; }, 2000);
      return;
    }

    const model = preferredModel || 'gpt-4o-mini';
    const elements = collectPageElements();
    if (elements.length === 0) {
      btn.title = '无可分析内容';
      setTimeout(() => { btn.title = '高亮兴趣内容'; }, 1500);
      return;
    }

    btn.disabled = true;
    btn.textContent = '…';
    btn.title = '分析中...';

    try {
      const response = await browser.runtime.sendMessage({
        action: 'findInteresting',
        interests: userInterests,
        elements: elements.map(e => e.text),
        apiKey: openaiApiKey,
        model
      });

      if (!response.success) throw new Error(response.error);

      let count = 0;
      response.indices.forEach(i => {
        if (elements[i]) {
          elements[i].el.classList.add('ai-highlight');
          count++;
        }
      });

      highlighted = count > 0;
      btn.textContent = '★';
      if (count > 0) {
        highlightedEls = Array.from(document.querySelectorAll('.ai-highlight'));
        nav.classList.remove('ai-nav-hidden');
        btn.classList.add('ai-hl-active');
        btn.title = `${count} 条匹配 — 点击清除`;
        scrollToHighlight(0);
      } else {
        btn.title = '无匹配内容';
        setTimeout(() => { btn.title = '高亮兴趣内容'; }, 2000);
      }
    } catch (err) {
      btn.textContent = '★';
      btn.title = '分析失败';
      setTimeout(() => { btn.title = '高亮兴趣内容'; }, 2000);
    } finally {
      btn.disabled = false;
    }
  });
}

function removeHighlightButton() {
  clearHighlights();
  document.getElementById(HIGHLIGHT_BTN_ID)?.remove();
  document.getElementById(HIGHLIGHT_NAV_ID)?.remove();
  removePanelIfEmpty();
}

// --- Message listeners ---

browser.runtime.onMessage.addListener((message) => {
  if (message.action === 'getPageText') {
    return Promise.resolve({ text: extractPageText() });
  }


});

// --- Initialization ---

browser.storage.local.get(['showFloatBtn', 'userInterests']).then(({ showFloatBtn, userInterests }) => {
  if (showFloatBtn !== false) createFloatButton();
  if (showFloatBtn !== false && userInterests) createHighlightButton();
});

browser.storage.onChanged.addListener((changes) => {
  if ('showFloatBtn' in changes) {
    const show = changes.showFloatBtn.newValue !== false;
    if (show) {
      createFloatButton();
      browser.storage.local.get('userInterests').then(({ userInterests }) => {
        if (userInterests) createHighlightButton();
      });
    } else {
      document.getElementById(FLOAT_BTN_ID)?.remove();
      removeHighlightButton();
      removePanelIfEmpty();
    }
  }

  if ('userInterests' in changes) {
    browser.storage.local.get('showFloatBtn').then(({ showFloatBtn }) => {
      if (changes.userInterests.newValue && showFloatBtn !== false) {
        createHighlightButton();
      } else {
        removeHighlightButton();
      }
    });
  }
});
