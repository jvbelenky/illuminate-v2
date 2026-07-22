# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Shared custom file pool: uploaded IES and spectrum files persist in IndexedDB and are available across all lamps via dropdown menus
- File management modal (Edit > Manage Custom Files) for uploading, renaming, and deleting custom photometric and spectrum files
- Custom IES files appear in the 222nm preset dropdown alongside built-in presets, with "Upload new file..." option
- IES and spectrum file dropdowns for lp_254/other lamp types (replaces raw file input when files exist in the pool)
- Custom files automatically re-upload to backend on session timeout recovery
- Beforeunload warning when project has unsaved changes

### Changed
- Zone and lamp IDs are now assigned by the app, and a zone keeps its identity when its type changes — type switches no longer recreate the zone under a new ID

### Fixed
- The unsaved-changes prompt no longer fires on a plain reload of an untouched page. A fresh project already contains standard calc zones, which the dirty check counted as unsaved work because no "clean" baseline had been recorded yet. A baseline is now captured once the initial session (and the backend's standard-zone refresh) has settled, so the prompt only appears after a genuine edit
- Grid values (num_x/num_y/num_z and spacings) now update correctly after changing a calc zone's type. The recreated zone's backend-computed grid values were written to camelCase keys (`numX`) that don't exist on the zone type, leaving the real `num_x`/`x_spacing` fields stale until the next unrelated sync
- 3D scene no longer re-renders every frame when nothing has changed. The axis-label and lamp-label billboards ran with Threlte's default `autoInvalidate`, which forced a full redraw of the whole scene on every animation frame, forever — burning CPU/GPU continuously even while the app sat idle. Rendering is now driven by camera movement and scene changes
- Calc plane zones no longer rebuild their marker mesh when markers aren't being displayed. The mesh (one `Vector3` + `Matrix4` per grid point, 2,500 points for each of the two standard zones in a default room) was rebuilt on every store update even in heatmap mode where it is never drawn, making room edits sluggish
- Custom IES files now correctly survive save/load cycles — dropdown and upload UI properly restored for custom lamps loaded from .guv files
- All Zod response schemas now `.passthrough()` unknown keys, preventing silent data loss when the backend returns fields the frontend schema doesn't yet model
- Multiple custom zones of the same type (e.g. two CalcPlanes) now all survive session init — previously only the first was kept due to an ID collision bug
- `ref_surface` (xy/xz/yz) no longer reset to 'xy' when standard zones are refreshed after room changes
- CADR values in the pathogen efficacy data modal are no longer ~35x too large in feet mode. Room dimensions are stored in the active display units, but the modal's volume calculation assumed meters, inflating room volume (and every CADR figure derived from it) by the feet→meters factor cubed. Volume is now converted to cubic meters before the CADR math
- Changing a calc zone's type (plane/volume/point) no longer drops the click or leaves the edit unsaved on slower connections. The type is a delete-and-recreate on the backend (the zone returns with a new id, remounting the editor); the selection was held in volatile local state that the remount could discard. It is now derived from store state and applied synchronously, so it survives the remount — and the stray save against the deleted zone (a swallowed 404/400) is gone
- Lamp "Show Label" and "Show Photometric Web" toggles no longer revert when toggled quickly or under load. They were backed by local component state that a background store update could overwrite mid-edit; they now read and write store state directly
- Edits made in the brief window right after a project loads — e.g. room dimensions changed before session initialization finishes — are no longer silently lost. Backend sync functions early-return until the session exists, so such edits reached the UI but never the backend and vanished on save. The session now re-pushes the latest state once init completes, `refreshStandardZones` waits for the session like the other syncs, and loading a file waits for init first
- API error responses no longer include internal exception details; validation messages still pass through
- Concurrent edits to the same session can no longer corrupt each other — mutating requests are serialized per session; edits during a running calculation return a clear "session busy" error instead of racing it

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
