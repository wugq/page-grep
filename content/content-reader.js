// content-reader.js — distraction-free reader mode overlay using Mozilla Readability
// Depends on: content-core.js, content-translation.js (runTranslateElements)

const READER_OVERLAY_ID  = 'ai-reader-overlay';
const READER_SETTINGS_ID = 'ai-reader-settings';

// READER_ICON is defined in content-core.js
const CLOSE_ICON    = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const SETTINGS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`;

const FONT_SIZES    = [14, 15, 16, 17, 18, 20, 22, 24, 28]; // index 0–8, default 4 (18px)
const LINE_SPACINGS = [1.4, 1.6, 1.8, 2.0, 2.2];           // index 0–4, default 2 (1.8)
const WIDTHS        = { narrow: 480, normal: 680, wide: 860 };
const DEFAULT_PREFS = { theme: 'auto', fontSize: 4, lineSpacing: 2, width: 'normal' };

// --- Prefs helpers ---

async function loadReaderPrefs() {
  const { readerPrefs } = await browser.storage.local.get(STORAGE_KEYS.READER_PREFS);
  return { ...DEFAULT_PREFS, ...(readerPrefs || {}) };
}

function saveReaderPrefs(prefs) {
  browser.storage.local.set({ [STORAGE_KEYS.READER_PREFS]: prefs });
}

function resolveTheme(prefs) {
  if (prefs.theme !== 'auto') return prefs.theme;
  return isThemeDark(_cachedTheme) ? 'dark' : 'light';
}

function applyPrefs(overlay, prefs) {
  overlay.dataset.readerTheme = resolveTheme(prefs);
  overlay.style.setProperty('--reader-font-size',   FONT_SIZES[prefs.fontSize] + 'px');
  overlay.style.setProperty('--reader-line-height', LINE_SPACINGS[prefs.lineSpacing]);
  overlay.style.setProperty('--reader-width',       WIDTHS[prefs.width] + 'px');
}

// --- Element collection ---

function collectReaderElements(scope) {
  const candidates = Array.from(
    scope.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote, li')
  );
  const filtered = candidates.filter(el => {
    if (el.dataset.aiWrapped) return false;
    const text = el.innerText?.trim();
    return text && text.length >= 20;
  });
  return filtered.filter(el => !filtered.some(other => other !== el && el.contains(other)));
}

// --- Settings panel ---

function buildSettingsPanel(overlay, prefs) {
  const panel = document.createElement('div');
  panel.id = READER_SETTINGS_ID;

  // Theme row
  const themeRow = makeRow();
  const THEMES = [
    { key: 'auto',  bg: '',        color: '',        label: 'Auto'  },
    { key: 'light', bg: '#f9f7f4', color: '#1a1a1a', label: 'Light' },
    { key: 'sepia', bg: '#f4ecd8', color: '#5b4636', label: 'Sepia' },
    { key: 'dark',  bg: '#1c1c1e', color: '#e8e8e8', label: 'Dark'  },
  ];
  const themeBtns = THEMES.map(({ key, bg, color, label }) => {
    const btn = document.createElement('button');
    btn.className = 'ai-rs-theme-btn';
    btn.dataset.theme = key;
    btn.title = label;
    if (bg) { btn.style.background = bg; btn.style.color = color; }
    btn.textContent = key === 'auto' ? 'Auto' : 'Aa';
    if (prefs.theme === key) btn.classList.add('active');
    btn.addEventListener('click', () => {
      prefs.theme = key;
      applyPrefs(overlay, prefs);
      themeBtns.forEach(b => b.classList.toggle('active', b.dataset.theme === key));
      saveReaderPrefs(prefs);
    });
    return btn;
  });
  themeBtns.forEach(b => themeRow.appendChild(b));

  // Font size stepper
  const { row: fontRow, minus: fontMinus, val: fontVal, plus: fontPlus } =
    makeStepper('Font', FONT_SIZES[prefs.fontSize] + 'px');
  fontMinus.disabled = prefs.fontSize === 0;
  fontPlus.disabled  = prefs.fontSize === FONT_SIZES.length - 1;
  fontMinus.addEventListener('click', () => {
    if (prefs.fontSize === 0) return;
    prefs.fontSize--;
    fontVal.textContent   = FONT_SIZES[prefs.fontSize] + 'px';
    fontMinus.disabled    = prefs.fontSize === 0;
    fontPlus.disabled     = false;
    applyPrefs(overlay, prefs); saveReaderPrefs(prefs);
  });
  fontPlus.addEventListener('click', () => {
    if (prefs.fontSize === FONT_SIZES.length - 1) return;
    prefs.fontSize++;
    fontVal.textContent   = FONT_SIZES[prefs.fontSize] + 'px';
    fontPlus.disabled     = prefs.fontSize === FONT_SIZES.length - 1;
    fontMinus.disabled    = false;
    applyPrefs(overlay, prefs); saveReaderPrefs(prefs);
  });

  // Line spacing stepper
  const { row: spacingRow, minus: spacingMinus, val: spacingVal, plus: spacingPlus } =
    makeStepper('Spacing', LINE_SPACINGS[prefs.lineSpacing] + '×');
  spacingMinus.disabled = prefs.lineSpacing === 0;
  spacingPlus.disabled  = prefs.lineSpacing === LINE_SPACINGS.length - 1;
  spacingMinus.addEventListener('click', () => {
    if (prefs.lineSpacing === 0) return;
    prefs.lineSpacing--;
    spacingVal.textContent  = LINE_SPACINGS[prefs.lineSpacing] + '×';
    spacingMinus.disabled   = prefs.lineSpacing === 0;
    spacingPlus.disabled    = false;
    applyPrefs(overlay, prefs); saveReaderPrefs(prefs);
  });
  spacingPlus.addEventListener('click', () => {
    if (prefs.lineSpacing === LINE_SPACINGS.length - 1) return;
    prefs.lineSpacing++;
    spacingVal.textContent  = LINE_SPACINGS[prefs.lineSpacing] + '×';
    spacingPlus.disabled    = prefs.lineSpacing === LINE_SPACINGS.length - 1;
    spacingMinus.disabled   = false;
    applyPrefs(overlay, prefs); saveReaderPrefs(prefs);
  });

  // Width row
  const widthRow = makeRow();
  const WIDTHS_DEF = [
    { key: 'narrow', label: 'Narrow' },
    { key: 'normal', label: 'Normal' },
    { key: 'wide',   label: 'Wide'   },
  ];
  const widthBtns = WIDTHS_DEF.map(({ key, label }) => {
    const btn = document.createElement('button');
    btn.className = 'ai-rs-width-btn';
    btn.dataset.width = key;
    btn.textContent = label;
    if (prefs.width === key) btn.classList.add('active');
    btn.addEventListener('click', () => {
      prefs.width = key;
      applyPrefs(overlay, prefs);
      widthBtns.forEach(b => b.classList.toggle('active', b.dataset.width === key));
      saveReaderPrefs(prefs);
    });
    return btn;
  });
  widthBtns.forEach(b => widthRow.appendChild(b));

  panel.append(themeRow, fontRow, spacingRow, widthRow);
  return panel;
}

function makeRow() {
  const row = document.createElement('div');
  row.className = 'ai-rs-row';
  return row;
}

function makeStepper(label, initialVal) {
  const row = makeRow();
  const lbl = document.createElement('span');
  lbl.className = 'ai-rs-stepper-label';
  lbl.textContent = label;
  const minus = document.createElement('button');
  minus.className = 'ai-rs-step-btn';
  minus.textContent = '−';
  const val = document.createElement('span');
  val.className = 'ai-rs-stepper-val';
  val.textContent = initialVal;
  const plus = document.createElement('button');
  plus.className = 'ai-rs-step-btn';
  plus.textContent = '+';
  row.append(lbl, minus, val, plus);
  return { row, minus, val, plus };
}

// --- Open / close ---

function toggleReaderMode(triggerBtn) {
  if (document.getElementById(READER_OVERLAY_ID)) {
    closeReaderMode();
    return;
  }
  openReaderMode(triggerBtn);
}

async function openReaderMode(triggerBtn) {
  if (triggerBtn) { triggerBtn.disabled = true; }

  const docClone = document.cloneNode(true);
  const reader = new Readability(docClone);
  const article = reader.parse();
  const prefs = await loadReaderPrefs();

  if (triggerBtn) { triggerBtn.disabled = false; }

  if (!article || !article.content) {
    showToast(browser.i18n.getMessage('noAnalyzableContent') || 'No readable content found');
    return;
  }

  // --- Overlay ---
  const overlay = document.createElement('div');
  overlay.id = READER_OVERLAY_ID;
  applyPrefs(overlay, prefs);

  // --- Toolbar ---
  const toolbar = document.createElement('div');
  toolbar.id = 'ai-reader-toolbar';

  const siteLabel = document.createElement('span');
  siteLabel.id = 'ai-reader-site';
  siteLabel.textContent = article.siteName || location.hostname;

  const closeBtn = document.createElement('button');
  closeBtn.id = 'ai-reader-close-btn';
  closeBtn.innerHTML = CLOSE_ICON + ' Exit Reader';

  toolbar.append(siteLabel, closeBtn);

  // --- Settings panel ---
  const settingsPanel = buildSettingsPanel(overlay, prefs);

  // --- Content ---
  const content = document.createElement('div');
  content.id = 'ai-reader-content';

  const meta = document.createElement('div');
  meta.id = 'ai-reader-meta';

  const titleEl = document.createElement('h1');
  titleEl.id = 'ai-reader-title';
  titleEl.textContent = article.title || document.title;
  meta.appendChild(titleEl);

  const bylineParts = [article.byline, article.siteName, article.publishedTime].filter(Boolean);
  if (bylineParts.length > 0) {
    const bylineEl = document.createElement('div');
    bylineEl.id = 'ai-reader-byline';
    bylineEl.textContent = bylineParts.join(' · ');
    meta.appendChild(bylineEl);
  }

  const body = document.createElement('div');
  body.id = 'ai-reader-body';
  body.innerHTML = article.content;
  body.querySelectorAll('script, style').forEach(el => el.remove());

  content.append(meta, body);
  // settingsPanel is position:fixed but inside overlay so it inherits CSS theme vars
  overlay.append(toolbar, settingsPanel, content);
  document.body.appendChild(overlay);

  // Repurpose the floating panel reader button as the settings trigger
  const panelReaderBtn = document.getElementById('ai-reader-mode-btn');
  if (panelReaderBtn) {
    const savedHTML  = panelReaderBtn.innerHTML;
    const savedTitle = panelReaderBtn.title;
    panelReaderBtn.dataset.readerActive = '1';
    panelReaderBtn.innerHTML = SETTINGS_ICON;
    panelReaderBtn.title = browser.i18n.getMessage('readerSettings') || 'Reading settings';

    function onSettingsClick(e) {
      e.stopPropagation();
      const open = settingsPanel.classList.toggle('open');
      panelReaderBtn.classList.toggle('active', open);
      if (open) {
        const rect = panelReaderBtn.getBoundingClientRect();
        settingsPanel.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
        settingsPanel.style.right  = (window.innerWidth - rect.right) + 'px';
        settingsPanel.style.top    = 'auto';
      }
    }
    panelReaderBtn.addEventListener('click', onSettingsClick);

    overlay._restorePanelBtn = () => {
      panelReaderBtn.removeEventListener('click', onSettingsClick);
      panelReaderBtn.innerHTML = savedHTML;
      panelReaderBtn.title     = savedTitle;
      panelReaderBtn.classList.remove('active');
      delete panelReaderBtn.dataset.readerActive;
    };
  }

  // Dismiss popup on click outside
  overlay.addEventListener('click', (e) => {
    if (settingsPanel.classList.contains('open') && !settingsPanel.contains(e.target)) {
      settingsPanel.classList.remove('open');
      panelReaderBtn?.classList.remove('active');
    }
  });

  // Escape closes reader
  function onKeydown(e) {
    if (e.key === 'Escape') closeReaderMode();
  }
  document.addEventListener('keydown', onKeydown);
  overlay._cleanup = () => document.removeEventListener('keydown', onKeydown);

  closeBtn.addEventListener('click', closeReaderMode);
}

function closeReaderMode() {
  const overlay = document.getElementById(READER_OVERLAY_ID);
  if (!overlay) return;
  overlay._cleanup?.();
  overlay._restorePanelBtn?.();
  overlay.remove();
}
