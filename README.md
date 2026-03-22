# PageGrep

[![Firefox Add-on](https://img.shields.io/badge/Firefox-Add--on-orange)](https://addons.mozilla.org/en-US/firefox/addon/pagegrep/)

A Firefox extension that helps you read and discover content on web pages using AI. It translates content in-place, highlights elements matching your personal interests, and summarizes pages — all powered by OpenAI.

## Features

- **In-place translation** — translates visible paragraphs on screen without leaving the page. Each element gets a toggle button to switch between the original and translated text.
- **Interest highlighting** — describe topics you care about (e.g. "AI, macroeconomics, sports"), and the extension uses AI to find and highlight matching content on any page in yellow.
- **Highlight navigation** — after highlighting, use ▲ / ▼ buttons to scroll through matches one by one with a smooth animation.
- **Page summarization** — generates an AI-powered summary of the page, grouped into sections with bullet points, shown in the sidebar.
- **Text selection translate** — select any text on a page to get a floating "Translate" pill button; clicking it translates the selection and shows the result in a popup tooltip.
- **Draggable floating panel** — a compact dark panel in the bottom-right corner. Drag it to reposition; drag it to the trash zone at the bottom to dismiss.
- **Per-domain blocking** — right-click the floating panel to hide it on the current site. A "Hide on this site" toggle in the sidebar also reflects and controls this state. Blocked domains are managed in Settings.
- **Dark mode** — full dark/light/system theme support across all extension UI.
- **Internationalization** — UI available in 13 languages: English, Chinese (Simplified & Traditional), Japanese, Korean, French, German, Spanish, Italian, Portuguese (Brazil), Russian, Turkish, and Vietnamese.

## Installation

### Firefox Developer Edition / Nightly (simplest)

Regular Firefox requires extensions to be signed by Mozilla. Developer Edition and Nightly can bypass this:

1. Install [Firefox Developer Edition](https://www.mozilla.org/firefox/developer/) or Firefox Nightly
2. Open `about:config` and set `xpinstall.signatures.required` to `false`
3. Package the extension:
   ```bash
   zip -r pagegrep.xpi . -x "*.git*" -x "*.DS_Store" -x "web-ext-artifacts/*"
   ```
4. Open `about:addons` → gear icon → **Install Add-on From File** → select `pagegrep.xpi`

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

1. Click the extension icon in the toolbar to open the sidebar
2. Click the **Settings** (⚙) button
3. Enter your [OpenAI API key](https://platform.openai.com/api-keys)
4. Choose a model — `gpt-4o-mini` is recommended for everyday use (low cost, fast)
5. Select your target translation language
6. Click **Save**

## Usage

### Floating Panel

A compact dark panel appears in the bottom-right corner of every page (when enabled). It contains:

| Button | Action |
|--------|--------|
| `译` | Translate all visible paragraphs on screen |
| `★` | Highlight content matching your interests |
| `▲` / `▼` | Navigate to previous / next highlight (appears after highlighting) |
| `×` | Dismiss the panel |

The panel is draggable — click and drag to reposition it. Drag it toward the bottom of the screen to reveal a trash zone; release there to dismiss it. Position is remembered across page loads.

The panel is toggled on/off globally via **Show Floating Button** in Settings. To hide it on a specific site, right-click the panel and choose **Hide on this site**, or use the **Hide on this site** toggle in the sidebar.

### Translate

**Full-page translation:**
1. Navigate to any page with content you want to translate
2. Click **译** in the floating panel
3. Visible paragraphs are translated in-place — each gets a small toggle button to switch between the original and translated text

**Selection translation:**
1. Select any text on a page
2. A floating **Translate** pill appears above the selection
3. Click it to see the translation in a popup tooltip; click anywhere else to dismiss

### Interest Highlighting

1. Click the extension icon to open the sidebar
2. In the **Interests** tab, describe what you're interested in (e.g. `AI technology, macroeconomics, sports`)
3. Click **Save**
4. On any page, click **★** in the floating panel
5. The extension sends page elements to OpenAI, which identifies relevant ones — they are highlighted in yellow, with reasons shown in the sidebar
6. Use **▲** / **▼** to jump between matches
7. Click **★** again to clear all highlights

### Page Summarization

1. Click the extension icon to open the sidebar
2. Click **Generate Summary**
3. The page content is summarized into 2–5 sections with titles and bullet points
4. Click any item in the summary to scroll to the corresponding section on the page

## Project Structure

```
reader/
├── manifest.json          # Extension manifest (MV2)
├── background/
│   └── background.js      # OpenAI API calls (translate, summarize, highlight)
├── content/
│   └── content.js         # Floating panel, in-place translation, highlighting
├── sidebar/
│   ├── sidebar.html
│   ├── sidebar.js         # Sidebar UI: summary, interests, settings link
│   └── sidebar.css
├── options/
│   ├── options.html
│   ├── options.js         # API key, model, language, theme settings
│   └── options.css
├── shared/
│   ├── storage-keys.js    # Shared storage key constants
│   ├── i18n.js            # i18n initialization
│   └── theme.js           # Dark/light theme management
├── _locales/              # Translations for 13 languages
│   ├── en/messages.json
│   ├── zh_CN/messages.json
│   └── ...
└── icons/
    ├── icon-16.svg
    ├── icon-48.svg
    ├── icon-96.svg
    └── icon-128.svg
```

## Configuration

All settings are stored locally in `browser.storage.local`:

| Setting | Description | Default |
|---------|-------------|---------|
| OpenAI API Key | Required for all AI features | — |
| Model | `gpt-4o-mini` or `gpt-4o` | `gpt-4o-mini` |
| Translation Language | Target language for translation | Chinese (Simplified) |
| Theme | Light, dark, or follow system | System |
| Show Floating Button | Show/hide the floating panel globally | Enabled |
| Blocked Domains | Per-domain list to hide the float button; managed via right-click or sidebar toggle | — |
| UI Language | Override the extension UI language | Browser default |

## Privacy

Your API key is stored locally in the browser (`browser.storage.local`) and is never sent anywhere except directly to the OpenAI API. Page content is only sent to OpenAI when you explicitly trigger a translation, highlighting, or summarization action. There is no analytics, tracking, or telemetry.
