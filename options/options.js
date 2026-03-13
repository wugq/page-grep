async function loadSettings() {
  const { openaiApiKey, preferredModel, theme, showFloatBtn } = await browser.storage.local.get(['openaiApiKey', 'preferredModel', 'theme', 'showFloatBtn']);

  if (openaiApiKey) document.getElementById('api-key').value = openaiApiKey;
  if (preferredModel) document.getElementById('model-select').value = preferredModel;
  if (theme !== undefined) document.getElementById('theme-select').value = theme || '';
  
  const floatCheckbox = document.getElementById('show-float-btn');
  if (floatCheckbox) floatCheckbox.checked = showFloatBtn !== false;
}

function showStatus(message, type) {
  const statusEl = document.getElementById('save-status');
  statusEl.textContent = message;
  statusEl.className = type;
  statusEl.classList.remove('hidden');
  setTimeout(() => statusEl.classList.add('hidden'), 3000);
}

document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const apiKey = document.getElementById('api-key').value.trim();
  const model = document.getElementById('model-select').value;
  const theme = document.getElementById('theme-select').value;
  const showFloatBtn = document.getElementById('show-float-btn').checked;

  if (!apiKey) {
    showStatus('请输入 API Key', 'error');
    return;
  }

  if (!apiKey.startsWith('sk-')) {
    showStatus('API Key 格式不正确，应以 "sk-" 开头', 'error');
    return;
  }

  try {
    await browser.storage.local.set({ 
      openaiApiKey: apiKey, 
      preferredModel: model,
      theme: theme || null,
      showFloatBtn: showFloatBtn
    });
    showStatus('✓ 设置已保存', 'success');
  } catch (err) {
    showStatus('保存失败：' + err.message, 'error');
  }
});

document.getElementById('clear-btn').addEventListener('click', async () => {
  if (!confirm('确定要清除所有设置吗？')) return;

  await browser.storage.local.remove(['openaiApiKey', 'preferredModel', 'theme', 'showFloatBtn', 'userInterests']);
  document.getElementById('api-key').value = '';
  document.getElementById('model-select').value = 'gpt-4o-mini';
  document.getElementById('theme-select').value = '';
  document.getElementById('show-float-btn').checked = true;
  showStatus('✓ 设置已清除', 'success');
});

document.getElementById('toggle-visibility').addEventListener('click', () => {
  const input = document.getElementById('api-key');
  input.type = input.type === 'password' ? 'text' : 'password';
});

loadSettings().catch(console.error);
