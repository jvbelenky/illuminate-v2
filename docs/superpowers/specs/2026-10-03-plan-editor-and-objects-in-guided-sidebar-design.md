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

## Section 1 — Step 1: Room, with objects (Phase 1)

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

## Section 2 — Plan editor (Phase 2, to be detailed before building)

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
