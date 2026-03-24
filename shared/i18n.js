// Applies data-i18n* attributes and supports a user-selected locale override.
// Exposes window.i18nReady — a Promise that resolves once translations are applied.
// Other scripts should await it before calling browser.i18n.getMessage() dynamically.

window.i18nReady = (async function() {
  await applyI18nOverride();
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
  document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    const msg = browser.i18n.getMessage(el.getAttribute('data-i18n-aria-label'));
    if (msg) el.setAttribute('aria-label', msg);
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
