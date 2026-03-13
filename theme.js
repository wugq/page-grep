(function() {
  async function applyTheme() {
    const { theme } = await browser.storage.local.get('theme');
    const isDark = theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
    
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  // Apply theme immediately
  applyTheme();

  // Listen for storage changes
  browser.storage.onChanged.addListener((changes) => {
    if (changes.theme) {
      applyTheme();
    }
  });

  // Listen for system theme changes if no theme is set
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async (e) => {
    const { theme } = await browser.storage.local.get('theme');
    if (!theme) {
      if (e.matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  });
})();
