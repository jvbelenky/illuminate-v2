# Workspace Redesign — Round 2 (after trying Phase 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the user's decisions from trying Phase 1:
- a plain 2D grid
- the room dimensions folded away
- the redesigned lamp panel, with a dimmer and Stick to ceiling / Stick to wall
- the structures panel as in the mockup
- a working ceiling designer

**Architecture:** This round builds on the Phase 1 workspace.
- `PlanController` and `PlanPane` handle the 2D side. The editor parts live in `ui/src/lib/workspace/parts/`.
- New per-item display and lamp state is frontend-only. It is kept in the project store, included in the undo snapshot, and round-trips through the `.guv` `illuminate` sidecar (`ui/src/lib/utils/floorplanSidecar.ts`) and the sessionStorage autosave, like `hidden` does today.
- The ceiling designer stores one `ceilingLayout` block in the project. Its tiles are derived from the room, never stored.

**Tech Stack:** Svelte 5 / SvelteKit, TypeScript, Vitest + @testing-library/svelte, Playwright e2e, Three.js via Threlte.

**Spec:** `docs/superpowers/specs/2026-10-21-workspace-redesign-design.md`. The "Addendum, 2026-10-23" section is binding and overrides earlier text. The mockup `docs/superpowers/mockups/2026-10-21-workspace.html` (artifact v53) is the source of truth for look; open it and use the Lamps and Room › Ceiling stages.

## Global Constraints

- `.svelte` files use tabs. Never edit them with the Edit tool or `sed`. Use the Write tool, or a Python helper that replaces an anchor and asserts it occurs exactly once. `.ts` files may use Edit.
- No explanatory sentences in the UI: labels, values and chips only.
- Every scene edit goes through the project store (directly or through `PlanActions`). A finished gesture is one undo step.
- Units: always the project's units. Never hard-code feet; scale defaults via `UNIT_INFO` / `fromMeters`.
- Colours: `--color-primary` for brand and part tint; `--color-scene-selected` (orange) for selection.
- UI copy, verbatim:
  - Placements: "Downlight", "Corner", "Edge", "Upper-room". "Horizontal" no longer appears anywhere in the UI. The code value `'horizontal'` stays.
  - "Dimmer", "Stick to ceiling", "Stick to wall".
  - Fold-outs: "Geometry", "Display".
  - Structures: "Reference" with the options "Corner" and "Centre".
  - Ceiling: "Tile grid", "Tiles" with the options "None", "2×2", "4×2", "2×4", "Align", "Add to ceiling", "Detector", "Vent", "Sensor", "Keep-out", "Items", "Move grid".
- Scrolling follows today's app. Adding, copying, or selecting an item in 2D or 3D scrolls its row into view (`scrollRowIntoView`). Opening rows or editing fields never moves the scroll.
- Fold-outs use the existing collapsed-disclosure style from the parts (`disc` / "Corners"), and are collapsed by default.
- `CHANGELOG.md` `[Unreleased]` gets user-facing entries in the task that ships them. Commits carry no `Co-Authored-By` trailer.
- Commands:
  - `cd ui && npx vitest run <file>`
  - `cd ui && pnpm test:run`
  - `cd ui && pnpm check` (0 errors)
  - `cd e2e && npx playwright test tests/<file>`

## Review Focus

1. **Old projects and files must still load.** A `.guv` or autosave with no `ceilingLayout`, no stick state and no labels loads with defaults and never throws. A corrupt block drops only that block, as the sidecar already does for `plots`. Test: Task 5 `loads a file without round-2 fields`.
2. **Undo covers the new state.** Ceiling item add/move/delete, stick toggles and label toggles are each one undo step, and undo restores them exactly. Tests: Tasks 4 and 5.
3. **Sticking never fights the user.** A manual drag or a typed position that leaves the surface unchecks the matching box instead of snapping back. A Height change moves only ceiling-stuck lamps, in the same undo step as the Height change. Test: Task 4 `typing Z unsticks from the ceiling`.
4. **Ceiling items in an L-shaped room.** Tiles and items stay clipped to, or kept inside, the outline. Snapping uses the aligned grid, including after Move grid. Test: Task 5 `tiles are clipped to an L-shaped outline`.
5. **Pictogram labels at 300 px.** All four placement labels are readable, with no ellipsis, in the editor column at its 300 px default. Test: Task 3, a DOM check that no label has `text-overflow` clipping, plus a screenshot in the report.

