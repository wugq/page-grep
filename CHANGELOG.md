# Changelog

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
