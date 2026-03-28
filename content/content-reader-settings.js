// content-reader-settings.js — reader prefs, shadow DOM helper, and settings panel UI
// Depends on: content-core.js (_cachedTheme, onThemeChange), theme-utils.js (isThemeDark),
//             content-dom.js (filterTranslatableElements)
// Must be loaded before content-reader.js (manifest.json load order is the contract).

const CLOSE_ICON    = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const SETTINGS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`;
const SAVE_ICON     = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
const SAVED_ICON    = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
const LIBRARY_ICON  = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
const BACK_ICON     = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><polyline points="15 18 9 12 15 6"/></svg>`;

// Queries an element by ID within the reader's shadow root.
// Needed because document.getElementById() cannot pierce shadow DOM.
function readerGetById(id) {
  const root = _readerBody?.getRootNode();
  return (root instanceof ShadowRoot ? root : document).getElementById(id);
}

const FONT_SIZES    = [14, 15, 16, 17, 18, 20, 22, 24, 28]; // index 0–8, default 4 (18px)
const LINE_SPACINGS = [1.4, 1.6, 1.8, 2.0, 2.2];           // index 0–4, default 2 (1.8)
const WIDTHS = [
  { key: 'narrow', px: 480, msgKey: 'readerWidthNarrow' },
  { key: 'normal', px: 680, msgKey: 'readerWidthNormal' },
  { key: 'wide',   px: 860, msgKey: 'readerWidthWide'   },
];
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
  overlay.style.setProperty('--reader-line-height', String(LINE_SPACINGS[prefs.lineSpacing]));
  overlay.style.setProperty('--reader-width',       (WIDTHS.find(w => w.key === prefs.width)?.px ?? 680) + 'px');
}

// Re-resolve auto theme when the sidebar/system theme changes.
// Registered as a hook so content-core.js does not depend on this module.
async function refreshReaderTheme() {
  const overlay = document.getElementById(READER_OVERLAY_ID);
  if (!overlay) return;
  const prefs = await loadReaderPrefs();
  if (prefs.theme !== 'auto') return;
  overlay.dataset.readerTheme = resolveTheme(prefs);
}

onThemeChange(refreshReaderTheme);

function collectReaderElements(scope) {
  // Omits td/figcaption/dd — Readability strips layout tables and most captions.
  const candidates = scope.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote, li');
  return filterTranslatableElements(candidates);
}

