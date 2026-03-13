# AI Reader Helper

A Firefox extension that helps you read foreign-language web pages. It translates content in-place and highlights elements that match your personal interests — both powered by OpenAI.

## Features

- **In-place translation** — translates visible paragraphs on screen without leaving the page. Each element gets a toggle button to switch between the original and translated text.
- **Interest highlighting** — describe topics you care about (e.g. "AI, macroeconomics, sports"), and the extension uses AI to find and highlight matching content on any page in yellow.
- **Highlight navigation** — after highlighting, use ▲ / ▼ buttons to scroll through matches one by one with a smooth animation.

## Installation

### Firefox Developer Edition / Nightly (simplest)

Regular Firefox requires extensions to be signed by Mozilla. Developer Edition and Nightly can bypass this:

1. Install [Firefox Developer Edition](https://www.mozilla.org/firefox/developer/) or Firefox Nightly
2. Open `about:config` and set `xpinstall.signatures.required` to `false`
3. Package the extension:
   ```bash
   zip -r reader.xpi . -x "*.git*" -x "*.DS_Store" -x "web-ext-artifacts/*"
   ```
4. Open `about:addons` → gear icon → **Install Add-on From File** → select `reader.xpi`

### Firefox (regular, permanently signed)

1. Create an account at [addons.mozilla.org](https://addons.mozilla.org)
2. Get API credentials from [addons.mozilla.org/developers/addon/api/key/](https://addons.mozilla.org/developers/addon/api/key/)
3. Install `web-ext`:
   ```bash
   npm install -g web-ext
   ```
4. Sign the extension (self-distributed — stays private, not listed publicly):
   ```bash
   web-ext sign --api-key=YOUR_KEY --api-secret=YOUR_SECRET
   ```
5. A signed `.xpi` is generated in `web-ext-artifacts/`
6. Open `about:addons` → gear icon → **Install Add-on From File** → select the `.xpi`

> **Chrome:** This extension uses Firefox's native `browser.*` API. Running it in Chrome requires the [webextension-polyfill](https://github.com/mozilla/webextension-polyfill).

## Setup

1. Click the extension icon in the toolbar
2. Click **设置** (Settings) at the bottom
3. Enter your [OpenAI API key](https://platform.openai.com/api-keys)
4. Choose a model — `gpt-4o-mini` is recommended for everyday use (low cost, fast)

## Usage

### Floating Panel

A compact dark panel appears in the bottom-right corner of every page (when enabled). It contains:

| Button | Action |
|--------|--------|
| `译` | Translate all visible paragraphs on screen |
| `★` | Highlight content matching your interests |
| `▲` / `▼` | Navigate to previous / next highlight (appears after highlighting) |
| `×` | Dismiss the panel (hover to reveal, top-right corner) |

The panel can be toggled on/off from the popup via the **显示悬浮按钮** checkbox.

### Translate

1. Navigate to any page with foreign-language content
2. Click **译** in the floating panel
3. Visible paragraphs are translated in-place — each gets a small toggle button (`原`/`译`) to switch between the original and translated text

### Interest Highlighting

1. Click the extension icon
2. In the **阅读兴趣** section, describe what you're interested in (e.g. `AI科技、宏观经济、体育赛事`)
3. Click **保存**
4. On any page, click **★** in the floating panel
5. The extension sends page elements to OpenAI, which identifies relevant ones — they are highlighted in yellow
6. Use **▲** / **▼** to jump between matches
7. Click **★** again to clear all highlights

## Project Structure

```
reader/
├── manifest.json          # Extension manifest (MV2)
├── background/
│   └── background.js      # OpenAI API calls (translate, interest matching)
├── content/
│   └── content.js         # Floating panel, in-place translation, highlighting
├── popup/
│   ├── popup.html
│   ├── popup.js           # Panel toggle, interest input
│   └── popup.css
├── options/
│   ├── options.html
│   ├── options.js         # API key and model settings
│   └── options.css
└── icons/
    ├── icon-48.svg
    └── icon-96.svg
```

## Privacy

Your API key is stored locally in the browser (`browser.storage.local`) and is never sent anywhere except directly to the OpenAI API. Page content is only sent to OpenAI when you explicitly trigger a translation or highlight action.
