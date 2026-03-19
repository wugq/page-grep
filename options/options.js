async function loadSettings() {
  const { openaiApiKey, preferredModel, theme, showFloatBtn, uiLang, translateLang } = await browser.storage.local.get([
    STORAGE_KEYS.API_KEY, STORAGE_KEYS.MODEL, STORAGE_KEYS.THEME, STORAGE_KEYS.SHOW_FLOAT_BTN, STORAGE_KEYS.UI_LANG, STORAGE_KEYS.TRANSLATE_LANG
  ]);

  if (openaiApiKey) document.getElementById('api-key').value = openaiApiKey;
  if (preferredModel) document.getElementById('model-select').value = preferredModel;
  if (theme !== undefined) document.getElementById('theme-select').value = theme || '';
  document.getElementById('language-select').value = uiLang || '';
  document.getElementById('translate-lang-select').value = translateLang || 'zh-CN';

  const floatCheckbox = document.getElementById('show-float-btn');
  if (floatCheckbox) floatCheckbox.checked = showFloatBtn !== false;
}

function showStatus(message, type) {
  const statusEl = document.getElementById('save-status');
  statusEl.textContent = message;
  statusEl.className = type;
  statusEl.classList.remove('hidden');
  setTimeout(() => statusEl.classList.add('hidden'), 3000);
}

document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const apiKey = document.getElementById('api-key').value.trim();
  const model = document.getElementById('model-select').value;
  const theme = document.getElementById('theme-select').value;
  const showFloatBtn = document.getElementById('show-float-btn').checked;
  const uiLang = document.getElementById('language-select').value;
  const translateLang = document.getElementById('translate-lang-select').value;

  if (!apiKey) {
    showStatus(browser.i18n.getMessage('enterApiKey'), 'error');
    return;
  }

  if (!apiKey.startsWith('sk-')) {
    showStatus(browser.i18n.getMessage('invalidApiKey'), 'error');
    return;
  }

  try {
    const prevLang = (await browser.storage.local.get(STORAGE_KEYS.UI_LANG))[STORAGE_KEYS.UI_LANG] || '';
    await browser.storage.local.set({
      [STORAGE_KEYS.API_KEY]: apiKey,
      [STORAGE_KEYS.MODEL]: model,
      [STORAGE_KEYS.THEME]: theme || null,
      [STORAGE_KEYS.SHOW_FLOAT_BTN]: showFloatBtn,
      [STORAGE_KEYS.UI_LANG]: uiLang || null,
      [STORAGE_KEYS.TRANSLATE_LANG]: translateLang || null,
    });
    if (uiLang !== prevLang) {
      location.reload();
      return;
    }
    showStatus(browser.i18n.getMessage('settingsSaved'), 'success');
  } catch (err) {
    showStatus(browser.i18n.getMessage('saveFailed') + err.message, 'error');
  }
});

document.getElementById('clear-btn').addEventListener('click', async () => {
  if (!confirm(browser.i18n.getMessage('confirmClear'))) return;

  await browser.storage.local.remove([
    STORAGE_KEYS.API_KEY, STORAGE_KEYS.MODEL, STORAGE_KEYS.THEME,
    STORAGE_KEYS.SHOW_FLOAT_BTN, STORAGE_KEYS.USER_INTERESTS, STORAGE_KEYS.UI_LANG, STORAGE_KEYS.TRANSLATE_LANG
  ]);
  document.getElementById('api-key').value = '';
  document.getElementById('model-select').value = 'gpt-4o-mini';
  document.getElementById('theme-select').value = '';
  document.getElementById('language-select').value = '';
  document.getElementById('translate-lang-select').value = 'zh-CN';
  document.getElementById('show-float-btn').checked = true;
  showStatus(browser.i18n.getMessage('settingsCleared'), 'success');
});

document.getElementById('toggle-visibility').addEventListener('click', () => {
  const input = document.getElementById('api-key');
  input.type = input.type === 'password' ? 'text' : 'password';
});

browser.storage.onChanged.addListener((changes) => {
  if (STORAGE_KEYS.THEME in changes) {
    document.getElementById('theme-select').value = changes[STORAGE_KEYS.THEME].newValue || '';
  }
  if (STORAGE_KEYS.SHOW_FLOAT_BTN in changes) {
    document.getElementById('show-float-btn').checked = changes[STORAGE_KEYS.SHOW_FLOAT_BTN].newValue !== false;
  }
});

(window.i18nReady || Promise.resolve()).then(() => loadSettings().catch(console.error));
