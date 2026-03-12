// Connect to background script via port
const port = browser.runtime.connect({ name: 'sidebar' });

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const name = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`panel-${name}`).classList.add('active');
  });
});

function showLoading(panelId, message) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  panel.innerHTML = `<div class="loading"><div class="spinner"></div><div>${message}</div></div>`;
  // Switch to that tab
  const tabName = panelId.replace('panel-', '');
  document.querySelector(`[data-tab="${tabName}"]`)?.click();
}

function showError(panelId, errorMsg) {
  const panel = document.getElementById(panelId);
  if (panel) panel.innerHTML = `<div class="error-box">错误：${errorMsg}</div>`;
}

function formatText(text) {
  return text.split('\n').filter(l => l.trim()).map(l => `<p>${l}</p>`).join('');
}

function showSummary(text, truncated, originalWords) {
  const panel = document.getElementById('panel-summary');
  if (!panel) return;
  const warning = truncated
    ? `<div class="truncated-warning">⚠️ 内容过长，仅分析了前6000词（原文约${originalWords}词）</div>`
    : '';
  panel.innerHTML = `${warning}<div class="result-text">${formatText(text)}</div>`;
}

function showTranslation(text, truncated, originalWords) {
  const panel = document.getElementById('panel-translation');
  if (!panel) return;
  const warning = truncated
    ? `<div class="truncated-warning">⚠️ 内容过长，仅翻译了前6000词（原文约${originalWords}词）</div>`
    : '';
  panel.innerHTML = `${warning}<div class="result-text">${formatText(text)}</div>`;
}

port.onMessage.addListener((msg) => {
  if (msg.action === 'showLoading') {
    if (msg.panel === 'summary' || msg.panel === 'both') {
      showLoading('panel-summary', '正在生成摘要...');
    }
    if (msg.panel === 'translation' || msg.panel === 'both') {
      showLoading('panel-translation', '正在翻译...');
      if (msg.panel === 'translation') {
        document.querySelector('[data-tab="translation"]')?.click();
      }
    }
  }

  if (msg.action === 'showResult') {
    if (msg.summary !== undefined) showSummary(msg.summary, msg.truncated, msg.originalWords);
    if (msg.translation !== undefined) showTranslation(msg.translation, msg.truncated, msg.originalWords);
    if (msg.error) {
      if (msg.panel === 'summary') showError('panel-summary', msg.error);
      if (msg.panel === 'translation') showError('panel-translation', msg.error);
      if (msg.panel === 'both') {
        showError('panel-summary', msg.error);
        showError('panel-translation', msg.error);
      }
    }
  }
});