---

### Task 1: Plain 2D grid

**Files:**
- Modify: `ui/src/lib/components/PlanCanvas.svelte`:
  - Out-of-bounds shading, around lines 820-825 (`class="outside"`)
  - Grid and ruler labels, around 828-850
  - The zoom controls stay.
- Test: `ui/src/lib/components/PlanCanvas.test.ts`, or `ui/src/lib/plan/PlanPane.test.ts` if PlanCanvas has no test file.

**Interfaces:** none new. Existing behaviour is unchanged: pan, zoom, snapping, pointer mapping, bottom-left anchoring.

- [ ] **Step 1:** write failing tests:
  - `draws no ruler labels and no outside shading`: no `rect.outside`, and no ruler `<text>` along the edges
  - `keeps minor and major grid lines`: lines every unit and stronger lines every 5 units, per the mockup
  - `keeps the zoom buttons`
- [ ] **Step 2:** run, and confirm they fail.
- [ ] **Step 3:** remove the rulers, their labels and the outside shading. Make the grid match the mockup: minor lines at low opacity and a stronger line every 5 units, with no axis labels.
- [ ] **Step 4:** run the PlanCanvas, PlanPane and parts tests and `pnpm check`. All pass.
- [ ] **Step 5:** commit `feat(plan): the 2D view shows a plain grid, without rulers or outside shading`, with a CHANGELOG entry.

---

### Task 2: Floorplan dimensions folded under Geometry

**Files:**
- Modify: `ui/src/lib/workspace/parts/FloorplanPart.svelte`
- Test: `ui/src/lib/workspace/parts/parts.test.ts`

**Interfaces:**
- **Visible by default:** Floor area, Volume, the floor plan image block (with Set scale…), and Start from.
- **▸ Geometry, collapsed:** the Width / Length / Height / Units row (same behaviour as today, including Width and Length disabled for polygon rooms), then the existing Corners table. The table moves inside Geometry; there is no separate "Corners" disclosure any more.

- [ ] **Step 1:** write failing tests:
  - `dimensions are folded under Geometry by default`: no Width input until Geometry is opened
  - `Geometry holds W/L/H/Units and the corners`
  - `area and volume stay visible`
- [ ] **Step 2:** run, and confirm they fail.
- [ ] **Step 3:** implement with a Python helper or the Write tool. Update any e2e helper that reads the room inputs (`e2e/helpers/room.ts`, `workspace.ts`) so it opens Geometry first.
- [ ] **Step 4:** run the parts tests, the touched e2e specs (`room.spec.ts`, `guided.spec.ts`) and `pnpm check`.
- [ ] **Step 5:** commit `feat(workspace): room dimensions fold away under Geometry; drawing comes first`, with a CHANGELOG entry.

---

### Task 3: Lamp panel redesign (layout, dimmer, pictograms)

**Files:**
- Create: `ui/src/lib/workspace/parts/PlacementPictogram.svelte`. Props: `{ mode: PlacementMode }`. It renders the mockup's `placeIcon(mode)` SVG: a top-down room with the lamp dot and its beam.
- Modify: `ui/src/lib/components/LampEditor.svelte` (layout only, through a Python helper).
- Modify: `ui/src/lib/workspace/parts/LampsPart.svelte`. The Add lamp card uses `PlacementPictogram`, and the "Horizontal" label becomes "Upper-room".
- Modify: any other UI text that says "Horizontal" for a placement.
- Tests: `ui/src/lib/components/LampEditor.test.ts`, `parts.test.ts`

