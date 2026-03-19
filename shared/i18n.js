// Applies data-i18n* attributes and supports a user-selected locale override.
// Exposes window.i18nReady — a Promise that resolves once translations are applied.
// Other scripts should await it before calling browser.i18n.getMessage() dynamically.

window.i18nReady = (async function initI18n() {
  try {
    const { uiLang } = await browser.storage.local.get('uiLang');
    if (uiLang) {
      const url = browser.runtime.getURL(`_locales/${uiLang}/messages.json`);
      const resp = await fetch(url);
      if (resp.ok) {
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
      }
    }
  } catch (_) {}

  applyI18n();
  document.body.style.visibility = '';
})();

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const msg = browser.i18n.getMessage(el.getAttribute('data-i18n'));
    if (msg) el.textContent = msg;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const msg = browser.i18n.getMessage(el.getAttribute('data-i18n-placeholder'));
    if (msg) el.placeholder = msg;
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const msg = browser.i18n.getMessage(el.getAttribute('data-i18n-title'));
    if (msg) el.title = msg;
  });
  const parser = new DOMParser();
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const msg = browser.i18n.getMessage(el.getAttribute('data-i18n-html'));
    if (msg) {
      const doc = parser.parseFromString(msg, 'text/html');
      el.replaceChildren(...doc.body.childNodes);
    }
  });
}
