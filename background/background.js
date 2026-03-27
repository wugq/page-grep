const AI_CONFIG = {
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  defaultModel: 'gpt-4o-mini',
};

const TRANSLATE_LANG_NAMES = {
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
  'en':    'English',
  'es':    'Spanish',
  'fr':    'French',
  'de':    'German',
  'ja':    'Japanese',
  'ko':    'Korean',
  'pt':    'Portuguese',
  'ru':    'Russian',
  'ar':    'Arabic',
  'hi':    'Hindi',
  'it':    'Italian',
  'nl':    'Dutch',
  'tr':    'Turkish',
  'vi':    'Vietnamese',
  'th':    'Thai',
};

browser.browserAction.onClicked.addListener(() => {
  browser.sidebarAction.toggle();
});

const API_TIMEOUT_MS = 30000;

async function callAI(systemPrompt, userContent, apiKey, model, jsonMode = false, temperature = 0) {
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ],
    max_tokens: 4000,
    temperature,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(AI_CONFIG.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(browser.i18n.getMessage('requestTimeout') || 'Request timed out');
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `API error: ${response.status}`);
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from API');
  return content;
}

async function getApiSettings() {
  const settings = await browser.storage.local.get([STORAGE_KEYS.API_KEY, STORAGE_KEYS.MODEL]);
  const apiKey = settings[STORAGE_KEYS.API_KEY];
  const model = settings[STORAGE_KEYS.MODEL] || AI_CONFIG.defaultModel;
  if (!apiKey) { const e = new Error(browser.i18n.getMessage('enterApiKey')); e.code = 'NO_API_KEY'; throw e; }
  return { apiKey, model };
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'log') {
    const fn = message.level === 'warn' ? console.warn : message.level === 'error' ? console.error : console.log;
    fn(...message.args);
    return;
  }

  if (message.action === 'openSidebar') {
    browser.sidebarAction.open().catch(() => {});
    return;
  }

  if (message.action === 'openOptionsPage') {
    browser.runtime.openOptionsPage().catch(() => {});
    return;
  }

  if (message.action === 'translateParagraph') {
    if (typeof message.text !== 'string' || !message.text.trim()) {
      sendResponse({ success: false, error: 'Missing text' });
      return;
    }
    Promise.all([
      getApiSettings(),
      browser.storage.local.get(STORAGE_KEYS.TRANSLATE_LANG)
    ])
      .then(([{ apiKey, model }, { translateLang }]) => {
        const targetLang = TRANSLATE_LANG_NAMES[translateLang] || 'Simplified Chinese';
        return callAI(
          `You are a professional translator. Translate the following text to ${targetLang}. Output only the translation, no explanation.${message.hasLinks ? ' The text contains markers like [LINK0_START]...[LINK0_END] using ASCII square brackets. Preserve these markers character-for-character — do not translate, reformat, or convert the brackets to full-width 【】 or any other style. Only translate the text between them.' : ''}`,
          message.text,
          apiKey,
          model,
          false,
          0.3
        );
      })
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message, code: err.code }));
    return true;
  }

  if (message.action === 'summarize') {
    if (!Array.isArray(message.elements) || message.elements.length === 0) {
      sendResponse({ success: false, error: 'Missing elements' });
      return;
    }
    getApiSettings()
      .then(({ apiKey, model }) => {
        const elementList = message.elements.map((t, i) => `${i}: ${t}`).join('\n');
        const lang = message.pageLanguage || 'English';
        return callAI(
          `I'm on a ${lang} page. Please summarize the selection using precise and concise language. Use headers and bulleted lists in the summary, to make it scannable. Maintain the meaning and factual accuracy. Respond entirely in ${lang}.\n\nOutput format: Return ONLY valid JSON - an object with a "sections" array of 2-5 section objects, each with keys:\n- "title": a short header, max 8 words\n- "items": an array of 2-5 objects with keys "text" (one bullet line, no prefix) and "index" (integer index of the most relevant source element)\n\nIf the elements include bracketed tags (e.g. [story][score=...][comments=...][tags=ai]), use them to group related items into sections. Do not output raw navigation menus or just repeat titles.`,
          `Page elements:\n${elementList}`,
          apiKey,
          model,
          true
        );
      })
      .then(result => {
        let data;
        try { data = JSON.parse(result); } catch (_) { data = {}; }
        const points = Array.isArray(data.sections) ? data.sections : [];
        sendResponse({ success: true, points });
      })
      .catch(err => sendResponse({ success: false, error: err.message, code: err.code }));
    return true;
  }

  if (message.action === 'findInteresting') {
    if (typeof message.interests !== 'string' || !message.interests.trim()) {
      sendResponse({ success: false, error: 'Missing interests' });
      return;
    }
    if (!Array.isArray(message.elements) || message.elements.length === 0) {
      sendResponse({ success: false, error: 'Missing elements' });
      return;
    }
    getApiSettings()
      .then(({ apiKey, model }) => {
        const interests = message.interests.split(',').map(s => s.trim()).filter(Boolean);
        const elementList = message.elements.map((t, i) => `${i}: ${t}`).join('\n');
        const systemPrompt = 'You are a content relevance filter. Given numbered page elements and a single interest topic, return all elements whose subject matter is directly about that topic — not just in the same field, but actually about it.\n\nTreat the interest as an umbrella term: match the topic itself and any well-known variants or subtypes.\n\nReturn ONLY valid JSON: {"matches": [{"index": <integer>, "reason": "<topic>: <why in ≤8 words>"}]}\nIf nothing matches, return {"matches": []}.';
        const calls = interests.map(interest =>
          callAI(
            systemPrompt,
            `Interest: ${interest}\n\nPage elements:\n${elementList}`,
            apiKey,
            model,
            true
          ).then(result => {
            try { return JSON.parse(result).matches || []; } catch (_) { return []; }
          }).catch(() => [])
        );
        return Promise.all(calls);
      })
      .then(resultsPerInterest => {
        const seen = new Set();
        const items = [];
        for (const matches of resultsPerInterest) {
          for (const m of matches) {
            if (typeof m?.index === 'number' && !seen.has(m.index)) {
              seen.add(m.index);
              items.push(m);
            }
          }
        }
        sendResponse({ success: true, items });
      })
      .catch(err => sendResponse({ success: false, error: err.message, code: err.code }));
    return true;
  }
});