**Interfaces:**
- **LampEditor, top to bottom:**
  - The existing fixture selection (lamp type, select lamp, with **Details…** beside it), laid out to fit 300 px.
  - **Dimmer:** a range input from 0 to 100 plus a number box and "%". It reads and writes `scaling_factor` as a fraction (slider at 100 means 1.0). Values are clamped to 0–100, and the edit commits on change as one undo step.
  - **Placements:** one row of four buttons (`button.placement[data-mode]`), each a `PlacementPictogram` with a label under it: Downlight, Corner, Edge, Upper-room. They call today's `applyPlacement(mode)`, keeping its cycling behaviour. No "Place" label.
  - **Stick to ceiling / Stick to wall** checkboxes. Task 4 wires them; render them disabled until then, or include them in Task 4.
  - **▸ Geometry, collapsed:**
    - "Position" X/Y/Z, then today's pick button (`button.pick-position`) at the right end of the row.
    - "Aim point" X/Y/Z, then its pick button (`button.pick-aim`) at the right end.
    - Tilt, Orientation and Rotation, all visible together with no mode switch. Each is a validated number field; tilt and orientation write the aim through today's tilt/orientation math.
  - **▸ Display, collapsed:** Show label and Show photometric web.
  - **Removed:** the aim-preset buttons (Down/Corner/Edge/Horizontal), and the "Set Tilt/Orientation" / "Set Aim Point" mode switch.
- At the 300 px editor width nothing is clipped. Review Focus 5 applies.

- [ ] **Step 1:** write failing tests:
  - `dimmer writes scaling_factor`: setting 50 calls `updateLamp(id, { scaling_factor: 0.5 })`
  - `placement pictograms re-place the lamp`, for each of the four modes
  - `Geometry and Display are collapsed by default`
  - `no aim-preset row`
  - `no placement label is clipped`
  - `the Add lamp card says Upper-room`
- [ ] **Step 2:** run, and confirm they fail.
- [ ] **Step 3:** implement. Keep LampEditor's store-direct behaviour and pick-mode flow.
- [ ] **Step 4:** run the LampEditor, parts and PlanPane tests, `pnpm check`, and the e2e specs that touch lamps (`plan-lamps`, `fixture-editor`, `lamp-instance-source`, `workflow`). Update e2e selectors that relied on the removed controls.
- [ ] **Step 5:** commit `feat(lamps): redesigned lamp panel: dimmer, placement pictograms, Geometry and Display fold-outs; Horizontal is now Upper-room`, with a CHANGELOG entry. Attach a 300 px screenshot (Playwright against the dev server) to the report.

---

### Task 4: Stick to ceiling / Stick to wall

**Files:**
- Modify: `ui/src/lib/types/project.ts`. Add frontend-only lamp fields:
  - `stick_ceiling?: boolean`
  - `ceiling_offset?: number`, the distance below the ceiling in project units
  - `stick_wall?: boolean`
  - `wall_index?: number`
  - `wall_t?: number`, the position along the wall, kept as distance from the nearer end
  - `wall_offset?: number`
- Create: `ui/src/lib/utils/lampSticking.ts`, holding pure functions:
  - `attachCeiling(lamp, roomZ)`
  - `attachWall(lamp, vertices, offset?)`
  - `applySticking(lamps, room): Array<{ id, x, y, z, aim_x, aim_y, aim_z }>`, giving the positions to apply after a room change
  - `stickByPlacement(mode)`, returning `{ stick_ceiling, stick_wall }`
- Modify: `ui/src/lib/stores/project.ts`:
  - `updateRoom` applies `applySticking` in the same history step when Height or vertices change.
  - Manual position edits clear the matching flag.
  - The undo snapshot includes the new fields.
  - Session save and load round-trip them.
