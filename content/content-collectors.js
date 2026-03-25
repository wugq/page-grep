// content-collectors.js — page element collection, hover helpers, summary & highlight flows
// Depends on: content-core.js, content-dom.js (findMainContentScope, detectPageLanguage)

// --- Hover / highlight state ---

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

// --- Summary flow ---

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

// --- Interest highlighting flow ---

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

  // Returns null (not []) when no list structure found — caller checks for null
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
    { tag: 'ai',       words: ['ai', 'ml', 'llm', 'neural', 'openai', 'anthropic', 'model'] },
    { tag: 'dev',      words: ['release', 'v', 'version', 'compiler', 'runtime', 'sdk', 'framework', 'library', 'api', 'tool'] },
    { tag: 'security', words: ['security', 'vuln', 'vulnerability', 'exploit', 'breach', 'malware', 'ransomware'] },
    { tag: 'systems',  words: ['kernel', 'os', 'linux', 'network', 'database', 'infra', 'cloud', 'server'] },
    { tag: 'hardware', words: ['chip', 'cpu', 'gpu', 'hardware', 'device', 'iphone', 'macbook', 'battery'] },
    { tag: 'data',     words: ['data', 'dataset', 'benchmark', 'analytics', 'statistics'] },
    { tag: 'business', words: ['startup', 'funding', 'acquisition', 'ipo', 'company', 'business'] },
    { tag: 'policy',   words: ['policy', 'law', 'regulation', 'court', 'legal', 'government'] }
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
