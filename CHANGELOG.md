# Changelog

## [1.5] - 2026-03-26

### Added
- **Reader mode** — distraction-free reading overlay powered by Mozilla Readability, with per-page font size, line spacing, width, and theme controls (auto/light/sepia/dark); settings persist across sessions
- **Translate in reader mode** — the translate button works inside the reader overlay, targeting only the article content
- **Reader mode i18n** — all reader UI strings localised across all 13 supported locales

### Fixed
- Floating panel and hide-on-site toggles in the sidebar are now locked while reader mode is active, preventing the panel from being removed while the reader settings trigger is in use
- Settings popup repositions correctly when the sidebar is toggled open or closed
- Scroll position is correctly restored when closing reader mode even when the page was scrolled to the top

### Changed
- Module architecture refactored: `content.js` split into seven focused modules (`content-core`, `content-dom`, `content-translation`, `content-collectors`, `content-panel`, `content-selection`, `content-init`)

## [1.4] - 2026-03-23

### Added
- **Smart selection toolbar on translated paragraphs** — selecting text inside a translated paragraph now shows "↩ Original" (reverts that paragraph) and "Copy + Original" (copies source + selected translation together) instead of the redundant Translate button
- **Copy article to clipboard** — the second button in the floating panel extracts the page article as Markdown and copies it to the clipboard, with loading state while extracting
- **New models** — added gpt-4.1, gpt-4.1-mini, gpt-4.1-nano, o3, and o3-mini to the model selector
- **API timeout** — all OpenAI requests now timeout after 30 seconds instead of hanging indefinitely
- **Sidebar loading timeout** — if an operation takes longer than 45 seconds with no response, the loading spinner auto-clears with an error message

### Fixed
- Toggle buttons (original ↔ translation) on translated paragraphs now use SVG icons instead of text labels, so they fit all UI languages
- Toggle button icon is now correctly centred in the circular button
- Selection toolbar no longer shows Translate button on already-translated text
- Float panel size clamping now uses actual panel dimensions instead of hardcoded 52px
- Resetting all settings now also clears the saved panel position
- "No matches found" message now appears inside the Interests tab instead of the shared global error area
- API key error detection now uses an error code instead of locale-specific string matching, fixing the Settings link not appearing for non-English/Chinese browser locales
- Interest matching prompt tightened to reduce false positives and fabricated reasons
- Disable selection translate when the floating button is globally hidden

## [1.3] - 2026-03-23

### Added
- Text selection translate feature
- Per-domain float button blocking
- Sidebar site toggle

### Fixed
- Keep float button within viewport using ratio-based position storage
- Resolve AMO validation errors and security warnings
- Fix click positioning bug in float panel

### Build
- Add build script to package extension into dist/

### Docs
- Add Firefox AMO store listing document
- Update README to reflect PageGrep rename and new features

## [1.2] - prior

### Added
- i18n support with English fallback
- Draggable float panel
- Dark mode support
- List-page detection and content collection improvements
- Interest finding in sidebar

### Changed
- Rename extension to PageGrep
- Modernize extension interface
- Improve content extraction robustness

### Fixed
- Fix sync bugs
- Fix content scoping, highlight reasons, and HN display labels
- Fix dead `applyThemeToPanel` call and missing `userInterests` in clear
- Prioritize article detection to avoid misidentifying sidebars as lists
