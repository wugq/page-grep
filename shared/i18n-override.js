// Patches browser.i18n.getMessage to use the user-selected locale override.
// Loaded after shared/storage-keys.js in all contexts (content scripts and HTML pages).
async function applyI18nOverride() {
  try {
    const result = await browser.storage.local.get(STORAGE_KEYS.UI_LANG);
    const uiLang = result[STORAGE_KEYS.UI_LANG];
    if (!uiLang) return;
    const url = browser.runtime.getURL(`_locales/${uiLang}/messages.json`);
    const resp = await fetch(url);
    if (!resp.ok) return;
    const messages = await resp.json();
    const orig = browser.i18n.getMessage.bind(browser.i18n);
    browser.i18n.getMessage = function(key, substitutions) {
      const entry = messages[key];
      if (!entry) return orig(key, substitutions);
      let msg = entry.message;
      if (substitutions && entry.placeholders) {
        const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
        Object.keys(entry.placeholders).forEach((name, idx) => {
          msg = msg.replace(new RegExp('\\$' + name + '\\$', 'gi'), subs[idx] ?? '');
        });
      }
      return msg;
    };
  } catch (_) {}
}
