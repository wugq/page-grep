(function() {
  async function applyTheme() {
    const { theme } = await browser.storage.local.get(STORAGE_KEYS.THEME);
    document.documentElement.classList.toggle('dark', isThemeDark(theme));
  }

  // Apply theme immediately
  applyTheme();

  // Listen for storage changes
  browser.storage.onChanged.addListener((changes) => {
    if (changes[STORAGE_KEYS.THEME]) {
      applyTheme();
    }
  });

})();
