# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Reflectance per surface: the Reflectance step is now one input (0.078 prefilled, "mixed" when surfaces differ) that applies to every wall, floor, ceiling and obstacle face, plus an Edit surfaces… button. The reflectance modal groups planes as Room surfaces (open) and one collapsible group per obstacle, each with its own quickset; obstacle faces (bottom, top, each side) take their own reflectance and transmittance. Clicking a surface or obstacle face in the 3D preview expands its group and focuses its input. Grid resolution per plane and the interreflection settings live under Advanced, and the calculation-point dots are hidden unless Show grid points is ticked. The 222 nm / 254 nm preset buttons are gone (0.078 is simply the default), and a new obstacle starts at 0.078 like the room surfaces instead of 0
- Lamp editor: an "Other (custom wavelength)" lamp now shows its wavelength in a Wavelength (nm) row (editable in place; locked with a "from spectrum peak" note when a spectrum defines it) with a Spectrum... button that opens the lamp's own library definition for attaching or replacing the spectrum file (Save or Cancel return to the editor), and the lamp's row in the list shows the wavelength after the file name ("lamp.ies · 265 nm")
- Rooms can be edited in centimeters, millimeters and inches as well as meters and feet. The unit selects (room step, floor-plan editor, Settings default units, lamp manager surface units) list all five; switching converts every length through the backend, and the sidebar summary, rulers, plan canvas and reports label areas and volumes with the right unit (cm², in³, …). Each unit has its own input step (1 cm, 10 mm, 1 in, 0.1 m/ft), plan-drawing snap (10 cm or 3 in), floor-grid cell (1 m or 1 ft) and default decimal precision; switching units moves the room's precision to the new unit's default unless you had chosen your own. A lamp-library definition saved in one unit applies correctly to a session in any other
- Project files saved in a unit the app does not offer (yards) load converted to meters

### Fixed
- Safety: the occupancy card's time to the ACGIH and ICNIRP limits, the Hours to TLV cells and the 2D plot's TLV line judged the room's whole dose against the lowest TLV of any lamp present, so a 254 nm lamp contributing almost nothing made a compliant 222 nm room read as safe for minutes while the next-step card still said it complied. They now use the same spectrum-weighted sum as guv_calcs and the compliance flags: each lamp's dose counts against that lamp's own TLV
- Lamp list: a lamp without photometry always reads "222nm - no photometry", "254nm - no photometry" or "Custom - no photometry" (it used to say "no model chosen" or "custom, no photometry yet"), and that status and the model subtitle now keep a gap from the row's buttons instead of running into them
- The strip of list background that showed beneath an expanded lamp, zone or object editor is gone
- Session init applied each standard zone's display mode and enabled flag and then recreated all three standard zones for the next one, so Whole Room Fluence always came back hidden ("None") and a disabled Eye or Skin zone came back enabled after a reload or a backend timeout recovery
- Lamp placement, the Work Surface / Head Height presets, the default spacing of a new zone and the 3D view's lifts and markers were fixed meter-sized numbers applied in whatever unit was active (so in feet a wall offset was 0.1 ft, not 10 cm); they are now converted into the current unit
- 3D view: the floor-plan image is lifted above the floor in proportion to the room's size and given a polygon offset, so the floor grid no longer bleeds through it at grazing angles or in large rooms
- Standard calculation zones in a traced room whose outline does not start at the origin were drawn shifted towards (0, 0) (a guv-calcs extents fix; the zones' points were always computed in the right place)

### Changed
- Whole Room Fluence is drawn as an isosurface by default (guv_calcs creates it hidden, "None"); the Settings volume display default applies to it like any other volume
- Results: Photobiological Safety, Pathogen Reduction in Air and Ozone Generation fold away by default (click the heading to open); Pathogen Reduction in Air is now a comparison: a full-width "Explore pathogen data…" button, a dropdown to tick the pathogens to compare (grouped by category, remembered as your result species), and a table of eACH and time to 99% per pathogen with the survival curves beneath. The Summary's pathogen dropdown offers groups ("All airborne pathogens", "All viruses", "All bacteria", … whichever have data at the lamps' wavelengths) that show the median across the group's species, labelled as such
- 3D view: a calculation plane lying on the floor is lifted just above the floor grid and floor-plan image so it no longer flickers against them

