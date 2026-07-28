# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Custom lamp manager (Edit → Manage Custom Lamps): build reusable lamp definitions — IES photometry, spectrum, and product settings — and apply them to placed lamps from the "Select Lamp" dropdown, which lists built-in presets alongside your custom lamps for that lamp type. Definitions can stay with the project or persist in your browser, edits propagate to placed lamps, and loading a .guv file re-links its embedded custom lamps to your library by content instead of duplicating them.
- Warning before leaving the page with unsaved changes
- Calculation zone units and dose time are now editable straight from the Results panel: click the units to swap between µW/cm² and mJ/cm², or click the dose time to type a new duration ("1h 30m", "90m" and "1:30:00" all work)

### Changed
- Dose times now always display hours, minutes and seconds ("8h 0m 0s" rather than "8h")
- Photometry is now supplied by selecting a custom lamp definition. Every lamp type uses the same "Select Lamp" dropdown, and the lamp editor's inline IES/spectrum upload widgets are gone — uploads happen in the lamp manager.
- Zone and lamp IDs are now assigned by the app, and a zone keeps its identity when its type changes — type switches no longer recreate the zone under a new ID

### Fixed
- CADR values in the pathogen efficacy data modal were ~35x too large in feet mode — room volume is now converted to cubic meters before the CADR math
- Edits could be lost, reordered, or corrupted under concurrency. Backend sync now runs through a serialized command queue backed by a per-session lock: rapid edits to the same lamp or zone keep their order and can't race a delete, concurrent requests can't corrupt each other's state, and edits made before session initialization finishes are queued and delivered once it's ready instead of vanishing. Transient "session busy" responses retry automatically; an edit attempted during a running calculation reports "session busy" rather than racing it.
- The 3D scene burned CPU/GPU continuously while idle: label billboards forced a full redraw on every animation frame, and calc plane zones rebuilt their marker mesh (2,500 points per standard zone in a default room) on every store update even in heatmap mode where markers are never drawn. Rendering is now driven by camera and scene changes, and the marker mesh is built only when markers are shown.
- Loading an old .guv file turned preset lamps into custom ones; lamps are now re-linked to the real preset by their saved display name, preserving placement, scaling and enabled state
- Changing a calc zone's type (plane/volume/point) could drop the click or leave the edit unsaved on slower connections
- Grid values (num_x/num_y/num_z and spacings) went stale after changing a calc zone's type
- `ref_surface` (xy/xz/yz) reset to 'xy' when standard zones were refreshed after room changes
- Only the first of multiple custom zones of the same type (e.g. two CalcPlanes) survived session init, due to an ID collision
- Lamp "Show Label" and "Show Photometric Web" toggles reverted when toggled quickly or under load
- New calc zones ignored saved minutes/seconds dose-time preferences — only hours carried over
- All Zod response schemas now pass through unknown keys, preventing silent data loss when the backend returns fields the frontend schema doesn't yet model
- API error responses no longer include internal exception details; validation messages still pass through

## [0.1.3] - 2026-04-08

### Fixed
- Loading .guv files now correctly restores directional/point zones (calc_mode, position, aim point, view_direction, etc. were silently dropped by incomplete Zod validation schema); adds the missing `aim_x`/`aim_y`/`aim_z` fields to `LoadedZoneSchema`

## [0.1.2] - 2026-04-07

No functional changes — version bump only.

## [0.1.1] - 2026-04-07

### Added
- Point-and-click position and aim point picking for lamps (matches calcpoint interface)
- App version displayed in status bar (`illuminate v0.1.x | guv-calcs 0.7.x`)
- Dynamic "How To Cite" citation with guv-calcs version
- Playwright e2e test suite (smoke, room, lamps, zones, calculate, save/load, mobile)
- Version-tagged Docker deployments with rollback support (`bash deploy.sh rollback <version>`)
- Auto-patch-bump on deploy when no release tag exists on HEAD

### Fixed
- IES file validation now accepts older LM-63-1986 format files, files with BOM, and leading blank lines (via guv-calcs bump)
- Calc zone editor no longer closes when switching between zone types (plane/volume/point)
- Value Display label now correctly shows "Fluence Rate" only for actual fluence calculations
- Zone update race condition from mutating `calc_zones` dict during iteration
- Zone update crashes, height tracking, and point calc_mode bugs
- `view_direction` / `view_target` mutual exclusivity conflict
- Point-and-click placement/aiming no longer opens scene objects underneath the click target
- CalcPoint3D marker uses sqrt-based scaling instead of linear, preventing oversized markers in large rooms
- Add missing `aim_x`/`aim_y`/`aim_z` fields to `SessionZoneState` backend schema
- Zone spacing/num_points display now always shows fresh backend values when toggling modes
- IES fixture test path now derived from installed guv_calcs package (portable across environments)
- Remove redundant `tuple()` wrapping for `view_direction`/`view_target` (guv_calcs handles conversion internally)
- Output schemas now use `tuple` for `view_direction`/`view_target` to match guv_calcs types

### Changed
- CI uses `--locked` for reproducible API dependency installs
- File upload tests re-enabled in CI

## [0.1.0] - 2026-03-24

Initial versioned release. Retroactive summary of features present at tagging.

### Added
- Room geometry editor with 2D polygon drawing
- Lamp placement with corner, edge, horizontal, and downlight modes
- Mass lamp operations: batch placement, aiming, and height adjustment
- Calculation volume (CalcVol) 3D visualization with isosurface rendering
- Zone statistics panel with fluence rate plots
- Session persistence via sessionStorage with auto-recovery
- Docker single-image production build
- Security headers middleware (CSP, X-Frame-Options, etc.)

### Dependencies
- guv_calcs == 0.6.5
