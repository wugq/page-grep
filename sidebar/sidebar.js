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

// --- Initialization ---

async function init() {
  const { showFloatBtn, userInterests, theme } = await browser.storage.local.get([
    STORAGE_KEYS.SHOW_FLOAT_BTN, STORAGE_KEYS.USER_INTERESTS, STORAGE_KEYS.THEME
  ]);

  // Theme Toggle
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.checked = isThemeDark(theme);
    themeToggle.addEventListener('change', () => {
      browser.storage.local.set({ [STORAGE_KEYS.THEME]: themeToggle.checked ? 'dark' : 'light' });
    });
  }

  // Handle system theme changes if no explicit preference is set
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async (e) => {
    const { theme } = await browser.storage.local.get(STORAGE_KEYS.THEME);
    if (!theme && themeToggle) themeToggle.checked = e.matches;
  });

  // Global Toggles
  const floatCheckbox = document.getElementById('show-float-btn');
  if (floatCheckbox) floatCheckbox.checked = showFloatBtn !== false;
  floatCheckbox?.addEventListener('change', () => {
    browser.storage.local.set({ [STORAGE_KEYS.SHOW_FLOAT_BTN]: floatCheckbox.checked });
    updateHideOnSiteToggle();
  });

  // Hide on this site toggle
  const hideOnSiteToggle = document.getElementById('hide-on-site-toggle');
  hideOnSiteToggle.addEventListener('change', async () => {
    const hostname = hideOnSiteToggle.dataset.hostname;
    if (!hostname) return;
    const { blockedDomains } = await browser.storage.local.get(STORAGE_KEYS.BLOCKED_DOMAINS);
    const list = Array.isArray(blockedDomains) ? blockedDomains : [];
    const updated = hideOnSiteToggle.checked
      ? [...new Set([...list, hostname])]
      : list.filter(d => d !== hostname);
    await browser.storage.local.set({ [STORAGE_KEYS.BLOCKED_DOMAINS]: updated });
  });

  // Interests Config (pill-based)
  const pillsContainer = document.getElementById('pills-container');
  const interestsInput = document.getElementById('interests-input');
  const statusEl = document.getElementById('interests-status');
  let interestPills = userInterests
    ? userInterests.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  function renderPills() {
    pillsContainer.innerHTML = '';
    interestPills.forEach((label, i) => {
      const tag = document.createElement('span');
      tag.className = 'interest-pill-tag';
      tag.textContent = label;
      const removeBtn = document.createElement('button');
      removeBtn.className = 'pill-remove';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        interestPills.splice(i, 1);
        saveAndRender();
      });
      tag.appendChild(removeBtn);
      pillsContainer.appendChild(tag);
    });
  }

  async function saveAndRender() {
    const val = interestPills.join(', ');
    await browser.storage.local.set({ [STORAGE_KEYS.USER_INTERESTS]: val || null });
    renderPills();
    statusEl.classList.remove('hidden');
    setTimeout(() => statusEl.classList.add('hidden'), 2000);
  }

  function addInterest() {
    const val = interestsInput.value.trim();
    if (!val || interestPills.includes(val)) return;
    interestPills.push(val);
    interestsInput.value = '';
    saveAndRender();
  }

  document.getElementById('add-interest-btn').addEventListener('click', addInterest);
  interestsInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addInterest(); }
  });

  renderPills();

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
      showError(browser.i18n.getMessage('connectionError'));
    }
  });

  document.getElementById('highlight-btn').addEventListener('click', async () => {
    setButtonLoading('highlight-btn', true);
    const sent = await sendToActiveTab({ action: 'runHighlight' });
    if (!sent) {
      setButtonLoading('highlight-btn', false);
      showError(browser.i18n.getMessage('connectionError'));
    }
  });

  // Initial Data Load
  loadFromActiveTab();
  updateHideOnSiteToggle();
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

