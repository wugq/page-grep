// content-core.js — shared infrastructure: logging, constants, state, utilities
// Loaded first among content scripts; all other content modules depend on this.

function devlog(level, ...args) {
  try {
    const fn = level === 'warn' ? console.warn : level === 'error' ? console.error : console.log;
    fn('[PageGrep]', ...args);
  } catch (_) {}
  try {
    browser.runtime.sendMessage({
      action: 'log',
      level,
      args: args.map(a => (a !== null && typeof a === 'object') ? JSON.stringify(a) : String(a))
    }).catch(() => {});
  } catch (_) {}
}
const log   = (...a) => devlog('log',   ...a);
const warn  = (...a) => devlog('warn',  ...a);
const error = (...a) => devlog('error', ...a);

const PANEL_ID           = 'ai-reader-panel';
const FLOAT_BTN_ID       = 'ai-translate-btn';
const READER_MODE_BTN_ID = 'ai-reader-mode-btn';
const SCRATCHPAD_BTN_ID  = 'ai-scratchpad-btn';

const TRANSLATE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`;
const NOTE_ICON      = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" style="pointer-events:none"><rect x="3.5" y="1.5" width="13" height="17" rx="1.5" stroke="currentColor" stroke-width="1.5"/><line x1="6.5" y1="7" x2="13.5" y2="7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="6.5" y1="10" x2="13.5" y2="10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="6.5" y1="13" x2="10.5" y2="13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
const READER_ICON    = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;
// Toggle btn icons: translate icon (show translated) vs undo/back arrow (show original)
const TOGGLE_TRANSLATE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`;
const TOGGLE_ORIGINAL_ICON  = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>`;

// --- Floating panel shadow DOM CSS ---
// Styles scoped to the panel shadow root; page CSS cannot override these.
const PANEL_SHADOW_CSS = `
:host {
  position: fixed !important;
  bottom: 24px;
  right: 20px;
  top: auto;
  left: auto;
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 6px !important;
  z-index: 2147483647 !important;
  width: 46px !important;
  padding: 8px 0 !important;
  margin: 0 !important;
  user-select: none;
  background: rgba(248, 250, 252, 0.92);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-radius: 28px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  resize: none !important;
  box-sizing: content-box !important;
}
:host(.dark) {
  background: rgba(15, 23, 42, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
}
.ai-panel-btn {
  width: 34px;
  height: 34px;
  min-width: 34px;
  min-height: 34px;
  max-width: 34px;
  max-height: 34px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  font-size: 14px;
  font-weight: 700;
  color: white;
  padding: 0;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-family: "Plus Jakarta Sans", -apple-system, sans-serif;
  transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.18s, opacity 0.18s;
}
.ai-panel-btn:hover { transform: scale(1.12); box-shadow: inset 0 0 0 100px rgba(255,255,255,0.16); }
.ai-panel-btn:active { transform: scale(0.92); }
.ai-panel-btn:disabled { opacity: 0.45; cursor: wait; }
#ai-translate-btn { background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); box-shadow: 0 2px 10px rgba(99, 102, 241, 0.45); }
#ai-scratchpad-btn { background: linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%); box-shadow: 0 2px 10px rgba(14, 165, 233, 0.4); }
#ai-translate-btn:hover { box-shadow: inset 0 0 0 100px rgba(255,255,255,0.16), 0 4px 16px rgba(99,102,241,0.55); }
#ai-scratchpad-btn:hover { box-shadow: inset 0 0 0 100px rgba(255,255,255,0.16), 0 4px 16px rgba(14,165,233,0.5); }
#ai-reader-mode-btn { background: linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%); box-shadow: 0 2px 10px rgba(139, 92, 246, 0.4); }
#ai-reader-mode-btn:hover { box-shadow: inset 0 0 0 100px rgba(255,255,255,0.16), 0 4px 16px rgba(139, 92, 246, 0.5); }
#ai-reader-mode-btn.active { box-shadow: inset 0 0 0 100px rgba(0,0,0,0.15), 0 2px 10px rgba(139, 92, 246, 0.4); }
.ai-loading-btn { background: #94a3b8 !important; cursor: wait; animation: ai-pulse 1.2s ease-in-out infinite; }
@keyframes ai-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
`;

const _svgParser = new DOMParser();
function setTranslateIcon(el) {
  const doc = _svgParser.parseFromString(TRANSLATE_ICON, 'image/svg+xml');
  el.replaceChildren(doc.documentElement);
}
function setToggleIcon(btn, showingTranslation) {
  const src = showingTranslation ? TOGGLE_ORIGINAL_ICON : TOGGLE_TRANSLATE_ICON;
  const doc = _svgParser.parseFromString(src, 'image/svg+xml');
  btn.replaceChildren(doc.documentElement);
}

const SUMMARY_STATE = {
  points: null,
  elements: null
};
const HIGHLIGHT_STATE = {
  elements: null,
  items: null
};

// Cached theme value; set during init and on storage change.
// Declared here so content-panel.js can read it before content-init.js runs.
let _cachedTheme;

// --- DOM exclusion selector (used by dom + collectors modules) ---

const CHROME_SELECTOR = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], .sidebar, #sidebar, .nav, #nav, .menu, #menu, .footer, #footer';

// --- Theme change hook registry ---
// Feature modules (e.g. content-reader.js) register callbacks here so
// content-core.js does not need to know about them directly.

const _themeChangeHooks = [];
function onThemeChange(fn) { _themeChangeHooks.push(fn); }

async function applyThemeToPanel() {
  const { theme } = await browser.storage.local.get(STORAGE_KEYS.THEME);
  document.getElementById(PANEL_ID)?.classList.toggle('dark', isThemeDark(theme));
  _themeChangeHooks.forEach(fn => fn());
}

async function blockCurrentDomain() {
  const hostname = location.hostname;
  if (!hostname) return;
  const { blockedDomains } = await browser.storage.local.get(STORAGE_KEYS.BLOCKED_DOMAINS);
  const list = Array.isArray(blockedDomains) ? blockedDomains : [];
  if (!list.includes(hostname)) {
    await browser.storage.local.set({ [STORAGE_KEYS.BLOCKED_DOMAINS]: [...list, hostname] });
  }
}

// Looks up a button by id inside the panel's shadow root.
function panelGetById(id) {
  return document.getElementById(PANEL_ID)?.shadowRoot?.getElementById(id) ?? null;
}

function getOrCreatePanel() {
  let panel = document.getElementById(PANEL_ID);
  if (!panel) {
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    const shadowRoot = panel.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = PANEL_SHADOW_CSS;
    shadowRoot.appendChild(style);
    document.body.appendChild(panel);
    applyThemeToPanel();
  }
  return panel;
}

function removePanelIfEmpty() {
  const panel = document.getElementById(PANEL_ID);
  if (panel && !panel.shadowRoot?.querySelector('button')) panel.remove();
}

function isApiKeyError(msg, code) {
  if (code === 'NO_API_KEY') return true;
  const noKeyMsg = browser.i18n.getMessage('enterApiKey');
  return msg === noKeyMsg;
}

function throwFromResponse(response) {
  const err = new Error(response.error);
  if (response.code) err.code = response.code;
  throw err;
}

function showApiKeyToast() {
  let toast = document.getElementById('ai-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'ai-toast';
    document.body.appendChild(toast);
  }
  toast.innerHTML = '';
  const msgNode = document.createTextNode((browser.i18n.getMessage('enterApiKey') || 'No API key set') + ' — ');
  const link = document.createElement('a');
  link.href = '#';
  link.style.cssText = 'color:#818cf8;text-decoration:underline;cursor:pointer;';
  link.textContent = browser.i18n.getMessage('settingsLinkLabel') || 'Settings';
  link.addEventListener('click', (e) => { e.preventDefault(); browser.runtime.sendMessage({ action: 'openOptionsPage' }); });
  toast.appendChild(msgNode);
  toast.appendChild(link);
  toast.style.pointerEvents = 'auto';
  clearTimeout(toast._hideTimer);
  toast.classList.add('ai-toast-show');
  toast._hideTimer = setTimeout(() => { toast.classList.remove('ai-toast-show'); toast.style.pointerEvents = ''; }, 4000);
}

function showToast(msg) {
  let toast = document.getElementById('ai-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'ai-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.setAttribute('aria-atomic', 'true');
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.pointerEvents = '';
  clearTimeout(toast._hideTimer);
  toast.classList.add('ai-toast-show');
  toast._hideTimer = setTimeout(() => toast.classList.remove('ai-toast-show'), 2000);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  showToast(browser.i18n.getMessage('copied') || 'Copied ✓');
}