- On phones every modal opens as a full-screen sheet with a back button instead of a floating window: no dragging or minimizing, the body scrolls, and the app's tab bar steps aside while a sheet is open. The 2D plot fits the screen width (scrolling sideways only if the TLV scale still doesn't fit) and its footer stacks its controls; the efficacy swarm plot's controls wrap
- Results: the Summary opens with two cards, air changes per hour and clean air delivery rate (CFM with LPS beside it), then a time-to-inactivation card (90%, 99%, 99.9% labels over the times), all for the pathogen chosen in the dropdown under them (default Human coronavirus, from the pathogens with inactivation data at the lamps' wavelengths); then a plain row with the average fluence and its Show plot button, and an occupancy card that always weighs both limits, whatever standard the safety zones use: "Within ACGIH and ICNIRP limits all day" or "Within the ACGIH limit all day" (green), or "Safe to occupy for N h per day (ACGIH limit)" (yellow), with the time to each limit in two columns beneath, green from 8 hours up and yellow below. Cards are tinted rather than outlined; Generate Report sits at the bottom of the Summary. The banner states how long the space can be occupied per day: green "Continuous occupancy is within the TLV" with "Indefinite (N h)" from 8 hours up, yellow "Safe to occupy for N hours per day" below that; it never says "does not comply". Hours to the ACGIH TLV and to the ICNIRP limit are both listed, whichever standard is selected. Exact doses moved to the Photobiological Safety table, which now also shows the average 8‑hour dose and the maximum and average irradiance for skin and eye, with the Show Plot buttons
- Floor-plan editor: the New button reads "New outline" and asks before clearing corners that are already there; after the scale is set (or skipped) with no outline, a dialog offers to start tracing ("Place at least three points"); while drawing the hint reads "Esc cancels, Enter completes"; a wall snaps square only within 4° (was 8°) and never when it is shorter than about 30 px on screen

### Added
- Objects: draw an object's footprint. "Draw object…" beside Add Object opens a plan editor (the same canvas as the floor-plan editor: grid, snapping, draw-by-clicking, drag corners, midpoint insert) showing the room outline, floor-plan image, lamps and other objects; click out the footprint where the object stands, set its name, height, reflectance and transmittance, and Apply adds an extruded object. "Edit footprint…" in an extruded object's editor reshapes it, and "Convert to polygon…" turns a box into an editable polygon
- Objects: place obstacles such as desks, partitions and cabinets in the room so they block and reflect light. An Objects panel in the sidebar adds a box (size, position, yaw, reflectance and transmittance, with pitch and roll under Advanced), toggles it in and out of the calculation, copies, renames and deletes it; objects are drawn as solid grey blocks in the 3D view (click to select), saved with the project, converted with the room's units, included in the position check and nudge, and extruded-polygon objects authored in Python load, render and edit (their footprint is read-only for now). Changing an object marks the results stale and the next calculation redoes the shadowing
- Floor-plan editor: upload a floor plan (PNG, JPEG, WebP, GIF, SVG or PDF page) as a reference image, set its scale by clicking two points a known distance apart, drag it into position, adjust its opacity, and trace the outline over it. The image is saved with the project (in an app-owned block of the .guv file that guv-calcs ignores), shown in the sidebar thumbnail, and drawn on the 3D floor clipped to the room outline, with a "Floor plan image" toggle in Settings and the View menu. A Snap toggle in the editor turns grid snapping off while tracing. A very large image stays available for the tab but isn't kept across a backend restart — save the project to keep it
- Floor-plan editor: corners, walls and midpoints stay editable while Move plan is active, and clicking the active Move plan / Set scale button returns to editing; Snap off now frees new walls from the 45° steps as well as the grid (Shift still forces an angle); tool buttons use the secondary style so only Apply carries the accent colour; the upload button reads "Upload floorplan…"
- Floor-plan editor: the toolbar is split into captioned Outline and Floorplan groups, the floorplan steps are numbered (1 Upload, 2 Set scale, 3 Move plan) and shown disabled until an image is loaded, and a hint line under the toolbar always says what to do next
- Floor-plan editor: uploading a floorplan now starts a new room — the old outline is cleared, the modal chains Set scale into Trace outline over the drawing, a notice names the file (Cancel restores the old outline), and a "From floorplan…" button on the Room panel opens the editor straight into the file picker
- Floor-plan editor: the uploaded plan sits on the origin and stays there when its scale is set (rescaling keeps (0,0) fixed instead of the midpoint of the two clicks), so no part of the room drifts below the axes where it could not be traced; the steps are 1 Upload, 2 Set scale, 3 Trace outline, with Move plan as an optional nudge
- Floor-plan editor: wall-angle snapping is now opinionated — with Snap on, a new wall snaps to a right angle anywhere within 30° of one and to 45° otherwise (it used to snap only within 5°); the rubber-band, measurement and angle-arc dashes are sized in screen pixels instead of room units
- 3D view: the floor-plan image no longer z-fights with the floor grid
- Floor-plan editor: the Move plan tool is gone — drag the handle on the plan's bottom-left corner to move it; the second Set scale click snaps to a right angle from the first; the Snap toggle is a magnet icon beside the zoom controls; hints are shorter and the "new room" notice and "Reference image" title are dropped; the angle readout is a faint wedge centred on the corner instead of a dashed arc; dashes are tighter. The Room panel keeps a single Edit button in the standard colour
- Floor-plan editor: angle snapping is gentle again — only a nearly square corner (within 8°) is pulled to 90°, everything else is freehand (Shift forces 45° steps, Alt frees), and the Snap toggle is gone; Set scale cannot be skipped for a newly uploaded plan (Trace outline waits for a confirmed scale); in the 3D view the plan is drawn in full rather than clipped to the room outline
- Floor-plan editor: the Rectangle / L / T / U presets are replaced by a single New outline button that clears the shape and starts drawing; finishing or cancelling with fewer than three corners restores the previous outline
- Floor-plan editor: the canvas is anchored at the origin (spare space goes up and right, since coordinates can't be negative); the toolbar is "Floorplan (optional)": 1 Upload floorplan…, 2 Set scale, 3 Trace outline, then Clear; buttons share one height and the step numbers are larger
- Floor-plan editor: the Set scale prompt sits at the top of the canvas with a title and accent border; the grid and axes always run to the canvas edge; placing a corner near the edge no longer re-zooms the view; faint guidelines pull the cursor into line with existing corners so outlines close square; the drawing button is "New" (disabled while drawing) and Enter / the first corner closes, Escape cancels — the Finish and Cancel buttons and the "Drawing…" note are gone; guidelines disappear once the outline closes
- Floor-plan editor: scrolling (two-finger trackpad or mouse wheel) pans the canvas and pinch or Ctrl+scroll zooms; Space+drag pans in any mode, including while placing corners
- Floor-plan editor: grid snapping is light, like the angle snap — a corner, wall or the plan's handle within a few pixels of a visible grid line lands on it, anything else stays exactly where it was placed (Alt still frees); a guideline shows the grid line being snapped to, and a nearby corner still wins over a grid line
- Floor-plan editor: the toolbar is just New, Upload floorplan… and Set scale, usable in any order; uploading no longer clears the outline, it offers Set scale (Escape dismisses it); the step numbers, captions and Trace outline button are gone; the idle hint line is blank; grid snapping targets whole metres or feet (or the finer grid when zoomed in) rather than the auto-scaled grid spacing, and the first corner snaps without a guideline
- Floor-plan editor: uploading a floorplan over an existing outline asks whether to clear the old corners (Clear / Keep), then asks whether to set the scale now (Set scale now / Later)
- Floor-plan editor: click the plan to select it (dashed highlight), then drag it anywhere to move it; a small x / y readout with inputs sits at its corner while selected, Escape or clicking elsewhere deselects. The side panel's X / Y rows and the corner handle are gone

### Fixed
- A request carrying a non-finite number (NaN or Infinity) now returns a proper 422 validation error instead of a 500

### Added
- Guided sidebar: five numbered steps in the order a design is built: 1 Floorplan, 2 Obstacles, 3 Reflectance (walls and obstacles together), 4 Lamps, 5 Calc Zones. A collapsed step shows a one-line summary when it has something to say. The status bar names the next thing to do (add a lamp, choose a model, calculate, review safety, export a report)
- Floorplan step: dimensions, the minimap right under them, and one line with the floor area, the volume and the Edit button
- The Results panel is open from the start, narrow while empty and wider once results arrive; its empty state carries the next-step hint (add a lamp, choose a model, ready to calculate)
- Start chooser on a fresh project: an example room (13 × 20 ft with a bare Ushio B1 already placed and calculated), an empty room (opens the floor-plan editor straight away), or a project file. "Don't show this again" and Help → Getting Started
- Objects are called obstacles everywhere in the interface (step title, buttons, status bar, menu, editor); file formats and ids are unchanged
- View → Sidebar → Guided / Expert. Expert restores the flat, always-open layout with every per-row toggle, including on standard zones

### Changed
- Plan editor: the floor-plan editor gains an Obstacles layer (a layer rail switches between Outline and Obstacles). Draw an obstacle by clicking its corners; it is selected at once and can be moved by dragging, reshaped by its corners and walls, nudged with the arrow keys, copied (Ctrl+D) and deleted. The side panel lists the obstacles and, for the selected one, its name, floor to ceiling or bottom and top, reflectance and transmittance, with the corner table under "Corners". New obstacles reach floor to ceiling. Apply commits the outline and every obstacle change together; Cancel discards all of it. Applying the outline with no obstacles yet offers "Add obstacles" / "No obstacles to add". The separate footprint editor is gone; the sidebar's "Add obstacle…" and "Edit on plan…" both open this layer, and the plan thumbnail shows obstacle footprints
- Applying the Plan editor with an unchanged outline no longer writes the room, so lamps, zones and obstacles are not nudged and the calculation is not marked stale
- Reflectance is its own step: the Enable reflections toggle, a Walls… button with the wall reflectance summary, and a reflectance / transmittance pair per object, so every surface in the room is set in one place
- Object height is a bottom and a top (or "Floor to ceiling") instead of a base Z and a height; an object marked floor to ceiling follows the room height when that changes
- A new lamp shows only its type and model until it has photometry; position, aim and rotation appear once a model is chosen (guided layout)
- Standard zones no longer show calc-enable and delete toggles in the guided layout; they are the app's zones, not the user's
- Row toggles (show/hide, include, delete) stay quiet until the row is hovered, focused or open
- Visual refresh: a violet primary colour carries actions, focus rings, selection and the Calculate button; the pink-red accent is reserved for the brand and red for danger. Light theme lifted slightly so the sidebar and viewer read as one surface
- Help describes the three-step flow

## [0.4.1] - 2026-09-18

### Changed
- Floor-plan editor: while drawing, each new wall shows its angle to the previous wall and snaps to 45° steps (Shift forces the nearest step, Alt frees the cursor); the toolbar is Rectangle / L / T / U presets then Draw / Finish / Cancel, and zoom (+ / −) and Fit live as controls on the canvas. Corner numbers in the vertex table are plain labels and the remove buttons are subtle until hovered; the modal has proper padding and never scrolls as a whole (the corner list scrolls instead, with Add corner staying put); Add corner splits the longest wall; +/−/Fit sit quietly in the canvas corner; and the modal has its own units switch

### Fixed
- Converting a polygon room whose outline didn't touch the axes back to a rectangle (e.g. by typing its four corners) produced a rectangle offset from the origin, so the room's Y extent came out wrong

## [0.4.0] - 2026-09-18

### Changed
- guv-calcs bumped to 0.7.3

### Added
- Polygon rooms: the room panel shows a floor-plan thumbnail and an "Edit floor plan…" button that opens a floor-plan editor. Draw an outline by clicking corners (each new wall shows its angle to the previous wall and snaps to 45° steps; Enter or clicking the first corner closes it), then drag corners or whole walls, add corners on a wall's + handle, or type exact coordinates; wall lengths and the floor area are shown live and changes only take effect on Apply. The canvas fits the outline, with scroll-wheel zoom, drag-to-pan, and +/−/Fit controls. The X / Y fields always show the room's overall extents; for a polygon room, changing one stretches the floor plan along that axis. In the 3D view the standard zones follow the outline (extruded outline wireframe, markers clipped to the floor plan) and the room's bounding box is drawn only as a faint reference. Lamps, zones, reflectance surfaces (walls are listed as Wall 1..n), lamp placement (downlight, corner, edge), the 3D view, save/load and unit switching all follow the outline. Standard zones are clipped to the outline, so results outside the room are neither computed nor shown. (guv-calcs 0.7.3: adds `Room.set_polygon`, carries wall reflectances across shape changes by edge, and rebuilds standard zones from the polygon.)

## [0.3.0] - 2026-09-01

### Changed
- Adding, moving, or editing a lamp that has no photometry yet no longer marks the calculation stale (Calculate button stays blue) — such a lamp can't affect any result. It turns red as soon as the lamp gets a preset or custom lamp definition. (guv-calcs 0.7.2)

### Fixed
- Selecting a preset for a lamp that had no photometry left the Calculate button blue (up to date) instead of red. The backend echoed `has_ies_file: false` for the just-configured lamp because it read the flag from the discarded pre-preset lamp object, so the frontend never registered the lamp as calculable

## [0.2.0] - 2026-07-29

### Added
- Custom lamp manager (Edit → Manage Custom Lamps): build reusable lamp definitions — IES photometry, spectrum, and product settings — and apply them to placed lamps from the "Select Lamp" dropdown, which lists built-in presets alongside your custom lamps for that lamp type. Definitions can stay with the project or persist in your browser, edits propagate to placed lamps, and loading a .guv file re-links its embedded custom lamps to your library by content instead of duplicating them.
- Warning before leaving the page with unsaved changes
- Calculation zone units and dose time are now editable straight from the Results panel: click the units to swap between µW/cm² and mJ/cm², or click the dose time to type a new duration ("1h 30m", "90m" and "1:30:00" all work)

### Changed
- Dose times now always display hours, minutes and seconds ("8h 0m 0s" rather than "8h")
- Photometry is now supplied by selecting a custom lamp definition. Every lamp type uses the same "Select Lamp" dropdown, and the lamp editor's inline IES/spectrum upload widgets are gone — uploads happen in the lamp manager.
- Zone and lamp IDs are now assigned by the app and are short and readable (`zone-1`, `lamp-1`) instead of long random strings. A zone keeps its identity when its type changes — type switches no longer recreate the zone under a new ID

### Fixed
- The luminous opening in the Lamp Fixture tab's 3D preview was drawn rotated 90 degrees, so it cut across the fixture housing instead of lying flat inside it
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
