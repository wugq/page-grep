const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

browser.browserAction.onClicked.addListener(() => {
  browser.sidebarAction.toggle();
});


async function callOpenAI(systemPrompt, userContent, apiKey, model) {
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      max_tokens: 4000
    })
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `API error: ${response.status}`);
  }
  const data = await response.json();
  return data.choices[0].message.content;
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

  if (message.action === 'translateParagraph') {
    callOpenAI(
      'You are a professional translator. Translate the following text to Simplified Chinese. Output only the translation, no explanation.',
      message.text,
      message.apiKey,
      message.model
    )
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'summarize') {
    const elementList = message.elements.map((t, i) => `${i}: ${t}`).join('\n');
    const lang = message.pageLanguage || 'English';
    callOpenAI(
      `I'm on a ${lang} page. Please summarize the selection using precise and concise language. Use headers and bulleted lists in the summary, to make it scannable. Maintain the meaning and factual accuracy. Respond entirely in ${lang}.\n\nOutput format: Return ONLY valid JSON - an array of 2-5 section objects with keys:\n- "title": a short header, max 8 words\n- "items": an array of 2-5 objects with keys "text" (one bullet line, no prefix) and "index" (integer index of the most relevant source element)\n\nIf the elements include bracketed tags (e.g. [story][score=...][comments=...][tags=ai]), use them to group related items into sections. Do not output raw navigation menus or just repeat titles. No markdown fences, no explanation.`,
      `Page elements:\n${elementList}`,
      message.apiKey,
      message.model
    )
      .then(result => {
        try {
          const match = result.trim().match(/\[[\s\S]*\]/);
          const points = match ? JSON.parse(match[0]) : [];
          sendResponse({ success: true, points });
        } catch (e) {
          sendResponse({ success: false, error: 'JSON 解析失败: ' + result });
        }
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'findInteresting') {
    const elementList = message.elements.map((t, i) => `${i}: ${t}`).join('\n');
    callOpenAI(
      'You are a content relevance analyzer. Given a list of page elements and user interests, identify which elements are relevant. Return ONLY a valid JSON array of objects with keys "index" (integer) and "reason" (one short sentence, max 12 words, explaining why it matches the user\'s interests). Example: [{"index":0,"reason":"Covers AI model benchmarks you follow"},{"index":3,"reason":"Discusses startup funding trends"}]. If nothing matches, return [].',
      `User interests: ${message.interests}\n\nPage elements:\n${elementList}`,
      message.apiKey,
      message.model
    )
      .then(result => {
        const trimmed = result.trim();
        try {
          const match = trimmed.match(/\[[\s\S]*\]/);
          const parsed = match ? JSON.parse(match[0]) : [];
          const items = parsed.filter(x => typeof x?.index === 'number');
          sendResponse({ success: true, items });
        } catch (e) {
          sendResponse({ success: false, error: 'JSON 解析失败: ' + result });
        }
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});
