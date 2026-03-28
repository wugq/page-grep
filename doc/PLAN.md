# Remaining Architectural Issues

Issues resolved through code review (2026-03-28). The items below require
broader refactors and are tracked here for future work.

Last audited against code: 2026-03-29.

## Workflow

- Before starting an item, verify the description still matches the code.
- Update this file in the same commit that resolves an item — mark it
  **RESOLVED** with a one-line audit note, or remove it if nothing is left
  to say.
- If a fix changes shape during implementation, update the description before
  merging — don't let the plan drift from reality.

---

## 1. XSS — stored article HTML injected without sanitisation — RESOLVED

**Audit (2026-03-29):** Added `sanitiseArticleDoc(doc)` helper in
`content-reader.js` (near top). It removes `script`/`style` elements, strips
all `on*` event-handler attributes, and removes `javascript:`/`data:`/`vbscript:`
URLs from `href`, `src`, `action`, and `formaction`. All three `replaceChildren`
call sites now call this helper instead of the old inline `script, style` removal.

---

## 2. Event listener leaks — RESOLVED

**Audit (2026-03-29):** All cross-cycle `document`/`window` listeners are
tracked in `cleanupFns` and removed on close. Listeners on overlay-internal
elements are GC'd when the overlay is removed. No action needed.

---

## 3. No message-passing cancellation — RESOLVED

**Audit (2026-03-29):** Added `_pendingRequests` map in `background.js`.
`summarize` and `findInteresting` handlers abort the previous in-flight fetch
when a new request arrives for the same action, track `requestId`, and return
`{ code: 'CANCELLED' }` for superseded requests. `callAI` accepts an optional
`externalSignal` and distinguishes cancellation from timeout in the AbortError
catch. Both content flow functions (`runSummaryFromPage`,
`runInterestingFromPage`) send a `requestId` via `crypto.randomUUID()` and
silently return on `code: 'CANCELLED'`.

---

## 4. Fragmented state management — RESOLVED

**Audit (2026-03-29):** The only real staleness bug was `_readerStates` —
loaded once at reader open and never re-synced. `pageStates` and `savedArticles`
always do a read-modify-write directly from storage so they were never stale.

Added `syncReaderStatesFromStorage(newValue)` in `content-reader.js` (no-op
when reader mode is closed). Wired it into the existing `storage.onChanged`
listener in `content-init.js` for `STORAGE_KEYS.READER_STATES`. Now any write
from another tab propagates into the in-memory mirror before the next
`saveReaderState()` call.

---

## 5. Monolithic modules

**Files:** `content/content-reader.js` (1290 lines),
`sidebar/sidebar.js` (419 lines)

**Fix:** Split each file by concern (see original breakdown in git history).
Do one split per commit for easy bisect.
