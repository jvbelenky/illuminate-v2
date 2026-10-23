# Workspace redesign: landing page, editor panel, side-by-side 2D/3D

Date: 2026-10-21. Status: mockup approved in conversation ("ok looks good, lets implement"); this document awaits approval.

Reference mockups (open in a browser; they are the source of truth for look and behaviour where this text is silent):

- `docs/superpowers/mockups/2026-10-21-workspace.html` — the workspace, clickable (also published at https://claude.ai/artifact/Fzz7ae3chgEgomMYGUAF37, version 33).
- `docs/superpowers/mockups/2026-10-21-landing.html` — the landing page (desktop and phone, dark and light).

The mockup fakes the 3D view (isometric SVG) and the results (scaled from the example room). Everything else in it is meant literally.

## Intent

The user knows Illuminate well and wants to "raise the ceiling": designing a room, placing lamps and adding calc zones should feel really easy and good. Today the guided workflow lives in a Plan pop-up (`FloorPlanModal`) on top of a sidebar that is a second, complete interface, and the user has to leave the pop-up to see the 3D view, calculate and read results.

The new workspace puts the whole job on one screen. The left column is a guided editor, the middle shows the 2D and 3D views together, and the right column shows the results. Every step stays reachable after it is done, and the results stay visible, so an edit, a recalculation and its effect are seen together.

## History that matters

On 2026-10-06/07, three attempts to make the plan the primary view (versions A, B1/B2 and C) were built and then reverted. The user found them busy and confusing, and the guided layout in C "made no sense" when it opened on 3D with a clickable mini plan. Notes: `docs/superpowers/notes/2026-10-07-plan-as-primary-view-attempts.md`; code on branch `plan-primary-view-archive`.

This redesign is a large layout change too, but the user arrived at it themselves by iterating on a clickable mockup over many rounds. What differs from C: 2D and 3D are full panes side by side (not a mini plan); the left column is one step at a time with large clear sections (not a rail plus a second settings panel); results stay on the right as they are today.

The "small changes to the modal" guidance (memory `feedback-plan-modal-small-changes`) is superseded by this approval for this design. It still applies to anything beyond it: show a mockup before moving panels again.

## Goals

1. A landing page with three choices: start designing, open a `.guv` file, see an example.
2. A guided editor in the left column. **Room** has parts Floorplan · Structures · Ceiling · Reflectance; then **Lamps**; then **Zones**. Back/Next are named after their targets, and every step stays reachable at any time.
3. 2D and 3D shown together, in user-selectable layouts. The 2D view can show the floor, the ceiling or any wall, and it is always clear which surface it shows.
4. Results always visible, as in today's results panel.
5. **Done** closes the editor and shows a clean, read-only summary of the configuration, from which any part can be reopened.
6. The design accommodates later features without building them: non-flat ceilings and floors (vestibules, lecture halls), ingesting 3D CAD, and a ceiling designer like Holger's.

## Non-goals (this round)

- Non-flat ceilings and floors; guv-calcs does not support them.
- Importing CAD / 3D models (the entry exists, disabled, marked "later").
- An example picker behind "See an example" (parked; for now it loads the existing example room).
- Changes to how results are computed or laid out, beyond what is listed under Results.

## Anti-goals (would make this a failure even if it works)

- A busy left column; pop-up mini menus; floating cards that cover the work.
- Explanatory sentences in the UI. Labels, values and chips only (memory `feedback-minimal-ui-text`).
- Anything that bumps the user out of the surface they are working on. For example, adding a plane while looking at a wall must not jump to the floor plan.
- Transparent overlays over the views.
- Moving Calculate away from the 3D view.
- Fiddly controls where a plain button reads better. For example, the summary's section headers are full-width buttons, not small pencil icons.

## Decisions

Everything in the next three tables was decided by the user while iterating on the mockup, except rows marked *(my call)*.

### Landing page

| Topic | Decision |
|---|---|
| Form | Replaces `StartChooserModal`'s content: three **square cards side by side** with pictograms in the current style; on a phone they stack as rows |
| Cards | **Start designing** (opens the editor at Room › Floorplan with the default rectangular room) · **Open a .guv file** · **See an example** (loads today's example room) |
| Headline | Unchanged: "Illuminate is a tool for modeling germicidal UV efficacy and safety." |
| Theme | Illuminate's own dark and light tokens; "Don't show this again" stays |

### Editor (left column)

| Topic | Decision |
|---|---|
| Structure | A small "Edit" heading with a **Done** button; stage tabs **1 Room · 2 Lamps · 3 Zones**; Room has part tabs **Floorplan · Structures · Ceiling · Reflectance**; the panel; a footer with Back/Next named after their targets. On the last step, Next becomes **Done** |
| Naming | Obstacles are called **Structures** in the UI (code and file format keep `objects`). Zones carry no "optional" label |
| Selection highlight | Selected things are orange (`--color-scene-selected`); things belonging to the open part are tinted primary |
| Rename | As in today's app: a pencil next to the name, shown when the row is open; Enter or blur saves, Esc cancels. Applies to structures, lamps and zones |
| Row toggles | As in today's app: an eye (shown in the views) and a calculator (included in the calculation), using the app's `icon-toggle` look. They appear on rows in the editor lists *(my call: lamps and zones have them in the mockup; structures get them too, for consistency)* and in the summary |
| Lamp rows | Match today's lamp list: wavelength dot (grey when excluded), name, italic fixture name on the same line, then the toggles |
| Display options | Every open lamp, zone and structure has a collapsed **Display ▾** section (a caret disclosure) gathering all of that item's display-only options in one place (user decision). The eye stays on the row as the quick toggle. Contents: **lamps:** name label, photometric web; **zones:** value display (heatmap / numeric / markers), name label, and the iso controls for volumes; **structures:** name label *(my call: structures have no per-item display options today, so a label is added for parity)*. The options move out of `LampEditor` and `ZoneEditor`'s main fields into this section |

**Room › Floorplan**
- **Size and units:** Width, Length, Height and Units in one row of plain number fields with no spinners. Width and Length are disabled once the outline is not a rectangle. Changing units goes through the existing `project.changeUnits`.
- **Floor area and Volume:** plain read-only text (label and value), not field-like boxes.
- **Drawing a custom outline** happens only from the 2D toolbar's **Draw** (user decision); the panel has no Draw custom outline or Make rectangle button. Starting a drawing hides the current outline straight away; Finish outline (enabled from 3 corners) and Cancel (which brings the old outline back) take the toolbar's place.
- **Drawing behaviour:**
  - Corners snap to the grid.
  - A line locks to horizontal or vertical within a few degrees, with a coloured guide line.
  - Typing digits then Enter places the next corner at that length. This is new; `PlanCanvas` has no typed lengths today.
  - Clicking the first corner, or pressing Enter, closes the shape; Backspace removes the last corner; Esc cancels.
- **Plan tools: the same ribbon as Structures** (user decision: "basically the same"). Transform / Edit shape / Draw (plus Move image when a floor plan image is loaded), then Rotate 90° / Flip horizontally / Flip vertically; no Copy or Delete for the room. Transform: scale corners, stretch sides, rotate knob, drag the room to move it. Edit shape: corners, sliding edges, "+" midpoints, double-click to add or remove. T / E switch modes. *(My call: these move the outline only; lamps, structures and zones stay where they are, as when editing corners today.)*
- **Geometry ▸** fold-out in the Floorplan panel, as for structures (user decision): X and Y with a **Reference** dropdown (user decision): **Corner** (where width and length begin; 0, 0 for the default room) or **Centre**. Default Corner for the room *(user: a centroid is unintuitive for a floor plan)*. Width and Length along the outline's own sides; changing them keeps the reference point fixed (so they also work on a custom or rotated outline); Rotation; then Corners, an X/Y pair per corner. No pitch or roll for the room.
- **Editing the outline on the plan:**
  - Drag a corner to move it.
  - Double-click a corner to remove it; a room keeps at least 3 corners.
  - Double-click a wall to add a corner.
  - A **"+" on each wall's midpoint**, as in today's `PlanCanvas`: pressing it inserts a corner there and keeps dragging it. The same "+" handles appear on structure footprints (Edit shape) and drawn zone footprints.
  - Starting a drawing or a drag locks the view exactly as it is on screen, so nothing zooms or jumps.
- **Start from:** "Floor plan image…" and "3D model…" (disabled, with a "later" chip).
- **Floor plan image** (user decisions; reuses today's upload, storage and 3D texture):
  - Choosing a file opens a small **Set scale** pop-up: click two points on the image, type the distance between them, Apply (Enter applies, Esc cancels). A step chip shows "Pick point 1" / "Pick point 2" / "Distance".
  - Once scaled, the image shows in the 2D floor view (under the outline) and on the floor in 3D. The 2D view widens to take in the image.
  - Floorplan then shows a "Floor plan image" block: thumbnail, name, Opacity slider, **Set scale…** (rescaling keeps point 1 where it was), **Replace…** and **Remove**.
  - A **Move image** tool joins Draw / Edit corners under the plan while an image is loaded.

**Room › Structures**
- **Adding:** one **+ Add structure** button drops a default box in the middle of the room, about 3×3×3 ft in the project's units, and selects it. There are no separate "draw" and "add box" options.
- **Row:** the name (pencil to rename) and the toggles; no size or corner-count readout.
- **The open structure's panel** (user decisions). Only **Bottom**, **Top** and **Floor to ceiling** (which disables Bottom and Top) show by default. Everything else is a collapsed section, in this order:
  - **Geometry** (one fold-out, user decision): X and Y with the same **Reference** dropdown as the room (Corner / Centre; default Centre for structures *(my call)*); changing Width or Length keeps the reference point fixed; Width and Length, measured along the structure's own sides (on a custom footprint they scale it about its centre); Rotation (yaw), Pitch and Roll (pitch and roll tilt the structure about its base centre in 3D); then Corners, an X/Y pair per corner.
  - No Surfaces section (user decision): reflectance and transmittance are set in Room › Reflectance only.
  - **Display:** Show label.
  - Rule: anything that can be changed in the plan view has a typed field here, folded away by default.
- **No "Make rectangle"** (removed by the user).
- **Plan tools** (user decision: a fuller "edit structure in plan view"). A ribbon under the 2D view while a structure is selected:
  - **Transform** (T, the default): a dashed box in the structure's own frame. Corner squares scale (the opposite corner stays put; Shift keeps proportions); side squares stretch one way; a knob above the box rotates about the centre (5° steps, 15° with Shift). Dragging the body moves it.
  - **Edit shape** (E): drag a corner to move just that corner; drag an edge to slide it back and forth along its normal, its neighbours stretching to follow; double-click an edge to add a corner, or a corner to remove it. Dragging the body moves it.
  - **Draw:** draws a new footprint with the room-outline tool; Finish footprint / Cancel take the ribbon's place while drawing.
  - **Rotate 90°**, **Flip horizontally**, **Flip vertically**.
  - **Copy** (Ctrl+D) and **Delete** (Delete key), with no confirmation (undo covers it).
  - The selected structure shows the length of each side.
- **In a wall view:** drag to slide along the wall and to change the height above the floor.
- **Keyboard:** the arrows nudge (Shift for a larger step).

**Room › Ceiling**
- **Height:** the same value as the Floorplan's Height.
- **No Type dropdown** for now.
- **Tile grid** (2×2 / 2×4 / none, direction, start corner) and **place-on-ceiling items** (smoke detector, vent, sensor, keep-out area), inspired by Holger's Ceiling Designer and "mostly for planning". They do not change the calculation.
- **Panel layout** (user: the first version was confusing; rebuilt to follow the Lamps page pattern so actions and things look different):
  - **Ceiling** heading with its eye, then Height.
  - A bordered **Tile grid** card with its eye: **Tiles** None / 2×2 / 4×2 / 2×4 (width × length, so direction is part of the choice), and **Align**: five pictograms (a dot on a little ceiling) for starting at a corner or centring a tile on the room. The grid lines follow that choice in 2D and 3D.
  - **Move grid** in the 2D toolbar (shown when no item is selected) drags the grid to line it up with a real ceiling; picking an Align pictogram resets that nudge.
  - An **Add to ceiling** card, styled like Add lamp: Detector, Vent, Sensor and Keep-out buttons with icons. Each adds one item in the middle of the room (snapped to a tile centre), selects it and switches the 2D view to the ceiling.
  - An **Items** list (with an eye for all items) in the compact row style of lamps and zones: icon, name (pencil to rename) and an eye per item. The open item shows its fields directly, with no fold-out (user decision): X and Y for detectors, vents and sensors; for a keep-out area X/Y with Reference, Width, Length, Rotation and Corners.
  - In the 2D ceiling view: detectors, vents and sensors drag to move and land in the middle of a tile while the grid is shown (Alt places freely). Keep-out areas are shapes with the shared toolbar (Transform / Edit shape / Draw, Rotate 90° / Flip). Every item has Copy and Delete in the toolbar, plus Ctrl+D and Delete keys.
- **Show/hide** (user decisions), each an eye toggle in the app's `icon-toggle` look:
  - **Ceiling**, on the part's first heading and in the summary's Room section. Hiding it removes the ceiling (and its tiles and items) from the 3D view and from 3D click-picking; the 2D Ceiling view stays available.
  - **Tile grid** and **Place on ceiling** headings, one eye each, plus an eye on each item. Hidden details are not drawn in the 2D ceiling view or in 3D.
- **Opening Ceiling switches the 2D view to the ceiling.**

**Room › Reflectance**
- A copy of today's `ReflectanceStep`:
  - Enable reflections.
  - The **All surfaces** card (Reflectance and Transmittance, 0–1 values, "mixed" when the surfaces differ).
  - A Room walls row and one row per structure (R and T).
  - **Edit surfaces…**, which opens the existing `ReflectanceSettingsModal` *(my call: the mockup showed an inline table, but the instruction was "copy the one on current illuminate")*.

**Lamps**
- **Add lamp card:**
  - A fixture selector: presets, the custom lamp library, and "Add custom lamp…", which opens `LampManagerModal`.
  - Four placement buttons with pictograms: **Downlight, Corner, Edge, Horizontal**. Each click adds one lamp, placed automatically, and selects it. This is the behaviour already built in commit `7933a25` (`addPlacedLamp`, `utils/lampPlacement.ts`).
- **Sticking** (user decision): two checkboxes in the open lamp's panel, **Stick to ceiling** and **Stick to wall**. Placement sets them: **Downlight** → ceiling; **Corner** and **Edge** → ceiling and wall; **Horizontal** → wall. Stuck to the ceiling, a lamp keeps its distance below it when the room's Height changes (same undo step). Stuck to a wall, it keeps its offset from that wall when the outline is edited. *(My calls: moving the lamp by hand off its surface (dragging off the wall, changing its height, typing new coordinates) unchecks the matching box; checking Stick to wall attaches to the nearest wall; deleting the wall unchecks it. Stored per lamp, frontend-only like `fit_room`, round-tripping through save/load.)* It is the first piece of a later, ceiling-aware Lamp Placer.
- **Dimmer** (user decision): directly under the fixture selector, a 0–100 % slider with a number field. It is the lamp's existing scaling factor (today only in the Advanced lamp settings pop-up), now in the main panel.
- **The open lamp's panel stays as today's `LampEditor`** (user decision: no redesign this round), with only these additions: the dimmer, the Stick checkboxes, and the display toggles moved into Display ▾. **Details…** stays beside the fixture selector, as today. The mockup's single fixture list is a stand-in, not a change.
- *(Earlier wording, kept for the field list:)* the open lamp's panel is today's `LampEditor`, hosted as in `FloorPlanModal`'s `lampPanel`. It has fixture, position, the re-place buttons, aim point, tilt/orientation and rotation, which matches what the mockup shows.
- **On the plan:**
  - A **Move · Aim · Copy · Delete** ribbon under the plan, with icons, as in `7933a25`.
  - Shift-click and box select pick several lamps.
  - Each lamp's aim line and coverage circle are clipped to the room.
  - A single selected lamp has a draggable crosshair at its aim point.
- **In a wall view:** drag to slide along the wall and to raise or lower the lamp.
- **Keyboard:** M and A switch between Move and Aim; Delete removes; Ctrl+D copies; Ctrl+A selects all; the arrows nudge.

**Zones**
- **Standard zones:** a **Use standard zones** checkbox, then the three standard zones with type icons and toggles. They have no "standard" badge, because it truncates the names and the "Standard" heading already says it.
- **Add zone card:** **Plane · Volume · Point**, each with the app's `CalcTypeIllustration` icon.
  - **Plane:** a whole-room plane at eye height (5.9 ft / 1.8 m, today's standard).
  - **Volume:** a whole-room, floor-to-ceiling volume.
  - **Point:** in the middle of the room at eye height, aimed level.
- **A plane starts on the surface being viewed:**
  - In a wall view it covers that whole wall, and the view stays on the wall.
  - In the ceiling view it sits at ceiling height.
  - Its custom footprint is drawn on that same surface, and "Whole wall" or "Whole room" resets it.
- **The open zone's panel** is today's `ZoneEditor` *(my call: the mockup's short field list stands in for it)*.
- **On the plan:**
  - Planes are drawn with a fine green dash and volumes with a longer one.
  - A point is a ring you drag to move it, plus a dot you drag to aim it.
  - A custom footprint can be dragged by its body or its corners.
  - A **Copy · Delete** ribbon sits under the plan; Delete, Ctrl+D and the arrows work as for lamps.

### Views (middle)

| Topic | Decision |
|---|---|
| Layouts | In the **View** menu: Side by side (default), Stacked, 2D large + 3D inset, 3D large + 2D inset, and **Swap views**. There are no "2D only" or "3D only" layouts: a hidden inset covers them |
| Divider | Drag to resize (horizontally or vertically depending on the layout); double-click resets to 50/50 |
| Inset | An opaque window with a slim title bar. Drag the title bar to move it, kept inside the view area. The title bar has ⇄ swap and – hide; hiding leaves a "Show 2D" or "Show 3D" pill in the corner. Clicking the inset's body also swaps. It sits above Calculate |
| Calculate | Top right of the 3D view in every layout where the 3D view is a full pane; top right of the 2D view in "2D large". The Autorecalculate checkbox sits under it, as today |
| Remembering | The layout, split, inset position and hidden state persist per user (`userSettings`) *(my call: the mockup resets them on reload)* |
| 2D surfaces | The 2D pane shows **Floor**, **Ceiling** or any **Wall n**, chosen with a segmented control: Floor · Ceiling · Walls ▾. The `[` and `]` keys step through them. There are no ‹ › arrow buttons and no caption under the control |
| Wall view | An elevation of the wall seen from inside. Structures and lamps in front of it are projected onto it, fading with distance, and neighbouring walls are labelled at each end. Editable there: structures (slide and height), lamps (slide and height) and wall planes |
| 3D picking | Clicking in 3D sets the 2D view's surface and **cycles through stacked surfaces** under the cursor, like today's `processClickBatch`: floor and far walls first, then the ceiling, then the near walls. On hover, a chip near the cursor names the surface the next click picks ("Ceiling 2/2") and highlights it. Clicking a structure (in Structures), a lamp (in Lamps) or a zone selects it |
| 3D highlighting | The tint follows **what is being edited**: the floor in Floorplan, every structure in Structures, the ceiling in Ceiling, all surfaces faintly in Reflectance, lamps and their aim lines in Lamps, zones in Zones. The surface shown in 2D gets only a subtle dashed outline. Selection is orange |
| 3D in Zones | Planes are tinted sheets (wall planes on their wall); volumes are dashed boxes; points have a short direction line |

### Summary (after Done)

| Topic | Decision |
|---|---|
| Header | "Summary". No Edit button |
| Sections | Room · Structures · Lamps · Calc zones. Each header is a **full-width button** (bordered, hover turns the border primary, no chevron, no shadow, no counts) that opens that step |
| Room | Dimensions (W × L × H, or "n-corner outline · H high"), Floor area, Volume, Reflections ("On · R min–max" or "Off"). No ceiling tiles row |
| Structures | Names only, with eye and calculator |
| Lamps | App-style rows: dot, name, italic fixture, eye, calculator |
| Calc zones | Type icon, name, eye, calculator. Standard zones are listed only while "Use standard zones" is on |
| Views | View-only: no handles, no part highlighting, nothing can be dragged; the surface switcher still works |
| Returning | The summary's section buttons, or the stage tabs once back in the editor; the editor returns to where the user left it |

### Results (right column)

`ZoneStatsPanel` as today. Photobiological safety is collapsed by default, so only the summary shows. After an edit the results show as stale and Calculate turns primary, as today.

The mockup's ▲/▼ percentage change against the previous calculation is **dropped** (user decision). Do not build it.

## Accommodating later features

- **Surfaces as a general idea.** The 2D view's surface is an id: `floor`, `ceiling`, or `wall:<index>`. Keep it open to more kinds (a ceiling region, a sloped plane). A later non-flat ceiling becomes regions with height rules (flat / plane / preset / vertex heights), following DIALux, Revit and AGi32 practice. Today there is one flat region.
- **Lamp heights and the Lamp Placer.** Stick to ceiling / Stick to wall (see Lamps) are the first piece. The user plans a more complex, ceiling-aware Lamp Placer later (tiles, items and keep-out areas, non-flat ceilings). Store the attachment and the ceiling details so that placer can read them; with non-flat ceilings, "stick" will mean "follow the ceiling region above the lamp".
- **CAD.** The "3D model…" entry exists and is disabled. Imported geometry is expected to become a guide (like DIALux), not a calculation model.
- **Ceiling designer.** The tile grid and the place-on-ceiling items are its first pieces. Store them so they can grow (more item kinds, sizes, rotation).

## Constraints

- Svelte 5 / SvelteKit UI in `ui/`. `.svelte` files use tabs, and must never be edited with the Edit tool or sed (use a Python helper or the Write tool).
- All scene edits go through the project store, so undo (`stores/history.ts`) and the sync queue see them. A gesture in flight is local, and a completed gesture is one store mutation (one undo step), as in today's `FloorPlanModal`.
- Units: everything is in the project's units, never hard-coded feet. Defaults (box size, eye height, snap step) scale per `UNIT_INFO`.
- Colours: `--color-primary` / `--color-accent` (brand, part tint), `--color-scene-selected` (orange), geometry slate, lamp hue by wavelength (222 violet, 254 blue; memory `project-color-system`).
- **Scrolling follows today's app** (user decision; `+page.svelte`): opening a row or editing fields in the editor leaves the scroll where it is; adding or copying a lamp, zone, structure or ceiling item, or selecting one in the 2D or 3D view, opens its row and scrolls it smoothly to the top of the editor (`scrollIntoView({ behavior: 'smooth', block: 'start' })`). Re-rendering must never jump the editor, summary or results to the top.
- Desktop at 1440×900 must show controls and their effect together, without scrolling to see the work (memory `geometry-editor-ux`). The phone layout stacks the columns with a 16px gutter and no sideways scrolling.
- guv-calcs limits:
  - Vertical calc planes exist only as axis-aligned rectangles (`ref_surface` `xz`/`yz`).
  - A **wall plane on an angled wall of a polygon room**, and a **custom (non-rectangular) footprint on a wall plane**, need guv-calcs support that does not exist yet. **User decision: add that support to guv-calcs** rather than ship a restricted version. Wall planes are then full-featured on every wall, as in the mockup. This is cross-repo work: guv-calcs change and release, a pin bump (`make bump-guv-calcs`), and any API contract change for the new plane geometry. It blocks only the wall-plane part of phase 3, not the rest of the redesign.
- Ceiling tiles and ceiling items are frontend-only. Like `fit_room` and `lamp.mounting`, they must round-trip through save/load.

## How it maps onto today's code

| Today | Becomes |
|---|---|
| `StartChooserModal` (Example room / Empty room / Open) | The landing cards; "Empty room" becomes **Start designing** |
| Left `ResizablePanel` sidebar with `SidebarStep`s (Room, Obstacles, Lamps, Calc zones, Reflectance) | The **editor panel** (in editing) or the **summary** (after Done). The sidebar as a second complete interface goes away; everything it did is reachable from the editor, the wall views and the numeric fields |
| `FloorPlanModal` (guided steps, `PlanCanvas`, `lampPanel`/`zonePanel` snippets, `PlanActions`) | Retired as a pop-up. Its step logic, gestures and actions move into the editor panel (panels) and the 2D pane (canvas). `PlanActions` remains the seam between the canvas and the store |
| `PlanCanvas` (floor plan only) | The 2D pane, extended to the ceiling (same coordinates) and to wall elevations (wall coordinates: along the wall, up), plus typed lengths while drawing |
| `RoomViewer` / `Scene` (Three.js) with `CalculateButton` | The 3D pane: surface picking and cycling, part-based highlighting, the dashed outline for the shown surface, zones drawn per step. Calculate moves with the layout rules above |
| `ZoneStatsPanel` | Unchanged in the right column |
| `ReflectanceStep`, `LampEditor`, `ZoneEditor`, `ObjectEditor` fields | Hosted in the editor panel |
| Mobile tabs (`activeMobileTab`) | Builder's call: keep tabs or stack panes, as long as the phone constraint holds |

## Left to the builder

- **Order of work.** *(My suggestion, not decided:)* (1) the workspace shell (layout, View menu layouts, editor panel with Room parts, landing cards, `FloorPlanModal` retired); (2) Lamps and Zones in the shell; (3) ceiling and wall views in 2D, 3D picking, wall-mounted editing, planes on walls and the ceiling, with the guv-calcs wall-plane support done alongside or first; (4) the summary with toggles, plus the ceiling tile grid and items. Each step should leave a working app.
- Component boundaries and names; how the 2D pane hosts floor, ceiling and wall views.
- Snap step, axis-lock angle, the double-click versus drag thresholds.
- The exact projection and fading rules in wall views.
- Test plan: port the `FloorPlanModal` tests to the new components; update the e2e specs that open the Plan pop-up or use the sidebar steps.
- `CHANGELOG.md` `[Unreleased]` entries as work lands.

## Settled after the builder check

- **Wall planes** *(user)*: add guv-calcs support for planes on angled walls and custom wall-plane footprints; no restricted interim version. See Constraints.
- **▲/▼ result deltas** *(user)*: dropped.
- **Where loading lands** *(my call)*: **Start designing** opens the editor at Room › Floorplan. **Open a .guv file** and **See an example** land on the summary (a finished setup); clicking a section header opens the editor there. A reload restores what was showing (editor with its stage and part, or summary), persisted with the session like other UI state. "Don't show this again" on the landing behaves as today's start chooser and lands on the summary of the restored project.
- **Lamps and ceiling height** *(user)*: **Stick to ceiling** and **Stick to wall** checkboxes per lamp, set by placement (Downlight: ceiling; Corner, Edge: both; Horizontal: wall). See Lamps. A ceiling-aware Lamp Placer comes later.
- **Display options** *(user)*: a **Display ▾** section on every lamp, zone and structure (see Editor).
- **Ceiling tiles and items** *(my call, show/hide and editor by user)*: planning only; see Room › Ceiling. They do not snap lamps, drive Downlight placement, or affect automatic placement, and they never reach the calculation.
