// content-selection.js — text selection popup: translate selection, copy, show-original
// Depends on: content-core.js, content-translation.js (setToggleIcon used for in-para button)

const SELECTION_BTN_ID    = 'ai-selection-btn';
const SELECTION_RESULT_ID = 'ai-selection-result';

// Toggled by content-init.js based on domain blocklist state
let selectionTranslateEnabled = false;

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
