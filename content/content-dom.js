// content-dom.js — DOM analysis: content scope detection, article/element collection
// Depends on: content-core.js (CHROME_SELECTOR, threshold constants)

// --- Content collection thresholds ---
const MAX_DESCENT_DEPTH    = 8;    // findWidestTextBlock recursion limit
const MIN_PARA_TEXT_LENGTH = 40;   // min paragraph length to count as content
const MIN_BLOCK_TEXT_LENGTH = 300; // min block text length to be a descent candidate
const WIDTH_DOMINANCE_RATIO = 1.4; // width ratio to treat one block as dominant
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

// Note: findMainContentScope() above serves a similar purpose but targets a broader
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
