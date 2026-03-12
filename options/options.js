async function loadSettings() {
  const { openaiApiKey, preferredModel } = await browser.storage.local.get(['openaiApiKey', 'preferredModel']);

  if (openaiApiKey) {
    document.getElementById('api-key').value = openaiApiKey;
  }

  if (preferredModel) {
    document.getElementById('model-select').value = preferredModel;
  }
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

  if (!apiKey) {
    showStatus('请输入 API Key', 'error');
    return;
  }

  if (!apiKey.startsWith('sk-')) {
    showStatus('API Key 格式不正确，应以 "sk-" 开头', 'error');
    return;
  }

  try {
    await browser.storage.local.set({ openaiApiKey: apiKey, preferredModel: model });
    showStatus('✓ 设置已保存', 'success');
  } catch (err) {
    showStatus('保存失败：' + err.message, 'error');
  }
});

document.getElementById('clear-btn').addEventListener('click', async () => {
  if (!confirm('确定要清除 API Key 吗？')) return;

  await browser.storage.local.remove(['openaiApiKey']);
  document.getElementById('api-key').value = '';
  showStatus('✓ API Key 已清除', 'success');
});

document.getElementById('toggle-visibility').addEventListener('click', () => {
  const input = document.getElementById('api-key');
  input.type = input.type === 'password' ? 'text' : 'password';
});

loadSettings().catch(console.error);
