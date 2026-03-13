let lastTabId = null;

const summarySection = document.getElementById('summary-section');
const listEl = document.getElementById('summary-list');
const errorEl = document.getElementById('summary-error');
const highlightSection = document.getElementById('highlight-section');
const highlightList = document.getElementById('highlight-list');
const summaryBtn = document.getElementById('summary-btn');
const highlightBtn = document.getElementById('highlight-btn');
const summaryBtnLabel = summaryBtn.textContent;
const highlightBtnLabel = highlightBtn.textContent;

function setButtonStatus(btn, label, isLoading) {
  if (!btn) return;
  btn.disabled = isLoading;
  btn.classList.toggle('is-loading', isLoading);
  btn.textContent = isLoading ? '处理中...' : label;
  btn.setAttribute('aria-busy', isLoading ? 'true' : 'false');
}

function showError(message) {
  errorEl.textContent = message || '摘要生成失败。';
  errorEl.hidden = false;
}

function renderSummary(points) {
  listEl.innerHTML = '';
  errorEl.hidden = true;

  if (!points || points.length === 0) {
    summarySection.hidden = true;
    return;
  }
  summarySection.hidden = false;

  points.forEach(point => {
    const item = document.createElement('div');
    item.className = 'summary-item';
    const titleEl = document.createElement('div');
    titleEl.className = 'summary-item-title';
    titleEl.textContent = point.title;
    item.appendChild(titleEl);

    if (Array.isArray(point.items) && point.items.length > 0) {
      const list = document.createElement('div');
      list.className = 'summary-sublist';
      point.items.forEach(sub => {
        const line = document.createElement('div');
        line.className = 'summary-subitem';
        line.textContent = `• ${sub.text}`;
        line.addEventListener('mouseenter', () => sendToActiveTab({ action: 'summaryHover', index: sub.index }));
        line.addEventListener('mouseleave', () => sendToActiveTab({ action: 'summaryUnhover' }));
        line.addEventListener('click', () => sendToActiveTab({ action: 'summaryClick', index: sub.index }));
        list.appendChild(line);
      });
      item.appendChild(list);
    } else {
      const detail = document.createElement('div');
      detail.className = 'summary-item-detail';
      detail.textContent = point.detail || '';
      item.appendChild(detail);

      item.addEventListener('mouseenter', () => sendToActiveTab({ action: 'summaryHover', index: point.index }));
      item.addEventListener('mouseleave', () => sendToActiveTab({ action: 'summaryUnhover' }));
      item.addEventListener('click', () => sendToActiveTab({ action: 'summaryClick', index: point.index }));
    }

    listEl.appendChild(item);
  });
}

function renderHighlights(items) {
  highlightList.innerHTML = '';

  if (!items || items.length === 0) {
    highlightSection.hidden = true;
    return;
  }

  highlightSection.hidden = false;

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'summary-item';
    const detail = document.createElement('div');
    detail.className = 'summary-item-detail';
    detail.textContent = item.text;
    row.appendChild(detail);
    row.addEventListener('mouseenter', () => sendToActiveTab({ action: 'highlightHover', index: item.index }));
    row.addEventListener('mouseleave', () => sendToActiveTab({ action: 'highlightUnhover', index: item.index }));
    row.addEventListener('click', () => sendToActiveTab({ action: 'highlightClick', index: item.index }));
    highlightList.appendChild(row);
  });
}

async function getActiveTabId() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id || null;
  if (tabId) lastTabId = tabId;
  return tabId;
}

async function sendToActiveTab(message) {
  const tabId = lastTabId || await getActiveTabId();
  if (!tabId) return;
  try {
    await browser.tabs.sendMessage(tabId, message);
  } catch (_) {
    // Ignore when the tab has no content script.
  }
}

async function loadFromActiveTab() {
  const tabId = await getActiveTabId();
  if (!tabId) return;

  setButtonStatus(summaryBtn, summaryBtnLabel, false);
  setButtonStatus(highlightBtn, highlightBtnLabel, false);

  const [summaryRes, highlightRes] = await Promise.all([
    browser.tabs.sendMessage(tabId, { action: 'getSummaryData' }).catch(() => null),
    browser.tabs.sendMessage(tabId, { action: 'getHighlightData' }).catch(() => null)
  ]);
  renderSummary(summaryRes?.points || []);
  renderHighlights(highlightRes?.items || []);
}

summaryBtn.addEventListener('click', () => {
  setButtonStatus(summaryBtn, summaryBtnLabel, true);
  sendToActiveTab({ action: 'runSummary' });
});

highlightBtn.addEventListener('click', () => {
  setButtonStatus(highlightBtn, highlightBtnLabel, true);
  sendToActiveTab({ action: 'runHighlight' });
});

browser.runtime.onMessage.addListener((message, sender) => {
  const senderTabId = sender?.tab?.id;
  if (senderTabId && senderTabId !== lastTabId) return;

  if (message.action === 'summaryUpdated') {
    renderSummary(message.points || []);
    setButtonStatus(summaryBtn, summaryBtnLabel, false);
  }

  if (message.action === 'summaryError') {
    showError(message.error || '摘要生成失败。');
    setButtonStatus(summaryBtn, summaryBtnLabel, false);
  }

  if (message.action === 'highlightDone') {
    const items = Array.isArray(message.items) ? message.items : [];
    renderHighlights(items);
    if (items.length === 0) {
      showError('未找到匹配内容。');
    } else {
      errorEl.hidden = true;
    }
    setButtonStatus(highlightBtn, highlightBtnLabel, false);
  }

  if (message.action === 'highlightError') {
    showError(message.error || '兴趣匹配失败。');
    setButtonStatus(highlightBtn, highlightBtnLabel, false);
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

loadFromActiveTab();