- Modify: `ui/src/lib/utils/floorplanSidecar.ts`. Add an optional `lamps: Record<string, { stick_ceiling?, ceiling_offset?, stick_wall?, wall_index?, wall_t?, wall_offset? }>` entry, saved and extracted like `hidden`, and applied after load.
- Modify: `LampEditor.svelte` (checkboxes) and wherever placements are applied (`addPlacedLamp` in `+page.svelte`, `applyPlacement` in LampEditor) to set the flags through `stickByPlacement`:
  - downlight → ceiling
  - corner and edge → ceiling and wall
  - horizontal → wall
- Tests:
  - `ui/src/lib/utils/lampSticking.test.ts`
  - store tests in `ui/src/lib/stores/project.test.ts`, or a new `project.sticking.test.ts`
  - `floorplanSidecar.test.ts`

**Behaviour** (spec, Lamps › Sticking; Review Focus 3):
- **Ceiling-stuck:** keeps `ceiling_offset` when the Height changes. If its aim is level (`aim_z === z`), the aim moves with it.
- **Wall-stuck:** keeps its distance from the nearer end of its wall and its offset when the outline changes, so a corner lamp stays in its corner. If its wall disappears, `stick_wall` clears.
- **Checking a box by hand:** Stick to ceiling places the lamp `ceiling_offset` below the ceiling (default 0.1 m converted to the project's units, or its current distance if it's already near). Stick to wall attaches to the nearest wall at its current offset.
- **Unchecking:** typing Z, or dragging the lamp's height in any view, clears `stick_ceiling`. Typing X/Y, dragging it on the plan, or arrow-nudging clears `stick_wall`.

- [ ] **Step 1:** write failing tests:
  - `lampSticking`: `ceiling-stuck lamp follows a Height change`, `corner lamp stays in its corner when the outline grows`, `wall removed unsticks`
  - store: `Height change and lamp follow are one undo step`, `typing Z unsticks from the ceiling`, `placement sets the flags`
  - sidecar: `round-trips stick state`, `loads a file without round-2 fields`
- [ ] **Step 2:** run, and confirm they fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run the touched tests, `pnpm test:run` and `pnpm check`.
- [ ] **Step 5:** commit `feat(lamps): Stick to ceiling and Stick to wall: lamps follow the ceiling height and their walls`, with a CHANGELOG entry.

---

### Task 5: Structures panel as in the mockup, with structure labels

**Files:**
- Modify: `ui/src/lib/components/ObjectEditor.svelte` (through a Python helper).
- Modify: `ui/src/lib/components/SceneObject3D.svelte`. Draw a name label when the structure's label is on, in the same style as the lamp labels.
- Modify: the project store and `floorplanSidecar.ts`. Store a frontend-only label set `labels: { objects: string[] }` like `hidden`. Include it in the undo snapshot, the sidecar and the session.
- Tests: `ObjectEditor.test.ts`, `floorplanSidecar.test.ts`, store test

**Interfaces** (spec addendum and mockup):
- **Visible:** Bottom, Top and Floor to ceiling.
- **▸ Geometry, collapsed:**
  - X and Y, with a **Reference** select (Corner / Centre, default Centre). Corner means the corner where width and length start, rotated with the structure.
  - Width and Length, measured along the structure's own sides. Changing either keeps the reference point fixed; on a custom footprint it scales the shape.
  - Rotation (yaw), Pitch and Roll.
  - The Corners X/Y table, for polygon footprints, editing world corners.
- **▸ Display, collapsed:** Show label.
- **Removed:** the shape line, the "Edit on plan…" button, the Surfaces block, the hint sentences, and the Delete/Copy/Close footer (the 2D toolbar and keys already cover these). The ObjectEditor delete-confirm dialog goes too; undo covers deletes.

