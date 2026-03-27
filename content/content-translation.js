// content-translation.js — paragraph translation and page-level translate orchestration
// Depends on: content-core.js, content-dom.js (findVisibleParagraphs)

// Pre-compiled regexes for translated text link-marker processing
const LINK_MATCH_RE = /[\[【]LINK(\d+)_START[\]】]([\s\S]*?)[\[【]LINK\d+_END[\]】]/g;
const LINK_STRIP_RE = /[\[【]LINK\d+_(?:START|END)[\]】]/g;

// Shared core: translates an array of elements, updating btn state throughout.
// inReaderMode: true when translating reader overlay content — affects the
// post-translate button title so it doesn't say "screen content" while the
// overlay is covering the screen.
async function runTranslateElements(elements, btn, inReaderMode = false) {
  log(`[PageGrep] 译: translating ${elements.length} elements`);
  if (elements.length === 0) {
    showToast(browser.i18n.getMessage('noTranslatableContent'));
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  let done = 0;
  await Promise.all(elements.map(async el => {
    await wrapAndTranslate(el);
    if (btn) btn.title = browser.i18n.getMessage('translatingProgress', [String(++done), String(elements.length)]);
  }));
  log(`[PageGrep] 译: done, translated ${elements.length} elements`);
  if (btn) {
    btn.disabled = false;
    setTranslateIcon(btn);
    btn.title = browser.i18n.getMessage(inReaderMode ? 'translateReaderContent' : 'translateScreenContent')
      || (inReaderMode ? 'Translate article' : 'Translate screen content');
  }
}

// Restore a previously-cached translation without calling the API.
// onToggle(showing) is called whenever the user flips the paragraph.
function appendSavedTranslationContent(target, savedHtml) {
  const doc = new DOMParser().parseFromString(savedHtml || '', 'text/html');
  Array.from(doc.body.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      target.appendChild(document.createTextNode(node.textContent || ''));
      return;
    }
    if (node.nodeName === 'A') {
      const href = node.getAttribute('href') || '';
      if (/^https?:/i.test(href)) {
        const a = document.createElement('a');
        a.href = href;
        a.textContent = node.textContent || href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        target.appendChild(a);
        return;
      }
    }
    target.appendChild(document.createTextNode(node.textContent || ''));
  });
}

function restoreTranslation(el, savedHtml, showing, onToggle) {
  el.dataset.aiWrapped = '1';
  const pos = window.getComputedStyle(el).position;
  if (pos === 'static') el.style.position = 'relative';

  const originalSpan = document.createElement('span');
  originalSpan.className = 'ai-para-original';
  while (el.firstChild) originalSpan.appendChild(el.firstChild);

  const translatedSpan = document.createElement('span');
  translatedSpan.className = 'ai-para-translated';
  appendSavedTranslationContent(translatedSpan, savedHtml);

  el.append(originalSpan, translatedSpan);
  el.classList.add('ai-para-wrap');
  if (showing) el.classList.add('show-translation');

  const btn = document.createElement('button');
  btn.className = 'ai-toggle-btn';
  setToggleIcon(btn, showing);
  btn.title = browser.i18n.getMessage(showing ? 'showOriginal' : 'showTranslated');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const newShowing = el.classList.toggle('show-translation');
    setToggleIcon(btn, newShowing);
    btn.title = browser.i18n.getMessage(newShowing ? 'showOriginal' : 'showTranslated');
    onToggle?.(newShowing);
  });
  el.appendChild(btn);
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
