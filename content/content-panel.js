// content-panel.js — floating panel, drag-and-drop, context menu, article copy
// Depends on: content-core.js, content-dom.js (collectArticle),
//             content-translation.js (runTranslateOnPage)

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

// --- Article copy ---

async function saveArticleToClipboard(btn) {
  if (btn) { btn.disabled = true; btn.classList.add('ai-loading-btn'); }
  try {
    const { title, lines } = collectArticle();
    if (lines.length === 0) { showToast(browser.i18n.getMessage('noAnalyzableContent') || 'No content found'); return; }
    const markdown = `# ${title || location.hostname}\n\n${location.href}\n\n${lines.join('\n\n')}\n`;
    await copyToClipboard(markdown);
  } catch (err) {
    error('[PageGrep] saveArticleToClipboard failed:', err.message);
    showToast(browser.i18n.getMessage('operationFailed') || 'Copy failed');
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('ai-loading-btn'); }
  }
}