- [ ] **Step 1:** write failing tests:
  - `only Bottom/Top/Floor to ceiling are visible by default`
  - `Reference Corner reports the start corner and keeps it fixed when Width changes`
  - `Centre keeps the centre fixed`
  - `Show label toggles the structure's label and is one undo step`
  - `loads a file without round-2 fields`
- [ ] **Step 2:** run, and confirm they fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run the touched unit tests, `objects.spec.ts` e2e (update selectors), and `pnpm check`.
- [ ] **Step 5:** commit `feat(structures): structure panel as in the mockup: Geometry and Display fold-outs, Corner/Centre reference, labels`, with a CHANGELOG entry.

---

### Task 6: Ceiling designer: model, panel and 2D editing

**Files:**
- Create: `ui/src/lib/ceiling/ceilingLayout.ts`, which holds the types and pure functions:
  - `interface CeilingLayout`:
    - `tileSize: 'none' | '2x2' | '4x2' | '2x4'`
    - `align: 'tl' | 'tr' | 'bl' | 'br' | 'c'`
    - `offset: [number, number]`
    - `ceilingShown: boolean`
    - `tilesShown: boolean`
    - `itemsShown: boolean`
    - `items: CeilingItem[]`
  - `type CeilingItem`, a union of two shapes:
    - a point item: `{ id: string; kind: 'smoke' | 'vent' | 'sensor'; name: string; x: number; y: number; hidden?: boolean }`
    - a keep-out area: `{ id: string; kind: 'keep'; name: string; vertices: Vertex[]; yaw: number; hidden?: boolean }`
  - `DEFAULT_CEILING_LAYOUT`: defaults of 2×2, `tl`, offset [0,0], everything shown, no items.
  - `tileSizeIn(units, tileSize): { tw: number; th: number }`, from feet (2 ft = 0.6096 m), in the project's units.
  - `tileGrid(layout, vertices, units): { tw: number; th: number; ox: number; oy: number }`. The origin follows the alignment (a corner of the bounding box, or a tile centred on the room for `c`) plus `offset`.
  - `tileLines(grid, bbox)`
  - `snapToTileCentre(x, y, grid)`
  - `newItem(kind, room, layout, units)`: in the middle of the room, snapped; a keep-out is a 1.2 × 0.6 m rectangle in the project's units.
- Modify: the project store:
  - `ceilingLayout` state, plus actions `updateCeiling(partial)`, `addCeilingItem(kind) → id`, `updateCeilingItem(id, partial)`, `removeCeilingItem(id)` and `copyCeilingItem(id) → id`, each one undo step.
  - Include it in the undo snapshot, the session autosave and the sidecar (`ceilingLayout` entry, with zod validation that drops only a bad block).
- Modify: `ui/src/lib/workspace/parts/CeilingPart.svelte`, following the mockup's Ceiling panel exactly:
  - The "Ceiling" heading with its eye (`ceilingShown`), then Height.
  - The bordered **Tile grid** card, with an eye when tiles are on:
    - **Tiles** as None / 2×2 / 4×2 / 2×4 pills.
    - **Align** as five pictograms (a dot on a small ceiling: four corners and centre), with a tooltip on each. Picking one resets `offset`.
  - The **Add to ceiling** card, styled like Add lamp, with four buttons: Detector, Vent, Sensor, Keep-out. Each adds one item, selects it and scrolls its row into view.
  - **Items:** an eye for all items, then compact rows with icon, name (pencil to rename) and an eye each. The open row shows its fields directly:
    - X and Y for detectors, vents and sensors.
    - For a keep-out area: X/Y with Reference, Width, Length, Rotation and the Corners table.
- Modify: `PlanController` and `PlanPane`, in the `ceiling` context:
  - Draw the tile grid, clipped to the room outline, plus the items.
  - Point items drag to move and snap to tile centres while tiles are shown; Alt places freely.
  - Keep-out areas edit like a structure footprint: drag the body, drag corners, "+" midpoints, double-click to add or remove a corner.
  - Toolbar:
    - with nothing selected and tiles shown: **Move grid**, which drags `offset`
    - with an item selected: Copy and Delete
  - Keys: Delete removes the item and Ctrl+D copies it, guarded by `planShouldHandleKey`.
  - Selecting an item in 2D scrolls its row into view.
