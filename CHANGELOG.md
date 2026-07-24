# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Custom lamp manager (Edit > Manage Custom Lamps): create reusable, self-contained lamp definitions (IES + spectrum + product fields) and apply them to placed lamps via a type-filtered "Select Lamp" dropdown that lists built-in presets and matching custom lamps, plus an "Add custom lamp..." entry that opens the manager pre-filled for the current lamp type without disturbing the lamp, and auto-applies the new definition to the launching lamp once you save it
- Custom lamp definitions automatically re-upload to the backend on session timeout recovery
- Loading a .guv file re-links embedded custom lamps to your library by content hash and adds unmatched ones as project-scoped definitions, with a passive notice
- Beforeunload warning when project has unsaved changes

### Changed
- The lamp editor no longer has inline IES/spectrum file-upload widgets or a column picker; every lamp type now uses the same "Select Lamp" dropdown, and photometry is supplied by choosing a custom lamp definition (uploads happen in the lamp manager)
- Custom lamps are now managed as complete lamp definitions (photometry + spectrum + product settings) in Edit → Manage Custom Lamps, replacing raw file management. Lamp dropdowns list your custom lamps per lamp type, "Add custom lamp..." opens the manager, and the inline file-upload widgets are gone. Definitions can live in this project only or persist in your browser, edits propagate to placed lamps, and loading a .guv file re-links embedded custom lamps to your library by content instead of duplicating them.
- Zone and lamp IDs are now assigned by the app, and a zone keeps its identity when its type changes — type switches no longer recreate the zone under a new ID

