async function saveInterests() {
  const input = document.getElementById('interests-input');
  const interests = input.value.trim();
  const statusEl = document.getElementById('interests-status');
  const clearBtn = document.getElementById('clear-interests-btn');

  await browser.storage.local.set({ userInterests: interests || null });

  statusEl.classList.remove('hidden');
  setTimeout(() => statusEl.classList.add('hidden'), 2000);

  if (interests) {
    clearBtn.classList.remove('hidden');
  } else {
    clearBtn.classList.add('hidden');
  }
}

async function clearInterests() {
  document.getElementById('interests-input').value = '';
  document.getElementById('clear-interests-btn').classList.add('hidden');
  await browser.storage.local.set({ userInterests: null });
}

async function init() {
  const { showFloatBtn, userInterests, theme } = await browser.storage.local.get(['showFloatBtn', 'userInterests', 'theme']);

  const themeToggle = document.getElementById('theme-toggle');
  const isDark = theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
  themeToggle.checked = isDark;
  themeToggle.addEventListener('change', () => {
    browser.storage.local.set({ theme: themeToggle.checked ? 'dark' : 'light' });
  });

  // Handle system theme changes if no explicit preference is set
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async (e) => {
    const { theme } = await browser.storage.local.get('theme');
    if (!theme) {
      themeToggle.checked = e.matches;
    }
  });

  browser.storage.onChanged.addListener((changes) => {
    if ('theme' in changes) {
      const theme = changes.theme.newValue;
      const isDark = theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
      themeToggle.checked = isDark;
    }
  });

  const floatCheckbox = document.getElementById('show-float-btn');
  floatCheckbox.checked = showFloatBtn !== false;
  floatCheckbox.addEventListener('change', () => {
    browser.storage.local.set({ showFloatBtn: floatCheckbox.checked });
  });

  if (userInterests) {
    document.getElementById('interests-input').value = userInterests;
    document.getElementById('clear-interests-btn').classList.remove('hidden');
  }

  document.getElementById('save-interests-btn').addEventListener('click', () => saveInterests());
  document.getElementById('clear-interests-btn').addEventListener('click', () => clearInterests());

  document.getElementById('options-link').addEventListener('click', (e) => {
    e.preventDefault();
    browser.runtime.openOptionsPage();
  });
}

init().catch(console.error);
