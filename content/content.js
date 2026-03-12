// Content script - in-place screen translation

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

const STYLE_ID = 'ai-translate-styles';
const FLOAT_BTN_ID = 'ai-translate-float-btn';

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
    #ai-translate-float-btn {
      position: fixed;
      bottom: 28px;
      right: 28px;
      background: #1a73e8;
      color: white;
      border: none;
      border-radius: 24px;
      padding: 10px 18px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      z-index: 2147483646;
      box-shadow: 0 2px 12px rgba(0,0,0,0.25);
      transition: background 0.2s, opacity 0.2s;
      white-space: nowrap;
    }
    #ai-translate-float-btn:hover { background: #1557b0; }
    #ai-translate-float-btn:disabled { background: #888; cursor: wait; }
  `;
  document.head.appendChild(style);
}

function createFloatButton() {
  if (document.getElementById(FLOAT_BTN_ID)) return;
  const btn = document.createElement('button');
  btn.id = FLOAT_BTN_ID;
  btn.textContent = '译';
  document.body.appendChild(btn);

  btn.addEventListener('click', async () => {
    const { openaiApiKey, preferredModel } = await browser.storage.local.get(['openaiApiKey', 'preferredModel']);
    if (!openaiApiKey) {
      btn.textContent = '未设置 Key';
      setTimeout(() => { btn.textContent = '译'; }, 2000);
      return;
    }
    const model = preferredModel || 'gpt-4o-mini';
    injectStyles();
    const visible = findVisibleParagraphs();
    if (visible.length === 0) {
      btn.textContent = '无可翻译内容';
      setTimeout(() => { btn.textContent = '译'; }, 1500);
      return;
    }
    btn.disabled = true;
    btn.textContent = `翻译中 0/${visible.length}`;
    let done = 0;
    await Promise.all(visible.map(async el => {
      await wrapAndTranslate(el, openaiApiKey, model);
      btn.textContent = `翻译中 ${++done}/${visible.length}`;
    }));
    btn.disabled = false;
    btn.textContent = '译';
  });
}

function findVisibleParagraphs() {
  const container = document.querySelector('article, main, [role="main"], .post-content, .article-body, .entry-content') || document.body;
  const candidates = container.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, td, figcaption');
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

browser.runtime.onMessage.addListener((message) => {
  if (message.action === 'getPageText') {
    return Promise.resolve({ text: extractPageText() });
  }

  if (message.action === 'translateVisible') {
    injectStyles();
    findVisibleParagraphs().forEach(el => wrapAndTranslate(el, message.apiKey, message.model));
    return Promise.resolve({ success: true });
  }
});

// Inject the floating translate button on every page
createFloatButton();
