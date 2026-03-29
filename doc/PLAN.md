# Refactor Plan: Namespace Objects + Callback Injection + JSDoc Types

## Goal

Eliminate global scope pollution and implicit cross-module state sharing in content
scripts by introducing a single root namespace (`window.PG`) and wiring cross-module
dependencies explicitly in the bootstrap file via callback injection.
Add JSDoc type definitions so object shapes and function signatures are machine-readable
without a build step.

---

## Phase 0 — JSDoc type definitions (`shared/types.js`)

New file `shared/types.js` — only `@typedef` blocks, no runtime code. Loaded first
so all other scripts can reference the types by name.

```js
// shared/types.js — JSDoc type definitions; no runtime code.

/** @typedef {{ el: Element, text: string }} ElementItem */

/** @typedef {{ points: string[]|null, elements: ElementItem[]|null }} SummaryState */

/** @typedef {{ elements: ElementItem[]|null, items: HighlightItem[]|null }} HighlightState */

/**
 * @typedef {{
 *   url: string, title: string, byline: string, siteName: string,
 *   publishedTime: string, savedAt: number, html: string,
 *   translations: Object<string, string>
 * }} Article
 */

/** @typedef {{ theme: string, width: number, fontSize: number, spacing: number }} ReaderPrefs */

/** @typedef {{ readingIndex: number, translations: Object<string, string>, summary: object }} ReaderUrlState */

/**
 * @typedef {{ text: string, url: string, score: number }} HighlightItem
 */
```

Add `// @ts-check` to each content script file as it is touched in later phases.
No `tsconfig.json` needed — VS Code's TypeScript engine picks up `@typedef`s from
loaded scripts and checks annotated files automatically.

---

## Phase 1 — Message type constants (`shared/message-types.js`)

Smallest change, zero risk, no dependencies. Update all message senders and
receivers to use `MSG.*` constants.

```js
const MSG = Object.freeze({
  TRANSLATE_PARAGRAPH:  'translateParagraph',
  SUMMARIZE:            'summarize',
  FIND_INTERESTING:     'findInteresting',
  SUMMARY_UPDATED:      'summaryUpdated',
  SUMMARY_ERROR:        'summaryError',
  RUN_SUMMARY:          'runSummary',
  RUN_HIGHLIGHT:        'runHighlight',
  HIGHLIGHT_DONE:       'highlightDone',
  HIGHLIGHT_ERROR:      'highlightError',
  READER_MODE_CHANGED:  'readerModeChanged',
  GET_SUMMARY_DATA:     'getSummaryData',
  GET_HIGHLIGHT_DATA:   'getHighlightData',
  GET_READER_MODE_STATE:'getReaderModeState',
  SUMMARY_HOVER:        'summaryHover',
  SUMMARY_UNHOVER:      'summaryUnhover',
  SUMMARY_CLICK:        'summaryClick',
  HIGHLIGHT_HOVER:      'highlightHover',
  HIGHLIGHT_UNHOVER:    'highlightUnhover',
  HIGHLIGHT_CLICK:      'highlightClick',
  OPEN_OPTIONS_PAGE:    'openOptionsPage',
  OPEN_SIDEBAR:         'openSidebar',
  LOG:                  'log',
});
```

---

## Phase 2 — Namespace objects

Mechanical rename, one file at a time. Test after each file.
Order: `content-core` → `content-dom` → `content-translation` →
`content-collectors` → `content-reader-settings` → `content-reader` →
`content-reader-library` → `content-panel` → `content-selection`.

### Flat namespaces (one file → one object)

| Namespace | File |
|-----------|------|
| `PG.core` | `content/content-core.js` |
| `PG.dom` | `content/content-dom.js` |
| `PG.translation` | `content/content-translation.js` |
| `PG.collectors` | `content/content-collectors.js` |
| `PG.panel` | `content/content-panel.js` |
| `PG.selection` | `content/content-selection.js` |