- Tests:
  - `ui/src/lib/ceiling/ceilingLayout.test.ts`
  - `parts.test.ts` (CeilingPart)
  - `PlanPane.test.ts` (ceiling context)
  - store and sidecar tests

- [ ] **Step 1:** write failing tests:
  - layout: `tile size in metres and feet`, `alignment origins (corners and centre)`, `Move grid offset shifts the origin`, `snap to tile centre`, `tiles are clipped to an L-shaped outline`
  - store: `add/move/remove/copy are each one undo step`, `round-trips through the sidecar`, `loads a file without round-2 fields`
  - CeilingPart: `Add to ceiling adds, selects and scrolls`, `Align resets the grid offset`, `the open item's fields are shown directly`
  - PlanPane: `dragging a detector snaps to a tile centre`, `Alt places freely`, `Move grid drags the grid`, `Delete removes the selected item`
- [ ] **Step 2:** run, and confirm they fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run the touched tests, `pnpm test:run` and `pnpm check`. Add one e2e spec, `e2e/tests/ceiling.spec.ts`: add a detector and a keep-out area, drag the detector, save and reload, and check they come back.
- [ ] **Step 5:** commit `feat(ceiling): ceiling designer: tile grid, detectors, vents, sensors and keep-out areas, saved with the project`, with a CHANGELOG entry.

---

### Task 7: Ceiling designer in 3D

**Files:**
- Modify: `ui/src/lib/components/Room3D.svelte`, or a new `ui/src/lib/components/Ceiling3D.svelte` rendered from the scene. Draw the ceiling layout on the ceiling plane:
  - tile lines
  - detectors as small discs
  - vents as small squares
  - sensors as small cones
  - keep-out areas as a translucent red outline and fill
  
  Use the item colours from the mockup: warning yellow for point items, danger red for keep-out areas.
- Honour the three eyes:
  - `ceilingShown` off removes the ceiling surface, its tiles and its items from 3D, and from 3D picking if any applies.
  - `tilesShown` hides the tile lines.
  - `itemsShown` hides all items, and each item's own `hidden` hides just that item.
  - The selected item (in the Ceiling part) shows in the selection colour.
- Tests: a Scene or Room3D unit test, where feasible with the existing Threlte mocks, asserting which meshes render for given flags. Otherwise, a Playwright screenshot check in the report.

- [ ] **Step 1:** write failing tests for flag-driven rendering.
- [ ] **Step 2:** run, and confirm they fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run `pnpm test:run`, `pnpm check` and the full e2e suite.
- [ ] **Step 5:** commit `feat(ceiling): the ceiling layout shows in 3D, with its visibility toggles`, with a CHANGELOG entry.

---

### Task 8: Zones tab — Add zone first, standard zones folded away

**Files:**
- Modify: `ui/src/lib/workspace/parts/ZonesPart.svelte`
- Test: `ui/src/lib/workspace/parts/parts.test.ts`
- Update any e2e helper or spec that clicks "Use standard zones" or the standard rows (`e2e/helpers/zones.ts` and others found by grep), so it opens the fold-out first.

**Interfaces** (spec addendum, "Zones tab order"):
- **Order, top to bottom:**
  - the **Add zone** card (Plane · Volume · Point)
  - the user zone rows, with new zones appended at the end, still above the standard zones
  - a collapsed fold-out titled **"Standard zones"**, in the same disclosure style as Geometry and Display, holding:
    - the "Use standard zones" checkbox
    - the standard zone rows (shown while the box is checked)
- **Default:** the fold-out is closed. Opening and closing it doesn't change `useStandardZones`.
- **Selecting a standard zone:** if one gets selected while the fold-out is closed (for example, by clicking it in 3D), open the fold-out so its row can be scrolled into view.

