async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function getStorageData() {
  return browser.storage.local.get(['openaiApiKey', 'preferredModel']);
}

async function getPageText(tabId) {
  const response = await browser.tabs.sendMessage(tabId, { action: 'getPageText' });
  return response.text;
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function translateScreen() {
  const { openaiApiKey, preferredModel } = await getStorageData();
  if (!openaiApiKey) {
    document.getElementById('no-api-key').classList.remove('hidden');
    return;
  }
  const model = preferredModel || 'gpt-4o-mini';
  const tab = await getActiveTab();
  const btn = document.getElementById('btn-screen');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">▦</span> 翻译中...';
  try {
    await browser.tabs.sendMessage(tab.id, { action: 'translateVisible', apiKey: openaiApiKey, model });
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">▦</span> 翻译屏幕内容';
  }
}

async function init() {
  const tab = await getActiveTab();
  document.getElementById('page-title').textContent = tab.title || '(无标题)';

  try {
    const text = await getPageText(tab.id);
    const count = wordCount(text);
    document.getElementById('word-count').textContent = `约 ${count.toLocaleString()} 词`;
  } catch (e) {}

  const { openaiApiKey, showFloatBtn } = await browser.storage.local.get(['openaiApiKey', 'showFloatBtn']);
  if (!openaiApiKey) document.getElementById('no-api-key').classList.remove('hidden');

  const floatCheckbox = document.getElementById('show-float-btn');
  floatCheckbox.checked = showFloatBtn !== false; // default true
  floatCheckbox.addEventListener('change', () => {
    browser.storage.local.set({ showFloatBtn: floatCheckbox.checked });
  });

  document.getElementById('btn-screen').addEventListener('click', () => translateScreen());

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
