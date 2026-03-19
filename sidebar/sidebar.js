let lastTabId = null;

// --- Tab Navigation ---

const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const targetTab = btn.getAttribute('data-tab');

    tabBtns.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));

    btn.classList.add('active');
    document.getElementById(`${targetTab}-tab`).classList.add('active');
  });
});

// --- Collapsible Config ---

const toggleConfigBtn = document.getElementById('toggle-config-btn');
const interestsConfig = document.getElementById('interests-config');

toggleConfigBtn.addEventListener('click', () => {
  const isHidden = interestsConfig.classList.contains('hidden');
  interestsConfig.classList.toggle('hidden', !isHidden);
  toggleConfigBtn.textContent = isHidden ? '收起设置' : '展开设置';
});

// --- Initialization ---

async function init() {
  const { showFloatBtn, userInterests, theme } = await browser.storage.local.get([
    STORAGE_KEYS.SHOW_FLOAT_BTN, STORAGE_KEYS.USER_INTERESTS, STORAGE_KEYS.THEME
  ]);

  // Theme Toggle
  const themeToggle = document.getElementById('theme-toggle');
  const isDark = theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
  themeToggle.checked = isDark;
  themeToggle.addEventListener('change', () => {
    browser.storage.local.set({ [STORAGE_KEYS.THEME]: themeToggle.checked ? 'dark' : 'light' });
  });

  // Handle system theme changes if no explicit preference is set
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async (e) => {
    const { theme } = await browser.storage.local.get(STORAGE_KEYS.THEME);
    if (!theme) themeToggle.checked = e.matches;
  });

  // Global Toggles
  const floatCheckbox = document.getElementById('show-float-btn');
  floatCheckbox.checked = showFloatBtn !== false;
  floatCheckbox.addEventListener('change', () => {
    browser.storage.local.set({ [STORAGE_KEYS.SHOW_FLOAT_BTN]: floatCheckbox.checked });
  });

  // Interests Config
  const interestsInput = document.getElementById('interests-input');
  const clearBtn = document.getElementById('clear-interests-btn');
  const statusEl = document.getElementById('interests-status');

  if (userInterests) {
    interestsInput.value = userInterests;
    clearBtn.classList.remove('hidden');
  }

  document.getElementById('save-interests-btn').addEventListener('click', async () => {
    const val = interestsInput.value.trim();
    await browser.storage.local.set({ [STORAGE_KEYS.USER_INTERESTS]: val || null });
    clearBtn.classList.toggle('hidden', !val);
    statusEl.classList.remove('hidden');
    setTimeout(() => statusEl.classList.add('hidden'), 2000);
  });

  clearBtn.addEventListener('click', async () => {
    interestsInput.value = '';
    clearBtn.classList.add('hidden');
    await browser.storage.local.set({ [STORAGE_KEYS.USER_INTERESTS]: null });
  });

  // Options Button
  document.getElementById('options-btn').addEventListener('click', () => {
    browser.runtime.openOptionsPage();
  });

  // Action Buttons
  document.getElementById('summary-btn').addEventListener('click', async () => {
    setButtonLoading('summary-btn', true);
    const sent = await sendToActiveTab({ action: 'runSummary' });
    if (!sent) {
      setButtonLoading('summary-btn', false);
      showError('无法连接到页面，请刷新后重试。');
    }
  });

  document.getElementById('highlight-btn').addEventListener('click', async () => {
    setButtonLoading('highlight-btn', true);
    const sent = await sendToActiveTab({ action: 'runHighlight' });
    if (!sent) {
      setButtonLoading('highlight-btn', false);
      showError('无法连接到页面，请刷新后重试。');
    }
  });

  // Initial Data Load
  loadFromActiveTab();
}

// --- Messaging ---

async function getActiveTabId() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id || null;
  lastTabId = tabId;
  return tabId;
}

async function sendToActiveTab(message) {
  const tabId = await getActiveTabId();
  if (!tabId) return false;
  try {
    await browser.tabs.sendMessage(tabId, message);
    return true;
  } catch (_) {
    return false;
  }
}

async function loadFromActiveTab() {
  const tabId = await getActiveTabId();
  if (!tabId) return;

  setButtonLoading('summary-btn', false);
  setButtonLoading('highlight-btn', false);
  hideError();

  try {
    const [summaryRes, highlightRes] = await Promise.all([
      browser.tabs.sendMessage(tabId, { action: 'getSummaryData' }).catch(() => null),
      browser.tabs.sendMessage(tabId, { action: 'getHighlightData' }).catch(() => null)
    ]);

    renderSummary(summaryRes?.points || []);
    renderHighlights(highlightRes?.items || []);
  } catch (err) {
    // Tab might not have content script yet or is restricted
    renderSummary([]);
    renderHighlights([]);
  }
}