### Fixed
- The "Select Lamp" dropdown now visually returns to the previously-selected lamp after you pick "Add custom lamp..." instead of getting stuck showing "Add custom lamp...". Restoring the selection synchronously left the bound value net-unchanged within the same Svelte flush, so the DOM was never rewritten; the restore is now deferred one tick so it lands as a real change
- `GET /session/lamps/{lamp_id}/files` no longer 500s for lamps with spectrum data. The handler built the response's `spectrum` field from comma-joined strings instead of the string-array lists the schema declares, so any spectrum-bearing lamp failed Pydantic validation — silently breaking custom-lamp re-linking by content hash on `.guv` load
- Standard-zone plane heatmaps (Skin/Eye dose) are no longer mirrored along their Y axis in the 3D scene — the bright region now sits under the lamps, matching the 2D "Show Plot" view. `GET /session/zones` doesn't compute `v_positive_direction`, so it arrived as `null`; the store passed that `null` through un-normalized (unlike every other zone path), and the 3D guard `!== undefined` let `null` slip past into `!null === true`, forcing an erroneous flip. Custom-created zones were unaffected because they entered the store through a path that normalizes `null` to `undefined`
- New calc zones now honor the saved minutes/seconds dose-time preferences — previously only hours carried over and minutes/seconds silently reset to 0
- The unsaved-changes prompt no longer fires on a plain reload of an untouched page. A fresh project already contains standard calc zones, which the dirty check counted as unsaved work because no "clean" baseline had been recorded yet. A baseline is now captured once the initial session (and the backend's standard-zone refresh) has settled, so the prompt only appears after a genuine edit
- Grid values (num_x/num_y/num_z and spacings) now update correctly after changing a calc zone's type. The recreated zone's backend-computed grid values were written to camelCase keys (`numX`) that don't exist on the zone type, leaving the real `num_x`/`x_spacing` fields stale until the next unrelated sync
- 3D scene no longer re-renders every frame when nothing has changed. The axis-label and lamp-label billboards ran with Threlte's default `autoInvalidate`, which forced a full redraw of the whole scene on every animation frame, forever — burning CPU/GPU continuously even while the app sat idle. Rendering is now driven by camera movement and scene changes
- Calc plane zones no longer rebuild their marker mesh when markers aren't being displayed. The mesh (one `Vector3` + `Matrix4` per grid point, 2,500 points for each of the two standard zones in a default room) was rebuilt on every store update even in heatmap mode where it is never drawn, making room edits sluggish
- All Zod response schemas now `.passthrough()` unknown keys, preventing silent data loss when the backend returns fields the frontend schema doesn't yet model
- Multiple custom zones of the same type (e.g. two CalcPlanes) now all survive session init — previously only the first was kept due to an ID collision bug
- `ref_surface` (xy/xz/yz) no longer reset to 'xy' when standard zones are refreshed after room changes
- CADR values in the pathogen efficacy data modal are no longer ~35x too large in feet mode. Room dimensions are stored in the active display units, but the modal's volume calculation assumed meters, inflating room volume (and every CADR figure derived from it) by the feet→meters factor cubed. Volume is now converted to cubic meters before the CADR math
- Changing a calc zone's type (plane/volume/point) no longer drops the click or leaves the edit unsaved on slower connections. The type is a delete-and-recreate on the backend (the zone returns with a new id, remounting the editor); the selection was held in volatile local state that the remount could discard. It is now derived from store state and applied synchronously, so it survives the remount — and the stray save against the deleted zone (a swallowed 404/400) is gone
- Lamp "Show Label" and "Show Photometric Web" toggles no longer revert when toggled quickly or under load. They were backed by local component state that a background store update could overwrite mid-edit; they now read and write store state directly
- Edits made in the brief window right after a project loads — e.g. room dimensions changed before session initialization finishes — are no longer silently lost. Backend sync functions early-return until the session exists, so such edits reached the UI but never the backend and vanished on save. Such edits are now queued and delivered once init completes (see the sync command queue entry below), `refreshStandardZones` waits for the session like the other syncs, and loading a file waits for init first
- API error responses no longer include internal exception details; validation messages still pass through
- Concurrent edits to the same session can no longer corrupt each other — mutating requests are serialized per session; edits during a running calculation return a clear "session busy" error instead of racing it
- Rapid edits to the same lamp/zone can no longer arrive out of order or race a delete — backend sync is serialized through a command queue; transient "session busy" responses retry automatically instead of surfacing an error (for queued edits; retries wait out even long-running calculations)
- Edits made while the backend session is still initializing or recovering are queued and delivered in order once it's ready, instead of relying on a one-shot state re-push
- Loading a project no longer lets stale queued edits from the previous project bleed onto the loaded one
- Switching a lamp's type in the lamp editor now clears its custom lamp reference. Previously the stale `custom_lamp_id` survived the type change, so a later edit to that custom lamp definition in the Lamp Manager would silently revert the lamp back to its old type and photometry
- Replacing a custom lamp's file no longer leaves both old and new files in the dropdown with no way to remove them
- Custom-lamp photometry is no longer silently lost during session-timeout recovery — the re-upload now waits for the lamp library to finish loading before reading definitions, and detaching a custom lamp routes its file removals through the sync queue (ordered before any re-apply upload) so they can't race a queued edit or drop without a retry
- Detaching a custom lamp's photometry can no longer be undone by a stale queued upload. If an apply command was still queued when the removal patch coalesced onto it, the merged sync command kept the old pending file and re-uploaded it right after the removal — leaving the backend with photometry the frontend thought was gone. The removal patch now explicitly cancels any pending upload it merges over
- "Add custom lamp..." no longer auto-applies an unrelated definition to the lamp that launched it. Cancelling out of the pre-filled create form and then adding a different lamp from the manager's list view could silently apply that unrelated definition (and its lamp type) to the original lamp; the auto-apply now fires only for a definition saved directly from the launching form
- Selecting "Add custom lamp..." is now non-destructive: it opens the manager without touching the lamp's photometry, and the dropdown restores to whatever was selected before. Cancelling the manager leaves the lamp exactly as it was; saving a new definition still auto-applies it. Previously the option immediately unloaded the lamp's photometry
- The photometric web now renders for custom lamps just as it does for presets. After a lamp's mesh was cleared (e.g. while swapping definitions), a stale cache key could suppress the refetch once the lamp regained its IES data with unchanged source settings, leaving a custom lamp with no photometric web. The mesh cache/refetch key now tracks the referenced custom definition and records the cleared state, so the web always reloads
- The Manage Custom Lamps "Save" and "Add custom lamp" buttons now use the app's blue instead of rendering with a transparent/near-invisible fill (they referenced an undefined color token)
- The Surface and Housing width/length/height inputs in the manager's Advanced section now line up cleanly; the first column no longer sits lower than the others
- Manager wording now refers to "storage" instead of "browser" ("Saved in storage", "Save to storage", "Remove from storage")

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
