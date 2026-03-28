# Remaining Architectural Issues

Issues resolved through code review (2026-03-28). The items below require
broader refactors and are tracked here for future work.

---

## 1. XSS — `innerHTML` from API / stored HTML

**Files:** `content/content-translation.js`, `content/content-reader.js`

Translation results and restored article HTML are injected via `innerHTML`
without sanitisation. A compromised API response or tampered stored article
could execute arbitrary JS in the page context.

**Fix:** Add DOMPurify (or a strict allowlist sanitiser) before every
`innerHTML` assignment that receives API-derived or storage-derived content.
Alternatively, restructure the translation restore path to build DOM nodes
directly instead of round-tripping through HTML strings.

---

## 2. Event listener leaks in `content-reader.js`

**File:** `content/content-reader.js`

The `cleanupFns` array tracks some listeners attached during reader-mode
activation, but not all. Listeners left out of `cleanupFns` are never removed
when reader mode closes, accumulating on `document` across open/close cycles.

**Fix:** Audit every `addEventListener` call in the file. Either push a
corresponding `removeEventListener` into `cleanupFns`, or switch to
`AbortController` / `{ signal }` so all listeners in a session are torn down
with a single `controller.abort()` call.

---

## 3. No message-passing cancellation

**Files:** `background/background.js`, `sidebar/sidebar.js`,
`content/content-collectors.js`

AI requests (`summarize`, `findInteresting`, `translateParagraph`) have no
request IDs and no abort mechanism. Rapid button clicks fire duplicate API
calls; closing the sidebar leaves orphaned 30 s fetch requests running to
completion.

**Fix:**
1. Generate a `requestId` (e.g. `crypto.randomUUID()`) in the content/sidebar
   layer and include it in every message.
2. Store a map of `requestId → AbortController` in the background.
3. On new request for the same action, abort the previous controller before
   starting the new one.
4. Discard responses whose `requestId` no longer matches the latest issued ID.

---

## 4. Fragmented state management

**Files:** `content/content-reader.js`, `content/content-init.js`,
`shared/storage-keys.js`

State is split across four independent storage keys (`READER_STATES`,
`PAGE_STATES`, `READER_PREFS`, `SAVED_ARTICLES`), each with its own
serialisation logic. The in-memory mirror `_readerStates` inside
`content-reader.js` can drift from actual storage if a write fails silently or
if a storage-change event fires from another tab.

**Fix:** Introduce a `StorageService` module with typed read/write helpers for
each key, a schema version field for forward-compatibility, and a single
`storage.onChanged` listener that keeps the in-memory mirror in sync.

---

## 5. Monolithic modules

**Files:** `content/content-reader.js` (~1 600 lines),
`sidebar/sidebar.js` (~420 lines)

Each file handles too many concerns, making targeted changes risky and
testing impractical.

**Suggested splits:**

`content-reader.js` →
- `reader-overlay.js` — Shadow DOM setup, button wiring
- `reader-settings.js` — settings panel UI + prefs load/save
- `reader-library.js` — library sidebar, sync bookmark helpers
- `reader-state.js` — scroll position cache, translation state

`sidebar.js` →
- `sidebar-tabs.js` — tab switching
- `sidebar-summary.js` — summary render + hover/click wiring
- `sidebar-highlights.js` — highlights render + hover/click wiring
- `sidebar-settings.js` — float button, hide-on-site, interests, theme

Each split should be done in its own commit so regressions are easy to bisect.
