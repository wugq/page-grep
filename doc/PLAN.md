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

## 1. XSS — stored article HTML injected without sanitisation

**Files:** `content/content-reader.js`

Translation results from the API are already safe — `appendSavedTranslationContent()`
builds DOM nodes manually without touching `innerHTML`.

The real vector is stored article HTML restored from `browser.storage`. Three
call sites parse it with `DOMParser` and insert nodes via `replaceChildren`:

- `content-reader.js:1021–1023` — live article on reader open
- `content-reader.js:694–696` — saved library article loaded into reader
- `content-reader.js:748–750` — live article restored after browsing library

Each site strips `<script>` and `<style>`, but event handler attributes
(`onclick`, `onerror`, etc.) and `javascript:` hrefs survive.

**Fix:** Run the `DOMParser` output through DOMPurify (or a strict allowlist
sanitiser) before `replaceChildren` at the three sites above.

---

## 2. Event listener leaks — RESOLVED

**Audit (2026-03-29):** All cross-cycle `document`/`window` listeners are
tracked in `cleanupFns` and removed on close. Listeners on overlay-internal
elements are GC'd when the overlay is removed. No action needed.

---

## 3. No message-passing cancellation

**Files:** `background/background.js`, `sidebar/sidebar.js`,
`content/content-collectors.js`

AI requests have no request IDs and no abort mechanism. Rapid clicks fire
duplicate API calls; closing the sidebar leaves orphaned 30 s fetches running.

**Fix:**
1. Generate a `requestId` (`crypto.randomUUID()`) per request, include it in
   the message.
2. Store `requestId → AbortController` in background; abort previous on new
   request for the same action.
3. Discard responses whose `requestId` no longer matches the latest issued ID.

---

## 4. Fragmented state management

**Files:** `content/content-reader.js`, `content/content-init.js`,
`shared/storage-keys.js`

State spans four storage keys with separate serialisation logic. `_readerStates`
is loaded once at reader open and never re-synced — writes from another tab
drift silently.

**Fix:** Introduce a `StorageService` module with typed helpers per key, a
schema version field, and a single `storage.onChanged` listener to keep the
in-memory mirror in sync.

---

## 5. Monolithic modules

**Files:** `content/content-reader.js` (1290 lines),
`sidebar/sidebar.js` (419 lines)

**Fix:** Split each file by concern (see original breakdown in git history).
Do one split per commit for easy bisect.
