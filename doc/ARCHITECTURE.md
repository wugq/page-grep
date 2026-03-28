# Architecture

## C4 — Level 1: System Context

```
┌─────────┐     interacts      ┌──────────────────────────────┐
│  User   │ ────────────────►  │         PageGrep             │
└─────────┘                    │   (Firefox extension)        │
                               └──────────────┬───────────────┘
                                              │ HTTPS / OpenAI API
                                              ▼
                               ┌──────────────────────────────┐
                               │        OpenAI API            │
                               └──────────────────────────────┘
```

PageGrep runs entirely inside the browser. The only external dependency is the
OpenAI API, called exclusively from the background script using the user's own
API key. No data is sent anywhere else.

---

## C4 — Level 2: Containers

```
  Browser
  ┌─────────────────────────────────────────────────────────────┐
  │                                                             │
  │  ┌──────────────┐   runtime messages   ┌────────────────┐  │
  │  │  Background  │ ◄──────────────────► │    Sidebar     │  │
  │  │  (bg page)   │                      │   (sidebar.js) │  │
  │  └──────┬───────┘                      └────────────────┘  │
  │         │ runtime messages                    ▲             │
  │         │                              tab messages         │
  │         ▼                                     │             │
  │  ┌──────────────────────────────────────────────────────┐  │
  │  │              Content Scripts                         │  │
  │  │         (injected into every web page)               │  │
  │  └──────────────────────────────────────────────────────┘  │
  │                                                             │
  │  ┌──────────────┐                                          │
  │  │   Options    │  (isolated page, no runtime messages)    │
  │  └──────────────┘                                          │
  └─────────────────────────────────────────────────────────────┘
```

| Container | Role | Persists? |
|-----------|------|-----------|
| Background | AI API gateway; no DOM access | Non-persistent (event page) |
| Content scripts | All page interaction; panel, reader, translation | Per tab, per navigation |
| Sidebar | Summary + highlights display; user settings | Lives for browser session |
| Options | API key, model, language config | Opened on demand |

**Communication rules:**
- Content ↔ Background: `browser.runtime.sendMessage` (request/response)
- Sidebar ↔ Content: `browser.tabs.sendMessage` (sidebar initiates; content pushes updates back via `runtime.sendMessage`)
- Background never initiates messages to content or sidebar
- Options reads/writes `browser.storage.local` directly; no message passing

---

## Dependency Rules

1. **Content scripts flow down only.** Modules share a global scope (no ES modules in MV2 content scripts); load order in `manifest.json` is the dependency contract. A module may only use symbols defined by earlier modules.
2. **Background is an API gateway only.** It holds no UI state and sends no unsolicited messages. Content and sidebar call it; it responds.
3. **Sidebar and content are peers.** Neither calls the other directly. All cross-context state goes through `browser.storage` or message passing.
4. **Shared modules are dependency-free.** Files under `shared/` may not reference content, background, sidebar, or options.

---

## Project-Specific Exceptions

- **No ES modules in content scripts.** Firefox MV2 content scripts run in a
  shared global scope. Use the load-order contract instead of `import/export`.
- **Shadow DOM for all injected UI.** The floating panel and reader overlay
  use `attachShadow` to prevent page CSS from leaking in. CSS is fetched as
  text at script load and injected as `<style>` — `<link>` does not work in
  shadow roots from content scripts.

---

## Patterns in Use

- **cleanupFns** — any `document` or `window` listener added during reader
  open must push its removal function into `cleanupFns`. Flushed on close.
- **Promise mutex** — concurrent read-modify-write on `blockedDomains` is
  serialised via a chained promise (`_blockedDomainsMutex`). Use the same
  pattern for any storage key that multiple events can write simultaneously.
- **In-memory mirror + storage write** — `_readerStates` is loaded once and
  kept in memory; writes go to both the mirror and storage. Do not re-read
  storage on every update inside a single reader session.
