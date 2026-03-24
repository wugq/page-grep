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

async function callAI(systemPrompt, userContent, apiKey, model, jsonMode = false) {
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ],
    max_tokens: 4000
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
  return data.choices[0].message.content;
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
          model
        );
      })
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message, code: err.code }));
    return true;
  }

  if (message.action === 'summarize') {
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
    getApiSettings()
      .then(({ apiKey, model }) => {
        const elementList = message.elements.map((t, i) => `${i}: ${t}`).join('\n');
        return callAI(
          'You are a strict content relevance filter. Given page elements and user interests, return ONLY elements that directly and specifically match a named interest — not broad industry overlap, not tangential context, not coincidental themes. Rules: (1) The match must be to a specific named item in the user\'s interests — vague connections like "tech context" or "relevant industry" are NOT matches. (2) If you cannot name the specific interest that matches, exclude it. (3) When in doubt, exclude it. (4) Never fabricate a connection. Bad example: user likes "cooking" → an article about restaurant funding matched as "food industry context" — WRONG, no direct connection to cooking. If no elements genuinely match, return {"matches": []}. Return ONLY valid JSON: an object with a "matches" array of objects with keys "index" (integer) and "reason" (one sentence naming the specific interest matched and how, max 15 words).',
          `User interests: ${message.interests}\n\nPage elements:\n${elementList}`,
          apiKey,
          model,
          true
        );
      })
      .then(result => {
        let data;
        try { data = JSON.parse(result); } catch (_) { data = {}; }
        const items = (Array.isArray(data.matches) ? data.matches : [])
          .filter(x => typeof x?.index === 'number');
        sendResponse({ success: true, items });
      })
      .catch(err => sendResponse({ success: false, error: err.message, code: err.code }));
    return true;
  }
});