// --- UI Helpers ---

function setButtonLoading(id, isLoading) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = isLoading;
  btn.classList.toggle('is-loading', isLoading);
}

function showError(message) {
  const errorEl = document.getElementById('global-error');
  errorEl.textContent = message || '操作失败，请重试。';
  errorEl.classList.remove('hidden');
}

function hideError() {
  document.getElementById('global-error').classList.add('hidden');
}

function renderSummary(points) {
  const listEl = document.getElementById('summary-list');
  const emptyEl = document.getElementById('summary-empty');
  listEl.innerHTML = '';

  if (!points || points.length === 0) {
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  points.forEach(point => {
    const item = document.createElement('div');
    item.className = 'summary-item';

    const titleEl = document.createElement('div');
    titleEl.className = 'summary-item-title';
    titleEl.textContent = point.title;
    item.appendChild(titleEl);

    const list = document.createElement('div');
    list.className = 'summary-sublist';
    (point.items || []).forEach(sub => {
      const line = document.createElement('div');
      line.className = 'summary-subitem';
      line.textContent = `• ${sub.text}`;
      line.addEventListener('mouseenter', () => sendToActiveTab({ action: 'summaryHover', index: sub.index }));
      line.addEventListener('mouseleave', () => sendToActiveTab({ action: 'summaryUnhover' }));
      line.addEventListener('click', () => sendToActiveTab({ action: 'summaryClick', index: sub.index }));
      list.appendChild(line);
    });
    item.appendChild(list);

    listEl.appendChild(item);
  });
}

function renderHighlights(items) {
  const listEl = document.getElementById('highlight-list');
  const emptyEl = document.getElementById('highlight-empty');
  listEl.innerHTML = '';

  if (!items || items.length === 0) {
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'summary-item';

    const detail = document.createElement('div');
    detail.className = 'summary-item-detail';
    detail.textContent = item.text;
    row.appendChild(detail);

    if (item.reason) {
      const reason = document.createElement('div');
      reason.className = 'highlight-reason';
      reason.textContent = item.reason;
      row.appendChild(reason);
    }

    row.addEventListener('mouseenter', () => sendToActiveTab({ action: 'highlightHover', index: item.index }));
    row.addEventListener('mouseleave', () => sendToActiveTab({ action: 'highlightUnhover', index: item.index }));
    row.addEventListener('click', () => sendToActiveTab({ action: 'highlightClick', index: item.index }));
    listEl.appendChild(row);
  });
}

// --- Listeners ---

browser.runtime.onMessage.addListener((message, sender) => {
  const senderTabId = sender?.tab?.id;
  if (senderTabId && senderTabId !== lastTabId) return;

  if (message.action === 'summaryUpdated') {
    renderSummary(message.points || []);
    setButtonLoading('summary-btn', false);
    hideError();
  }

  if (message.action === 'summaryError') {
    showError(message.error || '摘要生成失败。');
    setButtonLoading('summary-btn', false);
  }

  if (message.action === 'highlightDone') {
    const items = Array.isArray(message.items) ? message.items : [];
    renderHighlights(items);
    if (items.length === 0) {
      showError('未找到匹配内容。');
    } else {
      hideError();
    }
    setButtonLoading('highlight-btn', false);
  }

  if (message.action === 'highlightError') {
    showError(message.error || '兴趣匹配失败。');
    setButtonLoading('highlight-btn', false);
  }
});

browser.tabs.onActivated.addListener(() => {
  loadFromActiveTab();
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === lastTabId && changeInfo.status === 'complete') {
    loadFromActiveTab();
  }
});

browser.storage.onChanged.addListener((changes) => {
  if (STORAGE_KEYS.SHOW_FLOAT_BTN in changes) {
    const floatCheckbox = document.getElementById('show-float-btn');
    if (floatCheckbox) floatCheckbox.checked = changes[STORAGE_KEYS.SHOW_FLOAT_BTN].newValue !== false;
  }
  if (STORAGE_KEYS.THEME in changes) {
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
      const theme = changes[STORAGE_KEYS.THEME].newValue;
      const isDark = theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
      themeToggle.checked = isDark;
    }
  }
});

// Start
init().catch(console.error);