// contentEl: the #ai-reader-content element, needed so width changes trigger its CSS transition.
function buildSettingsPanel(overlay, prefs, contentEl) {
  const panel = document.createElement('div');
  panel.id = READER_SETTINGS_ID;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', browser.i18n.getMessage('readerSettings') || 'Reading settings');

  const themeLabel = document.createElement('div');
  themeLabel.className = 'ai-rs-section-label';
  themeLabel.textContent = browser.i18n.getMessage('readerThemeLabel') || 'Theme';

  const themeRow = makeRow();
  // Display initials so buttons are visually distinguishable without relying on color alone.
  const THEMES = [
    { key: 'auto',  msgKey: 'readerThemeAuto',  glyph: null       },
    { key: 'light', msgKey: 'readerThemeLight', glyph: 'L'        },
    { key: 'sepia', msgKey: 'readerThemeSepia', glyph: 'S'        },
    { key: 'dark',  msgKey: 'readerThemeDark',  glyph: 'D'        },
  ];
  const themeBtns = THEMES.map(({ key, msgKey, glyph }) => {
    const label = browser.i18n.getMessage(msgKey) || msgKey;
    const btn = document.createElement('button');
    btn.className = 'ai-rs-theme-btn';
    btn.dataset.theme = key;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', prefs.theme === key ? 'true' : 'false');
    // Colors are handled by CSS [data-theme] rules — no inline styles needed.
    btn.textContent = glyph ?? label;
    if (prefs.theme === key) btn.classList.add('active');
    btn.addEventListener('click', () => {
      prefs.theme = key;
      applyPrefs(overlay, prefs);
      themeBtns.forEach(b => {
        const isActive = b.dataset.theme === key;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
      saveReaderPrefs(prefs);
    });
    return btn;
  });
  themeBtns.forEach(b => themeRow.appendChild(b));

  const { row: fontRow, minus: fontMinus, val: fontVal, plus: fontPlus } =
    makeStepper(browser.i18n.getMessage('readerFontLabel') || 'Font', FONT_SIZES[prefs.fontSize] + 'px');
  fontMinus.disabled = prefs.fontSize === 0;
  fontPlus.disabled  = prefs.fontSize === FONT_SIZES.length - 1;
  holdRepeat(fontMinus, () => {
    if (prefs.fontSize === 0) return;
    prefs.fontSize--;
    fontVal.textContent = FONT_SIZES[prefs.fontSize] + 'px';
    fontMinus.disabled  = prefs.fontSize === 0;
    fontPlus.disabled   = false;
    applyPrefs(overlay, prefs); saveReaderPrefs(prefs);
  });
  holdRepeat(fontPlus, () => {
    if (prefs.fontSize === FONT_SIZES.length - 1) return;
    prefs.fontSize++;
    fontVal.textContent = FONT_SIZES[prefs.fontSize] + 'px';
    fontPlus.disabled   = prefs.fontSize === FONT_SIZES.length - 1;
    fontMinus.disabled  = false;
    applyPrefs(overlay, prefs); saveReaderPrefs(prefs);
  });

  const { row: spacingRow, minus: spacingMinus, val: spacingVal, plus: spacingPlus } =
    makeStepper(browser.i18n.getMessage('readerSpacingLabel') || 'Spacing', LINE_SPACINGS[prefs.lineSpacing] + '×');
  spacingMinus.disabled = prefs.lineSpacing === 0;
  spacingPlus.disabled  = prefs.lineSpacing === LINE_SPACINGS.length - 1;
  holdRepeat(spacingMinus, () => {
    if (prefs.lineSpacing === 0) return;
    prefs.lineSpacing--;
    spacingVal.textContent = LINE_SPACINGS[prefs.lineSpacing] + '×';
    spacingMinus.disabled  = prefs.lineSpacing === 0;
    spacingPlus.disabled   = false;
    applyPrefs(overlay, prefs); saveReaderPrefs(prefs);
  });
  holdRepeat(spacingPlus, () => {
    if (prefs.lineSpacing === LINE_SPACINGS.length - 1) return;
    prefs.lineSpacing++;
    spacingVal.textContent = LINE_SPACINGS[prefs.lineSpacing] + '×';
    spacingPlus.disabled   = prefs.lineSpacing === LINE_SPACINGS.length - 1;
    spacingMinus.disabled  = false;
    applyPrefs(overlay, prefs); saveReaderPrefs(prefs);
  });

  const widthRow = makeRow();
  const widthBtns = WIDTHS.map(({ key, px, msgKey }) => {
    const label = browser.i18n.getMessage(msgKey) || key;
    const btn = document.createElement('button');
    btn.className = 'ai-rs-width-btn';
    btn.dataset.width = key;
    btn.textContent = label;
    btn.setAttribute('aria-pressed', prefs.width === key ? 'true' : 'false');
    if (prefs.width === key) btn.classList.add('active');
    btn.addEventListener('click', () => {
      prefs.width = key;
      applyPrefs(overlay, prefs);
      // Set maxWidth directly on the content element so the CSS transition fires.
      // (CSS transitions do not animate through custom property changes.)
      if (contentEl) contentEl.style.maxWidth = px + 'px';
      widthBtns.forEach(b => {
        const isActive = b.dataset.width === key;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
      saveReaderPrefs(prefs);
    });
    return btn;
  });
  widthBtns.forEach(b => widthRow.appendChild(b));

  panel.append(themeLabel, themeRow, fontRow, spacingRow, widthRow);
  return panel;
}

function positionSettingsPopup(popup, anchorEl) {
  const POPUP_W              = 220;
  const GAP                  = 24;  // box-shadow blur is 32px; 24px gives ~8px clear visual gap after shadow
  const MARGIN               = 8;
  const SETTINGS_MAX_H_FALLBACK = 280; // matches --reader-settings-max-h in reader CSS
  // Read max-height from the CSS custom property so JS and CSS stay in sync automatically.
  // Fall back to the constant above if the property is unavailable (e.g. popup not yet in DOM).
  const rawMaxH = parseInt(getComputedStyle(popup).getPropertyValue('--reader-settings-max-h'));
  const SETTINGS_MAX_H = Number.isFinite(rawMaxH) ? rawMaxH : SETTINGS_MAX_H_FALLBACK;

  let anchorTop, anchorLeft, anchorRight;
  if (anchorEl) {
    const r = anchorEl.getBoundingClientRect();
    anchorTop   = r.top;
    anchorLeft  = r.left;
    anchorRight = r.right;
  } else {
    // No anchor available — center near top-right of screen
    anchorTop   = MARGIN;
    anchorLeft  = window.innerWidth / 2;
    anchorRight = window.innerWidth / 2;
  }

  const fitsLeft = anchorLeft - GAP - POPUP_W >= MARGIN;
  const left = fitsLeft
    ? anchorLeft - GAP - POPUP_W
    : Math.min(anchorRight + GAP, window.innerWidth - POPUP_W - MARGIN);

  // Clamp top synchronously using the CSS max-height constant — no rAF needed.
  const rawTop = anchorTop;
  const top = rawTop + SETTINGS_MAX_H > window.innerHeight - MARGIN
    ? Math.max(MARGIN, window.innerHeight - SETTINGS_MAX_H - MARGIN)
    : rawTop;

  // Set transform-origin before the caller adds .open so the scale animation
  // starts from the correct corner.
  popup.style.transformOrigin = fitsLeft ? 'top right' : 'top left';
  popup.style.left   = left + 'px';
  popup.style.top    = top + 'px';
  popup.style.right  = 'auto';
  popup.style.bottom = 'auto';
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
  minus.setAttribute('aria-label', `${label} decrease`);
  const val = document.createElement('span');
  val.className = 'ai-rs-stepper-val';
  val.textContent = initialVal;
  const plus = document.createElement('button');
  plus.className = 'ai-rs-step-btn';
  plus.textContent = '+';
  plus.setAttribute('aria-label', `${label} increase`);
  row.append(lbl, minus, val, plus);
  return { row, minus, val, plus };
}

// Attach hold-to-repeat behaviour to a stepper button.
// Fires action() once on press, then repeatedly after 400ms delay at 80ms intervals.
function holdRepeat(btn, action) {
  let repeatTimer = null;
  let intervalTimer = null;

  function start() {
    action();
    repeatTimer = setTimeout(() => {
      intervalTimer = setInterval(action, 80);
    }, 400);
  }

  function stop() {
    clearTimeout(repeatTimer);
    clearInterval(intervalTimer);
    repeatTimer = null;
    intervalTimer = null;
  }

  btn.addEventListener('mousedown', start);
  btn.addEventListener('touchstart', start, { passive: true });
  btn.addEventListener('mouseup', stop);
  btn.addEventListener('mouseleave', stop);
  btn.addEventListener('touchend', stop);
  btn.addEventListener('touchcancel', stop);
}
