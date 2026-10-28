# Zones, surfaces and docking, Round 3: rulings and deferred items

Round 3 of the workspace redesign: spec `docs/superpowers/specs/2026-10-27-zones-surfaces-docking-design.md`.

Branch `plan-workflow`, after round 2 (3ed69d3). Covers dock panels, the surface switcher, wall views and their editing, 3D surface picking, planes on surfaces and the rebuilt zone editor.

## Rulings made during the round

Each line says what was decided, why, and what it costs if the call was wrong.

**API: wall planes**
- A legacy XZ plane covering the full south wall reports `vertices is None` (R1). The interface says None for a full-wall region. Cost: one assertion.
- A PATCH carrying `wall` ignores height, ref_surface, x1..y2 and direction instead of returning 400. The UI may send a full state alongside `wall`, and `wall` fully defines the geometry. Cost: a client mistake goes unnoticed.

**Plan: wall views**
- Wall views are drawn as seen from inside, per the binding spec. Canvas x = length - along; the left label is the next wall (i+1), the right label the previous (i-1). Stored data (`wall_vertices`, `wall_t`) stays in along-from-vertex-i, and one pair of helpers in `wallProjection.ts` converts. The plan text said along on the left; the spec wins. Cost: a mirror flag in one helper.
- `encodeT` (and `decodeT`) are exported from `lampSticking.ts` so the stuck-lamp slide signs `wall_t` the same way (R3). Cost: none.

**Docking**
- A flow that needs a view switches the main view to it: pickMode set while the 3D mini is showing makes 3D main; a plan draw, place or edit request while the 2D mini is showing makes 2D main. The spec makes the mini view-only, and a silent dead end is worse. Cost: an unexpected view switch, which the 2D | 3D control undoes.

**3D picking**
- 3D item clicks select only in their own step (lamp in Lamps, structure in Structures, zone in Zones); elsewhere a click picks a surface, as the binding spec says. The old cross-step jump is dropped. Cost: restore the jump for items outside their step in `chooseClickTarget`. The user is to confirm.

**Zones**
- `ZonePanel` takes an extra `controller: PlanController` prop, used by Draw / Fit and the surface labels (R2). Cost: prop plumbing.
- The stale-3D gap (`dimensionsMatch` ignoring surface, normal_offset, flip and wall_vertices) is fixed in this round, because the zone editor now exposes offset and flip. Cost: none.

## Fixed in the final review

- Whole-wall planes follow the room in the backend: `followSurfaces` and the undo resend send `wall_vertices` present and undefined (sync: `vertices: null`) for a fit or outline-less wall plane.
- A plane whose wall is gone is marked `wall_orphan` (frontend-only, carried with the zone): drawn on no wall, opens on Floor, flagged in the audit, never sent a `wall`. Choosing a surface, Fit, Draw or a floor geometry edit re-binds it (to the floor unless a surface is chosen). Walls are matched by line and overlap (`matchWall`), so rect -> L keeps the north plane on its surviving half.
- Nudge-into-bounds skips wall planes in the API and the UI ignores any nudged wall plane; the outline-outside test asserts the outline survives.
- The plot window draws a wall plane with Along / Up axes, mirrored as seen from inside, rows by `flip` (`wallPlotAxes`, `planeGrid(..., mirrorU)`).
- Delete and Ctrl+D act on a plane selected on its wall in Zones (arrows stay off).
- `distancePartial` / `flipPartial` pin the current surface on a plane with none stored.
- ZonePanel cancels a zone pick on destroy and on a zone change, and ignores a result for another zone type; a pick is cancelled when 3D stops being the main view.
- A drawn floor plane starts at eye height (1.8 m in the project's units).
- Exposure-time and numeric-volume tests ported to `ZonePanel.test.ts`; CHANGELOG 3D-click wording.

**Rulings**
- Orphan re-binding by a floor geometry edit (Height, Flip, Fit, Draw) puts the plane on the floor through a recreate; its old wall-only fields are not sent. Cost if wrong: the edit could instead be refused until a surface is chosen.
- An orphaned plane is not drawn in 3D (the frontend has no geometry for it). Cost: a row with no 3D shape until re-bound.

## Deferred items

**API**
- `wall_plane.py:355` vs `:372`: vertical and parallel tolerances are inconsistent (sine 1e-6 vs about 1.4e-3 rad).
- `from_wall_region` stores a unit `u_vec`, `from_wall` the raw edge vector (coordinates identical).
- `CalcPlane.from_wall_region` does not lower-case the wall id as `from_face` does.
- `wall_planes.py:321` raises KeyError on `faces[frame.wall_id]` rather than using `.get`.
- `_covers_wall` lacks a near-full-region test; the nudge `wall` field is untested.
- PATCH with an unknown wall id (400) is untested.

**Room and zone sync**
- Leave-wall recreate trusts the caller for flat geometry; a legacy XZ plane keeps `ref_surface` 'xz' (only undo reaches it, as there is no UI to move a plane between surfaces).
- A queued legacy zone-update ahead of a leave-wall type change can 400 once (the recreate repairs it).
- `wallFieldsOf` drops vertices silently on an unknown wall id; add a console.warn.
- A corner inserted mid-wall re-attaches the plane to the larger part of its wall, so a whole-wall plane shrinks silently.
- `audit.ts:100` guard and cast exist only for old test inputs.

**Standard zones and hidden items**
- The reset test no longer proves a user-hidden item is cleared (it hides a nonexistent 'L1').
- Turning standard zones off leaves their ids in `hidden`.

**Docking**
- `SETTINGS_DEFAULTS.workspaceDock` aliases `DEFAULT_DOCK` (latent shared mutation).
- Dragging: no teardown on destroy mid-drag, no Escape or `lostpointercapture` cancel, no `preventDefault` against text selection, `pointercancel` untested.
- A read-only mini 2D does not draw selected point zones.
- Swapping 2D between main and mini remounts the plan canvas, so pan and zoom are lost (deferred, not fixed).

**Plan and surface switcher**
- PlanPane surface row has hard-coded `padding-left: 7rem` and does not wrap (fine at 1440).
- Ceiling context and switcher surface can disagree (context 'ceiling', surface floor).
- A stored wall surface revives if the outline grows back; no test that the switcher's wall options update after an outline edit.

**Wall views**
- The editable wall canvas omits `highlightedLampIds`; rulers count from the right end (mirror); `wallView` uses non-null assertions.
- A structure move has no clamp of top to room height; far lamps are draggable (no opacity gate).
- Wall-canvas snapping is off-grid in along.
- Copying a wall plane stacks it on top of the original.
- `planeWorldCorners` has no production caller.
- Draw with a plane selected redraws its outline, and the toolbar title "Draw a plane on this surface" is misleading in that case (user to confirm).

**3D picking**
- `facesCamera` sign logic is untested.
- Hover fill is not suppressed in report capture.
- Invisible pick meshes still draw.
- The `openStep` jump in `processClickBatch` is now dead code.
- A missed 3D click in Lamps, Zones or Structures picks a surface, and `setSurface` clears the selection (user to confirm).

**Staleness**
- `wall_vertices` exact-equality staleness may grey out on float drift after a unit change.
- The draft guard runs only at select time (check that `setSurface` clears it).

**Zone editor**
- The plot-settings e2e dropped its editor-to-plot-window display-mode check.
- From wall has no upper bound.
- Undoing an orphan's re-bind to the floor restores the store's wall fields, but the backend keeps the floor plane (its old wall geometry is not known to the frontend).
