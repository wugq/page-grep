// content-dom.js — DOM analysis: content scope detection, article/element collection
// Depends on: content-core.js (CHROME_SELECTOR, threshold constants)

// --- Content collection thresholds ---
const MAX_ARTICLE_LINES    = 200;  // max lines for copy-to-clipboard
const MAX_ARTICLE_ELEMENTS = 180;  // max elements in article-mode collection
const MAX_LIST_ELEMENTS    = 140;  // max elements in list-mode collection
const MAX_HN_ELEMENTS      = 160;  // max elements on HackerNews

// --- Content scope detection ---

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


// Returns { title, lines } using Readability for reliable cross-site extraction.
// Uses article.content (cleaned HTML) rather than article.textContent so that
// only semantic prose elements (p, headings, blockquote, li) are included —
// widget noise (follow buttons, newsletter forms, etc.) lives in div/span and
// is naturally excluded.
function collectArticle() {
  const docClone = document.cloneNode(true);
  const reader = new Readability(docClone);
  const article = reader.parse();
  const title = (article && article.title) ? article.title : document.title;
  if (!article || !article.content) return { title, lines: [] };

  const dom = new DOMParser().parseFromString(article.content, 'text/html');
  const HEADING_PREFIX = { H1: '# ', H2: '## ', H3: '### ', H4: '#### ', H5: '##### ', H6: '###### ' };
  const seen = new Set();
  const lines = [];

  for (const el of dom.querySelectorAll('h1,h2,h3,h4,h5,h6,p,blockquote,li')) {
    if (el.tagName === 'LI' && el.parentElement?.closest('li')) continue;
    const raw = el.textContent?.trim().replace(/\s+/g, ' ');
    const isHeading = el.tagName.length === 2 && el.tagName[0] === 'H';
    if (!raw || raw.length < (isHeading ? 2 : 20) || seen.has(raw)) continue;
    seen.add(raw);
    const prefix = HEADING_PREFIX[el.tagName];
    if (prefix) {
      lines.push(prefix + raw);
    } else if (el.tagName === 'BLOCKQUOTE') {
      lines.push('> ' + raw);
    } else if (el.tagName === 'LI') {
      const isOrdered = el.parentElement?.tagName === 'OL';
      const idx = isOrdered
        ? Array.from(el.parentElement.children).filter(c => c.tagName === 'LI').indexOf(el) + 1
        : 0;
      lines.push((isOrdered ? `${idx}. ` : '- ') + raw);
    } else {
      lines.push(raw);
    }
    if (lines.length >= MAX_ARTICLE_LINES) break;
  }
  return {
    title,
    lines,
    byline: article.byline || null,
    siteName: article.siteName || null,
    publishedTime: article.publishedTime || null,
  };
}

// Drop ancestors: if an element contains another candidate, keep only the inner one.
// Shared by findVisibleParagraphs and collectReaderElements.
function dropAncestors(els) {
  return els.filter(el => !els.some(other => other !== el && el.contains(other)));
}

function findVisibleParagraphs() {
  const scope = findMainContentScope();
  const excludeChrome = scope === document.body;
  const candidates = scope.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, td, figcaption, dd');
  const filtered = Array.from(candidates).filter(el => {
    if (el.dataset.aiWrapped) return false;
    if (el.closest('[data-ai-wrapped]')) return false;
    if (el.querySelector('[data-ai-wrapped]')) return false;
    if (excludeChrome && el.closest(CHROME_SELECTOR)) return false;
    const text = el.innerText?.trim();
    if (!text || text.length < 20) return false;
    const rect = el.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  });
  return dropAncestors(filtered);
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
