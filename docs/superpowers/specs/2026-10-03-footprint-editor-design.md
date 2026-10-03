# Object Footprint Editor — Design

Date: 2026-10-03
Status: approved in conversation ("Separate footprint modal")

## Goal

Let a user draw an object's footprint (an extruded polygon) in room coordinates, where the
object stands, with the room outline, floor-plan image, lamps and other objects as context;
and reshape an existing extrusion or convert a box into a polygon the same way.

## Decisions

| Question | Decision |
|---|---|
| Where it lives | A separate `FootprintModal`, opened from "Draw object…" (Objects panel), "Edit footprint…" (object editor, extrusions) and "Convert to polygon…" (object editor, boxes) |
| Canvas | Shared `PlanCanvas.svelte`, extracted from `FloorPlanModal.svelte`: viewport, pan/zoom, grid and rulers, grid + corner snapping with guidelines, draw-by-clicking with the gentle right-angle snap, rubber band and angle wedge, corner/wall drag, midpoint insert, keyboard. The floor-plan modal keeps the reference-image panel and the Set scale / move-plan tools on top of it |
| Coordinates | Drawn in room coordinates. On Apply the footprint is re-expressed in the object's local frame (vertices minus centroid) and the object's position is set to the centroid, matching guv_calcs' convention |
| Rotation | A drawn footprint is stored with yaw 0 (its orientation is baked into the vertices); editing an existing rotated extrusion shows the rotated world footprint and resets yaw to 0 on Apply |
| Shape change | `PATCH /session/objects/{id}` accepts `shape` and `vertices`; the backend rebuilds the guv_calcs object under the same id, carrying name, position, rotation, optics, enabled and (when unchanged) height |
| Side panel | Name, height, reflectance, transmittance, plus the vertex table |
| Validation | Same polygon rules as the room outline (≥ 3 corners, simple, non-zero area); vertices are not clamped to ≥ 0 |

## Data flow

- Create: `FootprintModal` → `project.addObject({ shape: 'extrusion', vertices: local, x: cx, y: cy, z: 0, yaw: 0, … })`.
- Reshape / convert: `project.updateObject(id, { shape: 'extrusion', vertices: local, x: cx, y: cy, yaw: 0 })` → `object-update` → PATCH with shape + vertices → echo (bounding width/length, vertices) applied.
- The store no longer strips `shape` / `vertices` from an update; they travel together.

## Out of scope

Rotating a footprint in the modal (yaw stays editable numerically), per-face optics, undo.
