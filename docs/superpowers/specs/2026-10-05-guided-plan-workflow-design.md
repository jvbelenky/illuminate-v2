# Guided Plan workflow — design

Date: 2026-10-05. Status: approved in conversation; Phase 1 being built on branch `plan-workflow`.

## Goal

Make the Plan modal the guided way to describe a scene: **Outline → Obstacles → Lamps → Calc zones → Reflectance**, with Next / Back / Done, edits that apply as they are made, and app-wide Ctrl+Z. The sidebar mirrors that order and stays a complete second interface (needed for things awkward to do from above, e.g. wall-mounted upper-room fixtures). The user leaves the modal to see the 3D view and press Calculate.

## Decisions

| Topic | Decision |
|---|---|
| Plan surface | Stays a modal (not a main-viewport mode) — "see how it feels as a modal" first |
| Apply model | Each completed gesture applies immediately through the store / sync queue if valid; no Apply button; Cancel → Done |
| Undo scope | Every scene edit app-wide (modal, sidebar, image placement, add/delete); not results |
| Undo mechanism | Snapshot-diff: store pre-edit scene snapshots, replay the diff through ordinary store mutations |
| Drawing undo | While drawing a polygon, Ctrl+Z removes the last vertex |
| Sidebar order | 1 Room, 2 Obstacles (optional), 3 Lamps, 4 Calc zones (optional), 5 Reflectance (optional) |
| Reflectance | Final step inside the modal, reusing `ReflectanceStep` |
| Skipping | Next on an empty optional step = skip; the "Add obstacles now?" prompt goes |
| Whole-plane zones (Phase 3) | Default on; zone tracks the room outline |
| Volumes (Phase 3) | Own z start/end plus a Floor-to-ceiling toggle like obstacles |
| Calc points (Phase 2) | Placed like lamps, and aimable |
| Elevations (Phase 4) | Front / Side orthographic views in the modal |

## Phase 1 (this branch)

### Undo/redo — `ui/src/lib/stores/history.ts`

- Stack of **scene snapshots** (room, lamps, zones, objects; floor-plan placement lives on the room). Not results, calc state or UI state. Entry = pre-edit snapshot + label ("Move obstacle").
- User-facing store mutations call `history.record(label, key?)` before mutating. Backend echoes, `…FromBackend`, init/load/reinit never record. Replays run under a `replaying` guard and don't record.
- `history.batch(label, fn)` groups multi-call actions into one step. Records with the same coalesce key within ~500 ms merge (slider drags, scroll-step inputs).
- Undo: await `syncQueue.drained()` → push current snapshot to redo → diff target vs current → replay via ordinary mutations (update/add/remove; client-authoritative ids make re-add exact) → results become stale like any edit. Redo symmetric; a new edit clears redo.
- Cleared on New, Load, Reset, reinit, units change. Capped at 100.
- Ctrl/Cmd+Z, Ctrl+Shift+Z, Ctrl+Y globally, ignored when focus is in a text field. Edit menu gets Undo/Redo with labels.

### Guided Plan modal

- `FloorPlanModal` hosted by `+page.svelte` via `openPlan(step, opts)`; sidebar Edit buttons, "Add obstacle…" and the start chooser's "Empty room" route there.
- **No draft copy of the scene.** Outline and obstacles are read from the store; only the gesture in flight is local.
  - Outline: commit on polygon close, vertex/wall drag end, numeric commit — only if valid and different from the stored outline. Invalid outlines render red ("Not saved: walls cross"); the store keeps the last valid one.
  - Obstacles: draw/move/reshape/copy/delete/nudge each commit one store mutation (one undo step). `obstacleDrafts.ts` is retired.
  - Floor-plan image placement/scale commits on gesture end.
- Step rail (Phase 1: Outline → Obstacles → Reflectance), footer Back / Next: \<step\> / Done. Undo/Redo buttons in the toolbar.
- Escape cancels the active gesture, else closes. Closing with an invalid outline asks to keep the last saved one.

### Reflectance step

Side panel hosts `ReflectanceStep`; plan shown read-only; hovering a wall row highlights the wall (floor/ceiling highlight the interior). `ReflectanceSettingsModal` keeps its own Apply and records one undo step.

### Sidebar

Reorder to Room, Obstacles, Lamps, Calc zones, Reflectance. Reflectance gets an "Edit on plan…" entry.

### Testing

Vitest for history (record/undo/redo/coalesce/batch/redo-clear/clear-on-load/no-record-on-echo), diff-replay per entity kind (incl. undoing a room change that nudged obstacles), and modal commit rules. E2E: update room/objects/guided specs for the Apply removal; new `undo.spec.ts`.

## Later phases (own spec each)

- **Phase 2 — Lamps & calc points on plan:** pick a fixture then click to place; default z = ceiling − mounting depth; aim handle on plan with dashed aim line; nudge/height/tilt in the side panel; calc points the same and aimable; fix `LampEditor`'s local `$state` mirroring of aim.
- **Phase 3 — Calc zones on plan:** polygon-drawn planes (height) and volumes (z range + Floor-to-ceiling) via guv-calcs `CalcPlane.from_polygon` / polygon `VolumeGrid`; Whole-plane on by default, tracking the outline.
- **Phase 4 — Elevation views:** Front/Side orthographic views for wall-mounted lamps, vertical planes and z ranges.
