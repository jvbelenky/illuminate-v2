# Objects, the Plan editor, and the guided sidebar — design

**Date:** 2026-10-03
**Status:** Approach A approved; Phase 1 built for feel on `worktree-guided-sidebar`
**Builds on:** `2026-09-18-guided-sidebar-design.md`, `2026-10-02-objects-design.md`,
`2026-10-03-footprint-editor-design.md`

## Goal

Objects (desks, partitions, cabinets), the room outline, the floor-plan image and, later,
polygon calc planes should feel like one spatial model edited with one gesture, and sit
naturally in the three-step guided flow. Decision: objects are part of *describing the
room*, so they live in step 1.

## Phasing

1. **Sidebar integration** (this round). Objects into step 1, plan thumbnail with footprints,
   height as bottom/top or floor-to-ceiling, summaries. The two existing modals stay.
2. **Plan editor.** One modal on `PlanCanvas` with a layer rail: Outline, Objects, (Calc
   planes). Replaces `FloorPlanModal` + `FootprintModal` as entry points; their internals
   become layer hosts.
3. **Calc planes layer**, once guv-calcs accepts a polygon on a `CalcPlane`. UI is specced
   against an assumed `vertices` field on plane zones; the guv-calcs change is the user's.

## Revision 2026-10-04 (user feedback, supersedes Section 1's placement)

The guided sidebar is five numbered steps in build order:

1. **Room** — dimensions, units, floor plan (open by default).
2. **Objects** (optional) — list + one **Add object…** button that opens the footprint editor in
   draw mode. No "Add box"; boxes only arrive from files.
3. **Reflectance** (optional) — Enable reflections, **Walls…** (per-wall modal) with a summary
   of the wall value, and an R / T pair per object (`ReflectanceStep.svelte`). Reflections leave
   `RoomEditor`.
4. **Lamps** (open by default).
5. **Calc Zones** (optional).

Also from the same round: Calculate stays top-right of the 3D view (no sidebar step); the
next-step card is gone and its one-line hint lives in the status bar; the start chooser's
typical room is 13 × 20 × 9 ft with a bare Ushio B1 and "Empty room" opens the floor-plan
editor at once. Expert layout: the same five sections, flat.

## Section 1 — Step 1: Room, with objects (Phase 1, as first built)

Collapsed summary: `4 × 6 × 2.7 m rectangle, 3 objects` (`no objects` when empty).

Open, top to bottom:

- **Plan thumbnail**: outline, floor-plan image faintly when present, object footprints.
  Click or "Edit plan…" opens the floor-plan modal (Phase 2: the Plan editor, Outline layer).
