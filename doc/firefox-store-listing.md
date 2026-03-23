# Firefox Add-on Store Listing — PageGrep

Reference document for submitting PageGrep to [addons.mozilla.org](https://addons.mozilla.org) (AMO).

---

## Basic Info

| Field | Value |
|-------|-------|
| **Name** | PageGrep |
| **Extension ID** | ai-reader-helper@local *(update to a unique ID before submission, e.g. `pagegrep@yourname`)* |
| **Version** | 1.4 |
| **Category** | Productivity |
| **License** | *(choose before submission, e.g. MIT)* |

---

## Summary

> Max 250 characters. Shown in search results and the AMO listing header.

```
Reading assistant powered by AI. Translate pages or selected text in-place, highlight content matching your interests, and summarize any page — all without leaving your tab.
```

---

## Full Description

> Supports a limited set of Markdown (see AMO docs). Shown on the extension's AMO detail page.

```
PageGrep is a reading assistant that uses the OpenAI API to help you get more out of every web page — in any language.

**Translate in place**
Click the translate button in the floating panel to translate all visible paragraphs directly on the page. Each paragraph gets a hover-revealed toggle so you can switch between the original and translated text at any time. Supports 17+ target languages.

**Smart selection on translated text**
Select text inside a translated paragraph and the toolbar adapts: instead of a redundant Translate button, you get "↩ Original" to revert that paragraph, and "Copy + Original" to copy the source text alongside your selected translation — perfect for note-taking and citation.

**Copy article to clipboard**
A second button in the floating panel extracts the page article as clean Markdown (headings, paragraphs, lists) and copies it to your clipboard in one click.

**Highlight what interests you**
Describe topics you care about — "AI, climate policy, Formula 1" — and PageGrep uses AI to scan the page and highlight the most relevant elements. A sidebar panel shows why each item was matched with a concrete reason.

**Summarize any page**
One click generates a structured summary of the page, grouped into sections with bullet points. Click any item in the summary to scroll directly to that part of the page.

**Translate selected text**
Select any text on a page and a floating toolbar appears above the selection. Click Translate to see the translation in a tooltip — no need to open the panel or leave the page.

**Block the panel on specific sites**
Right-click the floating panel to hide it on the current site, or use the "Hide on this site" toggle in the sidebar. Blocked domains are listed in Settings and can be removed individually.

**Designed to stay out of your way**
The floating action panel is draggable. Drag it anywhere on screen, or drag it to the bottom trash zone to dismiss it on the current site. Your API key and all preferences are stored locally — nothing leaves your browser except the page content you explicitly send to OpenAI.

**Requirements**
An OpenAI API key is required. gpt-4o-mini is recommended — fast, low cost (~$0.15 per million tokens), and accurate enough for everyday reading.

**Supported languages**
Extension UI: English, Chinese (Simplified & Traditional), Japanese, Korean, French, German, Spanish, Italian, Portuguese (Brazil), Russian, Turkish, Vietnamese.
Translation targets: Chinese (Simplified & Traditional), Japanese, Korean, English, French, German, Spanish, Italian, Portuguese, Russian, Arabic, Thai, Vietnamese, Turkish, Polish, Dutch, Indonesian.
```

---

## Privacy Policy

> AMO requires a privacy policy if the extension handles personal data. The API key counts as personal data.

```
PageGrep Privacy Policy

Data stored locally:
- Your OpenAI API key is stored in your browser's local storage (browser.storage.local). It never leaves your device except to authenticate requests sent directly to the OpenAI API.
- Your interest descriptions, UI preferences, and panel position are stored locally in browser.storage.local.

Data sent to third parties:
- When you trigger a full-page translation, highlight, or summarization action, the visible text content of the current page is sent to the OpenAI API (api.openai.com) along with your API key.
- When you trigger a selection translation, only the selected text is sent to the OpenAI API.
- No data is ever sent to the extension developer or any other third party.
- No analytics, crash reporting, or telemetry of any kind is collected.

You can clear all stored data at any time from the Settings page (Clear API Key button).
```

---

## Support / Homepage URLs

| Field | Value |
|-------|-------|
| **Homepage URL** | *(your GitHub repo URL, e.g. https://github.com/yourname/pagegrep)* |
| **Support URL** | *(e.g. https://github.com/yourname/pagegrep/issues)* |
| **Support Email** | *(optional)* |

---

## Tags / Keywords

> Up to 20 tags. Helps with AMO search.

```
translation, translate, AI, OpenAI, reading, highlight, summary, productivity, language, multilingual, reader, GPT
```

---

## Screenshot Descriptions

> AMO requires at least 1 screenshot (min 1000×640px, max 5120×3500px). Suggested shots:

1. **Floating panel + in-place translation** — A foreign-language article with the floating dark panel visible and translated paragraphs shown with toggle buttons.
2. **Interest highlighting** — A news/feed page with several yellow-highlighted items and the sidebar showing match reasons.
3. **Page summary** — The sidebar showing a structured summary with section titles and bullet points.
4. **Settings page** — The options page showing API key field, model selector, language picker, and theme options.

---

## Notes for Submission

- **Extension ID**: Change `ai-reader-helper@local` in `manifest.json` to a production ID before submitting (e.g. `pagegrep@yourname.dev`). AMO will reject `@local` IDs.
- **Source code**: AMO may request source code for review. Since there is no build step, the extension directory itself is the source — submit the same zip used for installation.
- **Permission justification**: The `<all_urls>` permission is required because the content script needs to run on any page the user visits to inject the floating panel and translation UI. Be prepared to justify this in the AMO review notes.
- **`tabs` permission**: Used to get the active tab's URL for messaging between the sidebar and content scripts.
- **Manifest V2**: Firefox continues to support MV2. No changes needed for current AMO submission.
```

---

## Review Notes (for AMO Reviewer)

> Paste this into the "Notes to Reviewer" field during submission.

```
This extension requires an OpenAI API key entered by the user in the Settings page. To test AI features, you will need a valid OpenAI API key.

The <all_urls> permission is required to inject the floating action panel and translation UI into every page the user visits. The content script only activates UI elements — it does not read or transmit page content until the user explicitly clicks a button (Translate, Highlight, or Summarize).

Page content is only sent to api.openai.com when the user triggers an action. The API key is stored in browser.storage.local and is never transmitted anywhere except directly to OpenAI.

There is no build step. The source code submitted is the same as the installable extension.
```
