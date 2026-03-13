async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function getPageText(tabId) {
  const response = await browser.tabs.sendMessage(tabId, { action: 'getPageText' });
  return response.text;
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

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
  const tab = await getActiveTab();
  document.getElementById('page-title').textContent = tab.title || '(无标题)';

  try {
    const text = await getPageText(tab.id);
    const count = wordCount(text);
    document.getElementById('word-count').textContent = `约 ${count.toLocaleString()} 词`;
  } catch (e) {}

  const { openaiApiKey, showFloatBtn, userInterests } = await browser.storage.local.get(['openaiApiKey', 'showFloatBtn', 'userInterests']);
  if (!openaiApiKey) document.getElementById('no-api-key').classList.remove('hidden');

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

  document.getElementById('go-to-options').addEventListener('click', (e) => {
    e.preventDefault();
    browser.runtime.openOptionsPage();
  });
  document.getElementById('options-link').addEventListener('click', (e) => {
    e.preventDefault();
    browser.runtime.openOptionsPage();
  });
}

init().catch(console.error);