### Reader sub-namespace (tightly coupled cluster)

| Namespace | File |
|-----------|------|
| `PG.reader.overlay` | `content/content-reader.js` |
| `PG.reader.settings` | `content/content-reader-settings.js` |
| `PG.reader.library` | `content/content-reader-library.js` |

The reader files share state and call each other heavily — grouping them under
`PG.reader.*` reflects that. Code outside the cluster only needs `PG.reader.overlay`
(e.g. `PG.reader.overlay.open(btn)`, `PG.reader.overlay.getActiveBody()`).

Private state (`_readerBody`, `_readerStates`, `_articleHtml`, etc.) stays as
local `let` variables in file scope — not exposed on the namespace.

Annotate each namespace's public API with `@param` / `@returns` as it is renamed.
Shared object properties (`SUMMARY_STATE`, `HIGHLIGHT_STATE`) get `@type` annotations
referencing the typedefs from Phase 0:

```js
// content-core.js
/** @type {SummaryState} */
const SUMMARY_STATE = { points: null, elements: null };

/** @type {HighlightState} */
const HIGHLIGHT_STATE = { elements: null, items: null };
```

---

## Phase 3 — Callback injection (`content-init.js`)

Replace implicit cross-module dependencies with explicit callback injection wired
in `content-init.js`. Each module declares an `init` function that receives only
the callbacks it needs. All wiring lives in one place — a new reader can understand
the full dependency graph by reading `content-init.js` top to bottom.

### Cross-module dependencies to wire

| Module | Needs | Replaces |
|--------|-------|---------|
| `PG.collectors` | `getReaderBody` | bare `getActiveReaderBody()` call |
| `PG.core` | `onThemeChange` callback | `_themeChangeHooks` ad-hoc registry |

`PG.reader.overlay.syncReaderStatesFromStorage` is called directly from
`content-init.js`'s storage change listener — no injection needed. `content-init.js`
is the wiring file and is already allowed to name any module explicitly. Injecting
a function back into the module that owns it would add indirection without decoupling.

### Pattern

Each module exposes an `init` function that stores the injected callbacks in
module-local variables:

```js
// content-collectors.js
let _getReaderBody = () => null;

function init({ getReaderBody }) {
  _getReaderBody = getReaderBody;
}
```

```js
// content-init.js — all wiring in one place
PG.collectors.init({ getReaderBody: PG.reader.overlay.getActiveBody });
PG.core.init({ onThemeChange: PG.reader.settings.applyTheme });
// storage change handler calls PG.reader.overlay.syncReaderStatesFromStorage directly
```

### Why callback injection over an event bus

An event bus decouples emitters from listeners but hides the flow — tracing what
happens after an event requires finding all registered listeners across files.
Callback injection gives the same decoupling: `content-collectors.js` does not
name `content-reader.js` anywhere. The difference is that all wiring is visible
in `content-init.js` as plain function arguments, readable without any new
abstraction to learn. The pattern fits this codebase because all cross-module
relationships are one-to-one; a bus adds value when multiple listeners share
one event, which is not the case here.

---

## Execution Order

1. **Phase 0 — JSDoc types** (`shared/types.js`)
   Zero runtime impact. Add `// @ts-check` to each file as it is touched.

2. **Phase 1 — Message constants** (`shared/message-types.js`)
   Zero risk, no dependencies.

3. **Phase 2 — Namespace objects**
   Mechanical rename, one file at a time. Annotate public API surface with
   `@param` / `@returns` / `@type` as each file is done.

4. **Phase 3 — Callback injection**
   Add `init` functions to modules with cross-module dependencies. Wire all
   callbacks in `content-init.js`. Remove `_themeChangeHooks` from `content-core.js`.

---

## What Does Not Change

- Load order in `manifest.json` remains the dependency contract (no bundler)
- `browser.runtime.sendMessage` / `browser.tabs.sendMessage` flows are unchanged
- No classes introduced
- No build step required
