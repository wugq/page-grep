# PageGrep — AI Context

Firefox extension (MV2). Puts a floating panel on every page with translate,
reader mode, and article-copy buttons. Sidebar shows summary and interest
highlights. All AI calls go to the OpenAI API via the background script.

See `doc/ARCHITECTURE.md` for dependency rules and patterns.
See `doc/PLAN.md` for the open issue backlog.

---

## Module map

Content scripts share a global scope — load order in `manifest.json` is the dependency contract.

| File | Responsibility |
|------|----------------|
| `shared/storage-keys.js` | `STORAGE_KEYS` constants, sync bookmark helpers |
| `shared/theme-utils.js` | `isThemeDark()` helper |
| `shared/i18n-override.js` | Applies `uiLang` storage override |
| `vendor/Readability.js` | Mozilla Readability — do not modify |
| `content/content-core.js` | Logging, global constants, shared state, panel shadow-DOM helpers, toast, clipboard |
| `content/content-dom.js` | Content-scope detection, article extraction, visible-paragraph scan |
| `content/content-translation.js` | In-place translation, wrap/restore helpers |
| `content/content-collectors.js` | Element collection, summary and highlight AI flows, hover/flash |
| `content/content-reader-settings.js` | Reader prefs constants/helpers, `readerGetById`, settings panel UI |
| `content/content-reader.js` | Reader overlay open/close lifecycle, scroll tracking, translation persistence |
| `content/content-reader-library.js` | Article save/unsave, bookmark sync, library panel UI |
| `content/content-panel.js` | Floating panel, drag-and-drop, context menu, article-to-clipboard |
| `content/content-selection.js` | Text-selection popup toolbar |
| `content/content-init.js` | Bootstrap: storage init, message listener, storage-change listener |
| `background/background.js` | OpenAI API gateway — translate, summarize, highlight |
| `sidebar/sidebar.js` | Sidebar UI: summary, highlights, interests, settings |
| `options/options.js` | Settings page: API key, model, language, blocked domains |

---

## Message passing

### Content → Background (`browser.runtime.sendMessage`)
- `translateParagraph` `{ text, hasLinks }` → `{ success, result }`
- `summarize` `{ elements[], pageLanguage }` → `{ success, points[] }`
- `findInteresting` `{ interests, elements[] }` → `{ success, items[] }`
- `openOptionsPage`, `log`

### Sidebar → Content (`browser.tabs.sendMessage`)
- `runSummary` / `runHighlight` — trigger AI flow
- `getSummaryData` / `getHighlightData` / `getReaderModeState` — poll state
- `summaryHover/Unhover/Click` / `highlightHover/Unhover/Click`

### Content → Sidebar (`browser.runtime.sendMessage`)
- `summaryUpdated` `{ points[] }`, `summaryError` `{ error, code }`
- `highlightDone` `{ items[] }`, `highlightError`
- `readerModeChanged` `{ active }`

---

## Storage schema (`browser.storage.local` unless noted)

| Key | Shape | Notes |
|-----|-------|-------|
| `openaiApiKey` | `string` | Required for all AI features |
| `preferredModel` | `string` | Default `gpt-4o-mini` |
| `theme` | `'light' \| 'dark'` | |
| `translateLang` | `string` | BCP-47 code e.g. `'zh-CN'` |
| `showFloatBtn` | `boolean` | Global panel toggle |
| `blockedDomains` | `string[]` | Per-domain panel suppression |
| `panelPosition` | `{ x, y }` | Float panel position |
| `userInterests` | `string` | Comma-separated topics |
| `uiLang` | `string` | Override UI locale |
| `readerPrefs` | `{ theme, width, fontSize, spacing }` | |
| `readerStates` | `{ [url]: { readingIndex, translations, summary } }` | Capped at 50 entries |
| `pageStates` | `{ [url]: { summary } }` | Page-mode summary cache |
| `savedArticles` | `Article[]` | Max 20; `{ url, title, byline, siteName, publishedTime, savedAt, html, translations }` |
| `bm_<hash>` (sync) | `{ url, title, ... }` | Sync bookmark; promoted to full local article on next reader open |

---

## Conventions

- **Comments** — names and structure should be self-explanatory. Do not write
  *what* comments (they restate the code). Only write *why* comments when the
  reason behind a decision is not obvious from the code itself — e.g. a
  constraint, a tradeoff, or a gotcha that would surprise a future reader.
- **Small units** — functions do one thing; files have one concern. If a
  function needs a comment to explain what it does, it should be split or
  renamed. Long files are a sign of mixed concerns, not maturity.
- **No speculative abstractions** — do not create helpers, wrappers, or
  utilities for one-time use. Do not design for hypothetical future
  requirements. Add abstraction when the duplication actually exists.
- **Validate at boundaries only** — do not add null checks, try/catch, or
  fallbacks for internal code paths that cannot fail. Trust function
  contracts and framework guarantees. Validate at real boundaries: user
  input, API responses, and storage reads.

---

## Key invariants

- **Shadow DOM isolation** — panel and reader overlay use `attachShadow`. CSS is injected as `<style>` text (fetched at script load); `<link>` does not work in content-script shadow roots.
- **Cleanup on reader close** — any `document`/`window` listener added during reader open must be pushed into `cleanupFns` and will be flushed by `closeReaderMode()`.
- **Blocked-domains mutex** — serialise concurrent writes via the `_blockedDomainsMutex` promise chain; capture toggle state synchronously before any `await`.
- **Reader-mode button lock** — the reader button is repurposed as a settings trigger while reader mode is active. Always check `getActiveReaderBody()` before removing the panel.