async function updateHideOnSiteToggle() {
  const hideOnSiteRow = document.getElementById('hide-on-site-row');
  const hideOnSiteToggle = document.getElementById('hide-on-site-toggle');
  const { showFloatBtn, blockedDomains } = await browser.storage.local.get([
    STORAGE_KEYS.SHOW_FLOAT_BTN, STORAGE_KEYS.BLOCKED_DOMAINS
  ]);
  if (showFloatBtn === false) {
    hideOnSiteRow.classList.add('hidden');
    return;
  }
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const url = tabs[0]?.url || '';
  let hostname;
  try { hostname = new URL(url).hostname; } catch (_) { hostname = ''; }
  if (!hostname) {
    hideOnSiteRow.classList.add('hidden');
    return;
  }
  hideOnSiteToggle.dataset.hostname = hostname;
  const blocked = Array.isArray(blockedDomains) ? blockedDomains : [];
  hideOnSiteToggle.checked = blocked.includes(hostname);
  hideOnSiteRow.classList.remove('hidden');
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
  updateHideOnSiteToggle();
}

// --- UI Helpers ---

const LOADING_TIMEOUT_MS = 25000; // slightly less than API_TIMEOUT_MS (30s) in background.js
const _loadingTimers = {};

function setButtonLoading(id, isLoading) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = isLoading;
  btn.classList.toggle('is-loading', isLoading);

  clearTimeout(_loadingTimers[id]);
  if (isLoading) {
    _loadingTimers[id] = setTimeout(() => {
      setButtonLoading(id, false);
      showError(browser.i18n.getMessage('requestTimeout'));
    }, LOADING_TIMEOUT_MS);
  }
}

function showError(message, code) {
  const errorEl = document.getElementById('global-error');
  if (code === 'NO_API_KEY') {
    errorEl.innerHTML = '';
    errorEl.appendChild(document.createTextNode(message + ' — '));
    const link = document.createElement('a');
    link.href = '#';
    link.style.cssText = 'color:inherit;font-weight:700;text-decoration:underline;cursor:pointer;';
    link.textContent = browser.i18n.getMessage('settingsLinkLabel') || 'Settings';
    link.addEventListener('click', (e) => { e.preventDefault(); browser.runtime.openOptionsPage(); });
    errorEl.appendChild(link);
  } else {
    errorEl.textContent = message || browser.i18n.getMessage('operationFailed');
  }
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
      line.addEventListener('mouseleave', () => sendToActiveTab({ action: 'summaryUnhover', index: sub.index }));
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
    emptyEl.textContent = browser.i18n.getMessage('matchesPlaceholder');
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'summary-item';

    const detail = document.createElement('div');
    detail.className = 'summary-item-detail';
    const preview = item.text.length > 120 ? item.text.slice(0, 120).trimEnd() + '…' : item.text;
    detail.textContent = preview;
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
    showError(message.error || browser.i18n.getMessage('summaryFailed'), message.code);
    setButtonLoading('summary-btn', false);
  }

  if (message.action === 'highlightDone') {
    const items = Array.isArray(message.items) ? message.items : [];
    renderHighlights(items);
    if (items.length === 0) {
      document.getElementById('highlight-empty').textContent = browser.i18n.getMessage('noMatchFound');
    } else {
      hideError();
    }
    setButtonLoading('highlight-btn', false);
  }

  if (message.action === 'highlightError') {
    showError(message.error || browser.i18n.getMessage('matchFailed'), message.code);
    setButtonLoading('highlight-btn', false);
  }

});

browser.tabs.onActivated.addListener((activeInfo) => {
  lastTabId = activeInfo.tabId;
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
    updateHideOnSiteToggle();
  }
  if (STORAGE_KEYS.BLOCKED_DOMAINS in changes) {
    updateHideOnSiteToggle();
  }
  if (STORAGE_KEYS.UI_LANG in changes) {
    location.reload();
    return;
  }
  if (STORAGE_KEYS.THEME in changes) {
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) themeToggle.checked = isThemeDark(changes[STORAGE_KEYS.THEME].newValue);
  }
});

// Start
(window.i18nReady || Promise.resolve()).then(() => init().catch(console.error));