- **Dimensions** X / Y / Z + units (unchanged).
- **Objects**: compact list, one row per object: name, height glyph text ("floor to
  ceiling" or "0.7 to 1.5 m"), reflectance ("R 0.10"). Row click opens the inline object
  editor. Under the list: **Draw object…** (footprint modal in create mode; Phase 2: Plan
  editor, Objects layer, drawing) and **Add box** (default box at the room centre).
- **Reflections**: existing checkbox + "Walls…" (wall reflectance modal). Wall reflectance
  stays per wall; object reflectance stays on the object.

**Object editor** (inline): name; shape line ("Box 1.0 × 0.6 m" / "Polygon, 5 corners") with
"Edit footprint…"; **Height**: "Floor to ceiling" toggle; when off, **Bottom** and **Top**
fields in room units; Position X, Y (Z is Bottom); Rotation; Reflectance, Transmittance;
Include / Delete / Copy; pitch and roll under Advanced.

**Height model.** guv-calcs stores base `z` and `height`; the UI shows `bottom = z`,
`top = z + height`. "Floor to ceiling" is *derived*: `bottom ≈ 0` and `top ≈ room.z`
(tolerance 1e-6 in room units). Turning it on sets `z = 0, height = room.z`. When the
room height changes, the store re-sends `height = room.z` for every object that was
floor-to-ceiling before the change, so the flag survives without being stored. A `.guv`
round-trip therefore needs no new field.

**Next-step engine**: objects are optional; no new states. Position warnings for objects
already flow through the audit.

**Expert layout**: objects keep a flat panel of their own below Calc Zones (as on main).

## Section 2 — Plan editor, Obstacles layer (Phase 2, approved 2026-10-04, built)

**Shape.** `FloorPlanModal` becomes the Plan editor (title "Plan") with a layer rail:
Outline (everything it did before) and Obstacles. Step 1's Edit opens Outline; step 2's
"Add obstacle…" opens Obstacles with Draw armed; an obstacle row's "Edit on plan…" opens
Obstacles with that obstacle selected. The Edit → Add Obstacle menu item does the same as
"Add obstacle…". `FootprintModal` is deleted.

**Canvas (`PlanCanvas`).** One editable `draft` as before; the host swaps what it holds
when the layer changes (outline draft ↔ the selected obstacle's world footprint). New:
- `shapes: PlanShape[]` (`id, vertices, name, selected, dimmed`) rendered as filled
  polygons with a name label; `onShapeClick(id)` when the edit tool is active (while
  drawing, shapes are inert so corners can be placed over them).
- `draggableBody`: a pointer-down inside the draft polygon moves it whole (snapped so the
  first corner lands on the grid) instead of panning.
- `nudge(dx, dy)` translates the draft; the host maps arrow keys to it.

**Obstacles layer state (in the modal).** `obstacles: ObstacleDraft[]` (world vertices,
name, z, height, R, T, enabled, source shape/yaw, key), `selectedKey`, `drawArmed`,
`preset`. Draw: `startDraw()` clears the draft; `onDrawEnd(true)` turns the polygon into a
new draft from the preset and, while armed, starts the next one. Esc: cancel drawing /
disarm, else deselect, else close. Duplicate: copy offset by one snap step. Delete.
Arrow keys nudge. Side panel: list (name, height text), properties for the selection
(name, floor to ceiling or bottom/top, R, T), Duplicate / Delete, "Corners" disclosure
with the existing vertex table bound to the draft.

**Presets** (name prefix, bottom, top; feet in brackets): Partition (floor to ceiling),
Desk (0–0.75 m [0–2.5 ft]), Cabinet (0–2 m [0–6.5 ft]), Column (floor to ceiling),
Other (0–1 m [0–3 ft]). R and T default to 0.

**Apply.** `FloorPlanApplyResult.obstacles: ObstacleDraft[]`. `RoomEditor` applies the
outline/image as before, then `diffObstacleDrafts(drafts, objects)` → adds (shape
extrusion, local vertices = world − centroid, x/y = centroid, yaw 0), updates (only the
fields that changed; geometry only when the world footprint moved or a box was reshaped),
removes. Cancel discards everything. Validation for Apply: outline valid and every
obstacle a simple polygon with ≥ 3 corners.

**Sidebar editor.** Unchanged except "Edit footprint…" / "Convert to polygon…" become
"Edit on plan…". Pitch, roll and yaw stay there.

**Tests.** `obstacleDrafts.test.ts` (presets, from-objects, diff: add/update/remove,
geometry only when moved); PlanCanvas body drag unit test; e2e `objects.spec` draws through
the Plan editor (helper `addObject`), the L-shape test and the edit-on-plan test target
`.floor-plan-modal`; `FootprintModal.test` removed.

## Section 2 (original sketch, superseded above)

One modal, title "Plan". Left rail: Outline · Objects · Calc planes (hidden until Phase 3).
Reference image upload / Set scale / move live in a toolbar and apply to every layer.
The canvas draft belongs to the active layer; other layers draw as context. Side panel shows
the selected thing's properties: walls + area for the outline; name, bottom/top, R, T for an
object; height + calc mode for a plane. Apply commits every layer's changes in one go
(outline via `setPolygon`, objects via add/update, planes via zone add/update).

## Section 3 — Calc planes layer (Phase 3)

Draw a polygon at a height → plane zone with `vertices`; standard zones stay rectangular
and clipped to the outline. Blocked on guv-calcs.

## Testing (Phase 1)

- Unit: object editor height toggle and bottom/top mapping; store keeps floor-to-ceiling
  objects at the room height after a room `z` change; step-1 summary text.
- e2e: draw an L object from step 1, set it floor-to-ceiling, change room height, verify
  the object's height followed; existing objects e2e keeps passing in expert layout.
