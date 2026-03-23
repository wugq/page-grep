const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

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

async function callOpenAI(systemPrompt, userContent, apiKey, model, jsonMode = false) {
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ],
    max_tokens: 4000
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
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
  const model = settings[STORAGE_KEYS.MODEL] || 'gpt-4o-mini';
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
        return callOpenAI(
          `You are a professional translator. Translate the following text to ${targetLang}. Output only the translation, no explanation.`,
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
        return callOpenAI(
          `I'm on a ${lang} page. Please summarize the selection using precise and concise language. Use headers and bulleted lists in the summary, to make it scannable. Maintain the meaning and factual accuracy. Respond entirely in ${lang}.\n\nOutput format: Return ONLY valid JSON - an object with a "sections" array of 2-5 section objects, each with keys:\n- "title": a short header, max 8 words\n- "items": an array of 2-5 objects with keys "text" (one bullet line, no prefix) and "index" (integer index of the most relevant source element)\n\nIf the elements include bracketed tags (e.g. [story][score=...][comments=...][tags=ai]), use them to group related items into sections. Do not output raw navigation menus or just repeat titles.`,
          `Page elements:\n${elementList}`,
          apiKey,
          model,
          true
        );
      })
      .then(result => {
        const data = JSON.parse(result);
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
        return callOpenAI(
          'You are a strict content relevance filter. Given page elements and user interests, return ONLY elements with a clear, direct, specific match — not tangential or coincidental overlap. Apply a HIGH confidence threshold: when in doubt, exclude it. Never fabricate a connection. If no elements genuinely match, return {"matches": []}. Return ONLY valid JSON: an object with a "matches" array of objects with keys "index" (integer) and "reason" (one short sentence, max 12 words, stating the concrete, specific reason it matches the interests).',
          `User interests: ${message.interests}\n\nPage elements:\n${elementList}`,
          apiKey,
          model,
          true
        );
      })
      .then(result => {
        const data = JSON.parse(result);
        const items = (Array.isArray(data.matches) ? data.matches : [])
          .filter(x => typeof x?.index === 'number');
        sendResponse({ success: true, items });
      })
      .catch(err => sendResponse({ success: false, error: err.message, code: err.code }));
    return true;
  }
});