- [ ] **Step 1:** write failing tests:
  - `Add zone comes before the zone list and the Standard zones fold-out`
  - `Standard zones is collapsed by default and holds the checkbox and rows`
  - `a new zone appears above the Standard zones fold-out`
  - `selecting a standard zone opens the fold-out`
- [ ] **Step 2:** run, and confirm they fail.
- [ ] **Step 3:** implement with a Python helper or the Write tool.
- [ ] **Step 4:** run parts, EditorPanel and SummaryPanel tests, `pnpm check`, and the e2e specs that touch zones.
- [ ] **Step 5:** commit `feat(zones): Add zone comes first; standard zones fold away`, with a CHANGELOG entry.

---

### Task 9: 2D navigation — Hand and Zoom modes, touch

**Files:**
- Modify: `ui/src/lib/components/PlanCanvas.svelte`:
  - the zoom controls around lines 953-956
  - the wheel handler around 439-460
  - pan and Space handling around 391-437
  - background drag
- Modify: `ui/src/lib/stores/settings.ts`, adding a `planNavMode: 'hand' | 'zoom'` field with default `'hand'`.
- Tests: `ui/src/lib/components/PlanCanvas.test.ts`, `settings.test.ts`

**Interfaces** (spec addendum, "2D view navigation"):
- **The corner control** is two toggle buttons, `button.nav-mode[data-mode="hand"|"zoom"]` with `aria-pressed`, replacing + / − / Fit. Each has an icon (hand, magnifier) and a tooltip, and the pair sits where the zoom buttons were.
- **Wheel:**
  - In Hand mode, `deltaX`/`deltaY` pan the view.
  - In Zoom mode, `deltaY` zooms about the pointer, with the same factor and clamps as today's Ctrl+wheel zoom.
  - `ctrlKey` or `metaKey` (which includes trackpad pinch) always zooms.
- **Background drag on empty space**, meaning not on an item, handle, corner, shape or marker, and only while no draw or custom tool is active:
  - In Hand mode, it pans.
  - In Zoom mode, it draws a dashed rectangle and on release fits the view to that rectangle. A rectangle under 4 px counts as a click and does nothing.
  
  Where hosts already use background drag (the marquee for lamp box-select in the Lamps context), Shift + drag keeps the marquee, and a plain background drag follows the mode.
- **Fit:** double-click on empty space, or the F key (guarded by `planShouldHandleKey`), calls `fitView()`.
- **Touch** (pointer events with `pointerType === 'touch'`):
  - Track the active pointers.
  - Two pointers do pinch-zoom about their midpoint and pan by the midpoint's movement.
  - One pointer on empty space follows the mode, like a mouse drag.
  - One pointer on an item edits it, as today.
  - A double-tap on empty space fits.
  - Set `touch-action: none` on the svg so the browser doesn't scroll the page.
- **Unchanged:** Space + drag and middle-drag pan, and editing drags on items work as today.

- [ ] **Step 1:** write failing tests:
  - `Hand: wheel pans`
  - `Zoom: wheel zooms about the pointer`
  - `Ctrl+wheel zooms in either mode`
  - `Hand: background drag pans`
  - `Zoom: background drag zooms to the box`
  - `double-click empty space fits`
  - `F fits`
  - `two-finger touch pinch zooms and pans`
  - `the mode persists in userSettings`
  - `the +/-/Fit buttons are gone`
- [ ] **Step 2:** run, and confirm they fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run PlanCanvas, PlanPane and parts tests, `pnpm check`, the full UI suite, and the e2e specs that use the zoom buttons or wheel (grep `Fit` and `zoom` in `e2e/`).
- [ ] **Step 5:** commit `feat(plan): Hand and Zoom modes for the 2D view decide what scrolling does; touch pinch and pan`, with a CHANGELOG entry.

