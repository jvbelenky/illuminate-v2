# Zones, Surfaces and Docking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calc planes live on any room surface (floor, ceiling, any wall including angled polygon walls, with drawn outlines). The 2D view switches between those surfaces. The workspace becomes one main view plus draggable, minimizable dock panels. The zone editor is rebuilt to fit the 300 px column.

**Architecture:**
- **guv-calcs** gains a wall-region plane constructor and a reverse "which wall is this plane on" helper. Its generic `SurfaceGrid` (origin, u, v, polygon) already does the maths.
- **The API** gets a `wall` block on zone input and output. It derives wall form for any vertical plane parallel to a wall, which also migrates old XZ/YZ files.
- **The UI** stores `surface` per zone (wall by outline index). It persists that in the `.guv` sidecar and converts index ↔ backend wall id at the API boundary.
- **Docking** is a pure layout model (`dockLayout.ts`) plus `DockArea` / `DockPanel` components and a `ViewHost`. `ViewHost` keeps both views mounted and positions them over the main and mini anchors.

**Tech Stack:**
- guv-calcs: Python 3, numpy, pytest.
- API: FastAPI and pydantic, pytest; `uv run` with the `scripts/guv-calcs.sh` overlay.
- UI: SvelteKit, Svelte 5 runes, TypeScript, Vitest with jsdom, Threlte / Three.js, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-10-27-zones-surfaces-docking-design.md`. It cites `docs/superpowers/specs/2026-10-21-workspace-redesign-design.md` tables "2D surfaces", "Wall view" and "3D picking", which stay binding. Mockups, git-ignored: `.superpowers/brainstorm/515293-1793123103/content/zone-editor-v2.html` and `docking-v3.html`.

## Global Constraints

- Never edit `.svelte` files with the Edit tool or sed. Use a Python helper that asserts each anchor is unique, or the Write tool.
- No Co-Authored-By or other attribution trailers in any commit, in either repo.
- Update `CHANGELOG.md` `[Unreleased]` for user-facing changes in the same commit.
- Minimal UI text: labels, values and chips only. No explanatory notes or help text.
- **Branches and pushing:**
  - illuminate work stays on branch `plan-workflow`; never push it.
  - guv-calcs work goes in a new worktree, `~/guv-calcs/.claude/worktrees/plan-workflow`, on branch `plan-workflow`.
  - guv-calcs commits are laconic, lowercase and one line.
  - guv-calcs: merge to main and push only after `make test` passes, then `make bump-guv-calcs` in illuminate. Never `make release`, never bump `_version.py`.
- **API schema changes:**
  - Regenerate `api/openapi.json` with `cd api && uv run python scripts/export_openapi.py`.
  - Then run `cd ui && pnpm generate:api`, which writes `ui/src/lib/api/generated/api-types.ts`.
- **Persistence:**
  - Frontend-only project state goes in the `.guv` sidecar (`ui/src/lib/utils/floorplanSidecar.ts`). Each block is `.optional().catch(undefined)`, so a bad block drops alone.
  - User layout goes in `userSettings` and is validated at use.
- Every scene edit, including surface changes and drawn wall outlines, is covered by undo (`captureScene` snapshot).
- Standard-zone heights stay meters-authoritative. `UNIT_INFO` is untouched.
- Below 768 px (mobile) the layout keeps today's behaviour.
- Dev servers: UI on :5508, API on :8335 (`make backend` uses the guv-calcs overlay). e2e runs from `e2e/`.
- **Exact UI copy:**
  - "Draw on floor", "Draw on ceiling", "Draw on wall", "Fit to room", "Fit to wall"
  - "Height", "Below ceiling", "From wall", "Flip"
  - "Bottom", "Top", "Position", "Aim at", "Place", "Aim"
  - "Calculation", "Geometry", "Grid points", "Display"
  - "Points", "Spacing", "Inset", "On edge"
  - "Floor", "Ceiling", "Walls", "Wall n" (1-based)
  - "Editor", "Results", "2D", "3D"
  - "Swap views", "Reset panel layout"

## Review Focus

1. **A wall plane on an angled wall of a polygon room.** Its grid points lie on the wall (or at its offset), and its normal points into the room. Tested in Task 1 and Task 3.
2. **A room switching between rectangle and polygon.** Backend wall ids change between `south`… and `wall_N`, and a wall plane must keep its wall. Tested in Task 4: the index survives, the id is recomputed.
3. **An old `.guv` file with an XZ plane at y = 0.5 facing −y.** It opens as a wall plane on `south`, at offset 0.5, flipped. Tested in Task 2.
4. **Garbage or old-format `workspace*` values in localStorage.** The app still opens with the default dock layout. Tested in Task 7.
5. **Undo after drawing a wall outline or adding a plane on a wall.** It restores the previous zones exactly. Tested in Task 14.

---

### Task 1: guv-calcs wall-region planes

**Files:**
- Create: `~/guv-calcs/.claude/worktrees/plan-workflow/src/guv_calcs/geometry/wall_plane.py`
- Modify: `src/guv_calcs/geometry/grid.py` (add a classmethod next to `from_wall`, ~:507)
- Modify: `src/guv_calcs/calc_zone/_zone.py` (add a classmethod next to `from_face`, ~:734)
- Modify: `CHANGELOG.md`
- Test: `tests/test_wall_plane.py`

**Interfaces:**
- Produces:
  - `SurfaceGrid.from_wall_region(p1: tuple[float,float], p2: tuple[float,float], z_height: float, polygon: Polygon2D | None = None, normal_offset: float = 0.0, flip: bool = False, **kwargs) -> SurfaceGrid`.
    - `polygon` is in wall coordinates: (along from p1, up from the floor). `None` means the whole wall `[0,len]×[0,z_height]`.
    - The normal points to the left of p1→p2 (into the room for a CCW outline). `flip=True` reverses it.
    - `normal_offset` moves the plane along the room-facing normal. Flip does not change that direction.
    - An outline outside `[0,len]×[0,z_height]` (tolerance `1e-6·max(len, z_height)`) emits `UserWarning` and is still built.
  - `CalcPlane.from_wall_region(wall: str, dims: RoomDimensions, polygon=None, normal_offset=0.0, flip=False, **kwargs) -> CalcPlane`. `wall` is a key of `dims.faces` (`south`… or `wall_N`); raise `KeyError` otherwise.
  - `wall_plane.wall_frame_of(grid: SurfaceGrid, dims: RoomDimensions, tol: float = 1e-6) -> WallFrame | None`. `WallFrame` is a NamedTuple `(wall_id: str, normal_offset: float, flip: bool, polygon: Polygon2D)`, the inverse of `from_wall_region`.
    - It returns None for a non-vertical plane or one parallel to no wall.
    - Among parallel walls it picks the nearest by perpendicular distance from the plane's centroid, measured into the room.
    - It works for planes made by `from_legacy` (ref xz/yz) and by `from_wall`.

- [ ] **Step 1: Create the worktree.** `git -C ~/guv-calcs worktree add .claude/worktrees/plan-workflow -b plan-workflow main`

- [ ] **Step 2: Write failing tests in `tests/test_wall_plane.py`:**

```python
class TestFromWallRegion:
    def test_whole_wall_matches_from_wall(self):  # coords equal SurfaceGrid.from_wall(p1,p2,z) coords (allclose), same num_points
    def test_normal_points_left_of_wall_direction(self):  # p1=(0,0),p2=(4,0): normal ≈ (0,1,0)
    def test_flip_reverses_normal_keeps_position(self):  # normal ≈ (0,-1,0); coords set equal (sorted) to unflipped
    def test_normal_offset_moves_into_room(self):  # offset 0.5: all coords y ≈ 0.5, also with flip=True
    def test_angled_wall(self):  # p1=(4,0),p2=(6,3): every coord satisfies cross((p2-p1),(pt-p1))≈0 in xy; normal·(-3,2)/|..| ≈ 1
    def test_polygon_region_in_wall_coords(self):  # polygon [(1,0.5),(3,0.5),(3,2),(1,2)] on p1=(0,0),p2=(4,0),z=3: x in [1,3], z in [0.5,2]
    def test_triangle_region_masks(self):  # non-rectangular polygon -> is_rectangular False, values_to_full_grid gives NaN outside
    def test_outline_outside_wall_warns(self):  # polygon reaching up=3.5 on z=3 -> pytest.warns(UserWarning); grid still built
    def test_round_trip_to_dict(self):  # SurfaceGrid.from_dict(g.to_dict()) coords allclose

class TestWallFrameOf:
    def test_inverts_from_wall_region(self):  # for rect and angled walls, flip on/off, offset 0 and 0.4, polygon/None: wall_id, offset, flip, polygon vertices round-trip (allclose)
    def test_legacy_xz_plane_inside_room(self):  # from_legacy xz at y=0.5 direction=+1 in 4x6 room -> ('south', 0.5, False, ...)
    def test_legacy_xz_plane_facing_away(self):  # same with direction=-1 -> flip True
    def test_horizontal_plane_returns_none(self):
    def test_plane_parallel_to_no_wall_returns_none(self):  # vertical plane at 30° in a rectangle room

class TestCalcPlaneFromWallRegion:
    def test_from_wall_region_uses_dims_faces(self):  # dims for polygon room, wall='wall_1' equals SurfaceGrid.from_wall_region(face p1,p2,...)
    def test_unknown_wall_raises_keyerror(self):
```

- [ ] **Step 3: Run them and confirm they fail.** `cd ~/guv-calcs/.claude/worktrees/plan-workflow && uv run pytest tests/test_wall_plane.py -q`. Expected: FAIL (attribute or import errors).

- [ ] **Step 4: Implement.**
  - Wall frame: `u = (p2−p1)/len`, `n_room = (−u_y, u_x, 0)`.
  - Map wall coords to the grid's local frame the way `from_wall` does: `v = (0,0,−1)`, origin at the top. So local `t = z_height − up`. Mirror the polygon so the winding stays CCW in (s,t).
  - For flip, build with `v = (0,0,+1)` and the origin at the floor (local `t = up`). That reverses `u×v`.
  - Translate by `normal_offset·n_room`.
  - `wall_frame_of` projects `grid.boundary_vertices` (or the polygon corners) into the candidate wall's frame.
  - Tolerance for "parallel": `|n·n_room| ≥ 1 − tol`.
  - Add a CHANGELOG `[Unreleased]` line: "Calc planes can be built on part of any wall, with an outline drawn in wall coordinates."

- [ ] **Step 5: Run the tests.**
  - `uv run pytest tests/test_wall_plane.py -q`: PASS.
  - `make test`: all pass.

- [ ] **Step 6: Commit, merge and push.**
  - `git commit -am "wall-region calc planes and wall_frame_of"` (stage the new files first).
  - `git -C ~/guv-calcs merge --ff-only plan-workflow` from the main checkout, after `git -C ~/guv-calcs pull --ff-only`.
  - `git -C ~/guv-calcs push`.

- [ ] **Step 7: Bump the pin.** In illuminate: `make bump-guv-calcs`. Commit `api/pyproject.toml` and `api/uv.lock` with `chore: bump guv-calcs (wall-region planes)`.

### Task 2: API reports wall planes (read path, migrates old files)

**Files:**
- Create: `api/api/v1/wall_planes.py`
- Modify: `api/api/v1/session_schemas.py` (`SessionZoneState` :478, `LoadedZone` :929, `NudgedZonePosition` :1103)
- Modify: `api/api/v1/session_helpers.py` (`_zone_to_loaded` :892)
- Modify: `api/api/v1/zone_session_routers.py` (`get_session_zones` :340-413)
- Modify: `api/api/v1/calculation_routers.py` (nudge :880-915)
- Modify: `api/openapi.json`, `ui/src/lib/api/generated/api-types.ts` (both regenerated)
- Test: `api/tests/test_wall_planes.py`

**Interfaces:**
- Consumes: `wall_frame_of`, `WallFrame` (Task 1).
- Produces:
  - Pydantic `WallPlaneState(BaseModel)`: `wall_id: str`, `normal_offset: float`, `flip: bool`.
  - On `SessionZoneState`, `LoadedZone` and `NudgedZonePosition`:
    - `wall: Optional[WallPlaneState] = None`;
    - when `wall` is set, `vertices` holds (along, up) pairs, or None for the whole wall.
  - Helper `wall_state_of(zone, room) -> tuple[WallPlaneState, list[list[float]] | None] | None` in `wall_planes.py`. It returns None for non-planes and non-wall planes. Vertices are None when the region is the full wall rectangle within tolerance.

- [ ] **Step 1: Write failing tests** in `api/tests/test_wall_planes.py`, in the style of `test_polygon_zones.py` (the `client` and `session_headers` fixtures, plus `_init` / `_zone` helpers):
  - `test_legacy_xz_plane_reports_south_wall`: init a 4×6 room with a plane `ref_surface="xz", height=0.5, direction=1, x1=0,x2=4, y1=0,y2=3` (y1/y2 are the z range for xz). GET `/session/zones` gives `wall == {"wall_id":"south","normal_offset":0.5,"flip":False}` and `vertices == [[0,0],[4,0],[4,3],[0,3]]` in some rotation, or None if that covers the whole wall.
  - `test_legacy_xz_plane_facing_away_is_flipped`: `direction=-1` gives `flip True`.
  - `test_horizontal_plane_has_no_wall`: `wall is None` and `vertices` unchanged.
  - `test_save_load_reports_wall`: POST `/session/save`, then `/session/load` of the result. The `LoadedZone.wall` field matches.
  - `test_polygon_room_angled_wall_plane`: build a plane through guv-calcs on `wall_1` of an L- or trapezoid-shaped room, saved via a project dict. Load reports `wall_id "wall_1"`.

- [ ] **Step 2: Run them and confirm they fail.** `cd api && ../scripts/guv-calcs.sh exec uv run pytest tests/test_wall_planes.py -q`. Expected: FAIL.

- [ ] **Step 3: Implement** `wall_state_of`. Fill `wall` and the wall-coordinate `vertices` in `_zone_to_loaded`, in `get_session_zones` and in the nudge response. Non-wall zones are unchanged.

- [ ] **Step 4: Run the tests.**
  - `../scripts/guv-calcs.sh exec uv run pytest tests/test_wall_planes.py tests/test_polygon_zones.py tests/test_save_load_export.py -q`: PASS.

- [ ] **Step 5: Regenerate the schema and types.** Regenerate openapi and api-types. `cd ui && pnpm check` reports 0 errors.

- [ ] **Step 6: Commit.** `feat(api): zones report wall planes, including old XZ/YZ planes parallel to a wall`

### Task 3: API creates and edits wall planes (write path)

**Files:**
- Modify: `api/api/v1/session_schemas.py` (`SessionZoneInput` :110, `SessionZoneUpdate` :410)
- Modify: `api/api/v1/wall_planes.py`
- Modify: `api/api/v1/session_helpers.py` (`_create_zone_from_input` :396, `_is_footprint_zone` :540, `set_zone_outline` :567, `set_plane_height` :590)
- Modify: `api/api/v1/zone_session_routers.py` (`update_session_zone` :100-210)
- Modify: `api/openapi.json`, `ui/src/lib/api/generated/api-types.ts`
- Test: `api/tests/test_wall_planes.py`

**Interfaces:**
- Consumes: `CalcPlane.from_wall_region`, `SurfaceGrid.from_wall_region` (Task 1); `WallPlaneState`, `wall_state_of` (Task 2).
- Produces:
  - `WallPlaneInput(BaseModel)`: `wall_id: str` (pattern `^(south|east|north|west|wall_\d+)$`), `normal_offset: float = 0.0`, `flip: bool = False`.
  - `SessionZoneInput.wall` and `SessionZoneUpdate.wall`: `Optional[WallPlaneInput] = None`.
  - When `wall` is set, `vertices` are (along, up). `vertices: None` with `wall` set means the whole wall.
  - `build_wall_plane(room, wall: WallPlaneInput, vertices, grid_kwargs) -> SurfaceGrid` in `wall_planes.py`.
  - `PATCH /session/zones/{id}`: a body with `wall` rebuilds the geometry through `build_wall_plane`, keeping the num_points or spacing and the offset. A body without `wall` on a wall plane, carrying `height`, `ref_surface` or `x1..y2`, returns 400 "wall plane: send wall". It never reaches `update_legacy`.

- [ ] **Step 1: Write failing tests:**
  - `test_create_whole_wall_plane`: POST a zone `{type:"plane", wall:{wall_id:"east"}, num_x:5, num_y:4}` in a 4×6×3 room. GET reports `wall.wall_id "east"`, `normal_offset 0`, `vertices None`.
  - `test_create_region_on_angled_wall`: in a polygon room, `wall:{wall_id:"wall_1", normal_offset:0.2}`, `vertices [[0.5,0.5],[2,0.5],[2,2],[0.5,2]]`. GET round-trips the vertices (allclose) and the offset.
  - `test_patch_wall_offset_and_flip`: PATCH `{wall:{wall_id:"east", normal_offset:0.3, flip:true}}`. GET reflects it, and `num_x`/`num_y` are unchanged.
  - `test_patch_legacy_fields_on_wall_plane_is_400`: PATCH `{height:1}` on a wall plane returns 400.
  - `test_calculate_wall_plane_has_values`: after calculate with one lamp, the zone has a finite values array whose shape matches its grid.
  - `test_outline_outside_wall_is_accepted`: vertices reaching `up = z+0.5` give 200 (a guv-calcs warning only).

- [ ] **Step 2: Run them and confirm they fail.** Same command as Task 2. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Build planes in `_create_zone_from_input` and in the PATCH handler.
  - Exempt wall planes in `_is_footprint_zone`: their outline goes through `build_wall_plane`, not `set_zone_outline`.
  - Add the 400 guard.

- [ ] **Step 4: Run the tests.** `../scripts/guv-calcs.sh exec uv run pytest tests/test_wall_planes.py tests/test_polygon_zones.py tests/test_session_extended_crud.py tests/test_zone_limits.py -q`: PASS. Then regenerate openapi and api-types; `pnpm check` reports 0 errors.

- [ ] **Step 5: Commit.** `feat(api): create and edit calc planes on any wall`

### Task 4: UI zone surfaces: model, helpers, sync, sidecar

**Files:**
- Create: `ui/src/lib/utils/surfaces.ts`
- Create: `ui/src/lib/utils/surfaces.test.ts`
- Modify: `ui/src/lib/types/project.ts` (`CalcZone` :180-253)
- Modify: `ui/src/lib/stores/project.ts`:
  - `zoneToSessionZone` :523
  - `convertSessionZoneState` :1026
  - the LoadedZone mapping used by `routes/+page.svelte` load
  - `zoneSyncPartial`
- Modify: `ui/src/lib/api/client.ts` (`updateSessionZone` Pick whitelist :1393: add `wall`, `vertices`)
- Modify: `ui/src/lib/utils/floorplanSidecar.ts`, plus its read and write sites in `routes/+page.svelte`
- Modify: `ui/src/lib/utils/zoneFootprint.ts` (`zoneHasFootprint`)
- Test: `ui/src/lib/stores/project.test.ts` (or the existing zone store test file), `floorplanSidecar.test.ts`

**Interfaces:**
- Consumes: the API `wall` block and wall-coordinate `vertices` (Tasks 2-3).
- Produces (in `surfaces.ts`):
  - `type Surface = 'floor' | 'ceiling' | \`wall:${number}\``. The wall index is the outline edge `i → i+1` (CCW), like `lampSticking`'s `wall_index`.
  - `parseSurface(s: unknown): Surface | null`
  - `allSurfaces(vertices: [number,number][]): Surface[]`: floor, ceiling, then walls in index order.
  - `stepSurface(current: Surface, vertices, delta: 1 | -1): Surface`: wraps around.
  - `surfaceName(s: Surface): string`: 'Floor' | 'Ceiling' | 'Wall n', where n = index+1.
  - `wallIndex(s: Surface): number | null`
  - `wallSegment(vertices, index): { x1, y1, x2, y2, length: number, ux: number, uy: number, nx: number, ny: number } | null`. `(nx, ny)` is the room-facing left normal `(−uy, ux)`.
  - `toWall(x, y, z, seg): { along: number; up: number; depth: number }`
  - `fromWall(along, up, depth, seg): { x: number; y: number; z: number }`
  - `wallIdForIndex(vertices, index): string`, via `wallIdsFor` in `roomGeometry.ts`.
  - `wallIndexForId(vertices, id: string): number | null`
  - `zoneSurface(zone: CalcZone, roomZ: number): Surface`:
    - `zone.surface` if set;
    - else a plane with `ref_surface 'xy'`, `direction −1` and `|height − roomZ| ≤ 1e-6·roomZ` gives `'ceiling'`;
    - else `'floor'`.
- `CalcZone` gains:
  - `surface?: Surface`
  - `normal_offset?: number` (wall planes)
  - `flip?: boolean` (wall planes)
  - `wall_vertices?: [number, number][]` ((along, up); absent means the whole wall)
- Sync rule:
  - `zoneToSessionZone` sends `wall: { wall_id: wallIdForIndex(...), normal_offset, flip }` and `vertices: wall_vertices ?? null` for wall planes.
  - Responses with `wall` map back: `surface = \`wall:${wallIndexForId(...)}\``, `normal_offset`, `flip`, `wall_vertices`.
  - Floor and ceiling planes keep using `height`, `direction`, `ref_surface 'xy'` and `vertices`.
- Sidecar block `zoneSurfaces: z.record(z.string(), z.string())`, `.optional().catch(undefined)`. It is written for every zone with a `surface`. Read through `parseSurface`, unknown values are dropped.
- `zoneHasFootprint(zone)` is false for wall planes.

- [ ] **Step 1: Write failing tests:**
  - `surfaces.test.ts`:
    - `allSurfaces` on a 4-corner outline is `['floor','ceiling','wall:0','wall:1','wall:2','wall:3']`.
    - `stepSurface('wall:3', v, 1)` is `'floor'`; `stepSurface('floor', v, -1)` is `'wall:3'`.
    - `surfaceName('wall:0')` is `'Wall 1'`.
    - `toWall` / `fromWall` round-trip on an angled segment (allclose).
    - `wallSegment` normal on a CCW square points inside.
    - `wallIdForIndex` on a rectangle is `'south'` for index 0 and `'wall_0'` for a pentagon.
    - `wallIndexForId(rect,'east')` is 1.
    - `zoneSurface` derivation, with three cases.
  - Store test `wall plane survives rectangle → polygon`: a zone with `surface 'wall:1'` on a rectangle sends `wall_id 'east'`. After the room becomes a 5-corner polygon (same first edges), the next sync sends `'wall_1'` and the zone still has `surface 'wall:1'`.
  - Store test `GET zone with wall maps to surface`: `convertSessionZoneState` of `{wall:{wall_id:'north',normal_offset:0.5,flip:true}, vertices:[[0,0],[1,0],[1,1]]}` on a rectangle gives `surface 'wall:2'`, `normal_offset 0.5`, `flip true` and `wall_vertices` set.
  - Sidecar test: `zoneSurfaces` round-trips. A bad value, `{ zoneSurfaces: 5 }`, drops only that block and keeps `hidden` and `lamps`.

- [ ] **Step 2: Run them and confirm they fail.** `cd ui && pnpm vitest run src/lib/utils/surfaces.test.ts src/lib/utils/floorplanSidecar.test.ts src/lib/stores/project.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** Also add the `zoneSurfaces` block to `captureScene` and the session autosave, wherever the other sidecar blocks are captured.

- [ ] **Step 4: Run the tests.** Same command: PASS. Then `pnpm test:run`: all pass, and `pnpm check` reports 0 errors.

- [ ] **Step 5: Commit.** `feat(zones): planes carry a surface (floor, ceiling or wall n), synced to the API and saved with the project`

### Task 5: Surface planes follow the room

**Files:**
- Modify: `ui/src/lib/utils/lampSticking.ts` (export `sameWall`, `isAxisScale`, `nearestWall`, `wallAt`)
- Create: `ui/src/lib/utils/surfaceFollow.ts`
- Create: `ui/src/lib/utils/surfaceFollow.test.ts`
- Modify: `ui/src/lib/stores/project.ts` (`updateRoom` refit block ~:2600-2660)
- Modify: `ui/src/lib/components/AuditModal.svelte` (or its audit source), only if wall planes aren't already flagged by the out-of-room check

**Interfaces:**
- Consumes: Task 4 helpers.
- Produces:
  - `followSurfaces(zones: CalcZone[], prevRoom: RoomConfig, nextRoom: RoomConfig, tol: number): { id: string; partial: Partial<CalcZone> }[]`. The rules:
    - **Ceiling planes** keep `roomZ − height`: when `room.z` changes, `height` shifts by the same amount.
    - **Wall planes:**
      - wall `i` survives (`sameWall`) → keep `surface`; whole-wall planes resync;
      - else re-find by `nearestWall` on the plane's wall midpoint within `tol`;
      - else keep `surface` and geometry, and mark stranded (below).
    - **Fit wall planes** (`fit_room` true on a wall plane) clear `wall_vertices` so they cover the new wall.
    - **A drawn `wall_vertices` outline** that no longer fits `[0,len]×[0,roomZ]` is kept unchanged.
  - `strandedWallPlane(zone, room): boolean`: the wall index is out of range, or the outline leaves the wall rectangle. The audit lists these with the other out-of-room items.

- [ ] **Step 1: Write failing tests in `surfaceFollow.test.ts`:**
  - `ceiling plane keeps its distance below the ceiling`: room z 3 → 3.5 moves a plane at height 2.7 to 3.2.
  - `floor plane is unchanged by a height change`.
  - `wall plane follows its wall when the room is scaled`: an axis scale keeps `wall:1`.
  - `wall plane re-attaches by position when corners are inserted before it`.
  - `fit wall plane drops its outline to cover the resized wall`.
  - `outline that no longer fits is kept and reported stranded`.
  - `deleted wall → stranded, surface unchanged`.

- [ ] **Step 2: Run them and confirm they fail.** `pnpm vitest run src/lib/utils/surfaceFollow.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**, and call `followSurfaces` from `updateRoom` next to `applySticking` (~:2620). Apply each result with `this.updateZone`. Do this inside the same undo step as the room edit, exactly as lamps are handled.

- [ ] **Step 4: Run the tests.** `surfaceFollow.test.ts` plus `pnpm test:run` pass.

- [ ] **Step 5: Commit.** `feat(zones): ceiling and wall planes follow the room`

### Task 6: Standard zones start hidden

**Files:**
- Modify: `ui/src/lib/stores/project.ts`:
  - `initializeStandardZones` :1208
  - the useStandardZones toggle :2552-2590
  - new-project creation
- Test: the store test file

**Interfaces:**
- Produces:
  - Creating a new project, or turning `useStandardZones` from false to true, calls `setHidden('zones', id, true)` for every standard zone id (`WholeRoomFluence`, `EyeLimits`, `SkinLimits`).
  - Loading a project never changes `hidden`.

- [ ] **Step 1: Write failing tests:**
  - `new project hides standard zones`
  - `turning standard zones on hides them`
  - `loading a project with visible standard zones keeps them visible` (a `hidden` list without those ids)

- [ ] **Step 2: Run them and confirm they fail.** Run the store test file. Expected: FAIL.

- [ ] **Step 3: Implement.** Add a CHANGELOG line: "Standard zones start hidden in the views; they still calculate."

- [ ] **Step 4: Run the tests.** The store tests and `pnpm test:run` pass. `e2e/tests/plan-zones.spec.ts` and `e2e/tests/workflow.spec.ts` pass; update any assertion that expects standard zones visible in 3D.

- [ ] **Step 5: Commit.** `feat(zones): standard zones start hidden`

### Task 7: Dock layout model and setting

**Files:**
- Create: `ui/src/lib/workspace/dockLayout.ts`
- Create: `ui/src/lib/workspace/dockLayout.test.ts`
- Modify: `ui/src/lib/stores/settings.ts` (remove `workspaceLayout`, `workspaceSwap`, `workspaceSplit`, `workspaceInset`, `workspaceInsetHidden`; add `workspaceDock`)
- Modify: `ui/src/lib/stores/settings.test.ts` (the `settings store workspace layout` block, l.48)

**Interfaces:**
- Produces:

```ts
export type DockPanelId = 'editor' | 'results' | 'mini';
export type DockColumn = 'left' | 'right';
export type MainView = '2d' | '3d';
export interface DockLayout { left: DockPanelId[]; right: DockPanelId[]; minimized: DockPanelId[]; main: MainView; }
export const DEFAULT_DOCK: DockLayout; // { left: ['editor'], right: ['mini', 'results'], minimized: [], main: '2d' }
export function sanitizeDock(raw: unknown): DockLayout;
export function movePanel(l: DockLayout, id: DockPanelId, column: DockColumn, index: number): DockLayout;
export function toggleMinimized(l: DockLayout, id: DockPanelId): DockLayout;
export function swapMain(l: DockLayout): DockLayout;
export function panelWidth(id: DockPanelId, resultsWide: boolean): number; // editor 300, mini 300, results resultsWide ? 420 : 300
export function columnWidth(ids: DockPanelId[], resultsWide: boolean): number; // max panelWidth, 0 when empty
export function dropIndex(panelMidYs: number[], y: number): number; // insertion index for a pointer y
```

- `sanitizeDock` returns `DEFAULT_DOCK` unless each of the three ids appears exactly once across left and right, `minimized` is a subset of those ids, and `main` is '2d' or '3d'.
- `UserSettings.workspaceDock: DockLayout` defaults to `DEFAULT_DOCK`. It is read through `sanitizeDock` in `loadSettings`. The old `workspace*` keys are ignored and dropped on the next save.

- [ ] **Step 1: Write failing tests:**
  - `movePanel` moves results to the left under editor, and moves the mini view into an empty column.
  - `movePanel` within the same column reorders.
  - `movePanel` clamps an out-of-range index.
  - `toggleMinimized` twice is identity.
  - `swapMain` flips main.
  - `columnWidth([],…)` is 0; `columnWidth(['editor','results'], true)` is 420.
  - `dropIndex([10,50,90], 60)` is 2.
  - `sanitizeDock` returns the default for `null`, `'side'`, a duplicate id, a missing id and `main: 'x'`.
  - The settings test: an old stored `{workspaceLayout:'pip-3d'}` loads with `workspaceDock` deep-equal to `DEFAULT_DOCK`.

- [ ] **Step 2: Run them and confirm they fail.** `pnpm vitest run src/lib/workspace/dockLayout.test.ts src/lib/stores/settings.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** Keep `+page.svelte` compiling: its ViewsPane props become constants for the mobile path (Task 9 replaces the desktop path).

- [ ] **Step 4: Run the tests.** The same tests pass, and `pnpm check` reports 0 errors.

- [ ] **Step 5: Commit.** `feat(workspace): dock layout model and setting`

### Task 8: DockPanel and DockArea components

**Files:**
- Create: `ui/src/lib/workspace/DockPanel.svelte`
- Create: `ui/src/lib/workspace/DockArea.svelte`
- Create: `ui/src/lib/workspace/DockArea.test.ts`
- Create: `ui/src/lib/workspace/test/DockAreaHost.svelte` (test host with three snippets and a main snippet)

**Interfaces:**
- Consumes: Task 7.
- Produces:
  - `DockPanel.svelte` props: `{ id: DockPanelId; title: string; minimized: boolean; onToggleMinimized: () => void; onSwap?: () => void; onBarPointerDown: (e: PointerEvent) => void; children: Snippet }`.
    - It renders `section.dock-panel[data-panel=id]`.
    - Its `div.dock-bar` holds:
      - a grip `⋮⋮` (aria-hidden), the title;
      - an optional `button[aria-label="Swap views"]` ⇄;
      - `button[aria-label="Minimize"]` (–) or `[aria-label="Restore"]` (▢).
    - Minimized: the content is not rendered (`{#if !minimized}`), but the panel keeps its slot.
    - The bar's styling follows `docking-v3.html`: height 26 px, bg `#121a36`-equivalent token, bottom border.
  - `DockArea.svelte` props: `{ layout: DockLayout; resultsWide: boolean; onChange: (l: DockLayout) => void; titles: Record<DockPanelId, string>; panel: Snippet<[DockPanelId]>; main: Snippet }`.
    - It renders `div.dock-area`, a grid of `[left column][main][right column]`, with column widths from `columnWidth`.
    - Each column is `div.dock-column[data-column]`.
    - Dragging a bar uses pointer capture, a ghost and a 6 px `div.dock-drop.on` insertion line at the `dropIndex` position. On release, `movePanel` runs.
    - An empty column collapses to width 0. While dragging, a 24 px drop strip appears at that edge of the main area.
    - A press without movement (< 4 px) is not a drag.
    - Non-maximized panels in a column share height. The mini panel is `aspect-ratio: 4/3` at the column width. A minimized panel is bar-height only.

- [ ] **Step 1: Write failing tests** in `DockArea.test.ts` with the host:
  - `renders panels in their columns in order`
  - `minimize hides content and keeps the bar`: the content testid is gone, and `[data-panel=results] .dock-bar` is still there.
  - `drag results bar to the left column below editor`: dispatch pointerdown, pointermove over the left column's lower half, then pointerup. Assert `onChange` was called with `left: ['editor','results']`. Mock `getBoundingClientRect` for the columns and panels.
  - `a click on the bar without movement does not move the panel`
  - `empty column has zero width and shows an edge drop strip while dragging`
  - `swap button calls onSwap`

- [ ] **Step 2: Run them and confirm they fail.** `pnpm vitest run src/lib/workspace/DockArea.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests.** PASS.

- [ ] **Step 5: Commit.** `feat(workspace): dockable panels with drag between side columns and minimize`

### Task 9: Workspace shell uses docking; mini views

**Files:**
- Create: `ui/src/lib/workspace/ViewHost.svelte`
- Create: `ui/src/lib/workspace/ViewHost.test.ts`
- Create: `ui/src/lib/workspace/MainViewBar.svelte`
- Modify: `ui/src/routes/+page.svelte`:
  - the desktop layout l.1192-1206: drop both `ResizablePanel`s and the desktop `viewsPane`;
  - the layout handlers l.260-278;
  - the MenuBar wiring l.1075-1077
- Modify: `ui/src/lib/components/RoomViewer.svelte` (prop `mini`)
- Modify: `ui/src/lib/plan/PlanPane.svelte` (prop `mini`)
- Modify: `ui/src/lib/components/PlanCanvas.svelte` (prop `navControls = true`)
- Modify: `ui/src/lib/components/MenuBar.svelte`, `MenuBar.test.ts`
- Modify: `e2e/helpers/workspace.ts`
- Modify: `e2e/tests/smoke.spec.ts` (only if the canvas locator needs `.first()`)
- Modify: `CHANGELOG.md`
- Test: `ViewHost.test.ts`, `MenuBar.test.ts`, `RoomViewer` and `PlanPane` tests

**Interfaces:**
- Consumes: Tasks 7-8.
- Produces:
  - `ViewHost.svelte` props: `{ main: MainView; mainAnchor: HTMLElement | undefined; miniAnchor: HTMLElement | undefined; miniVisible: boolean; view2d: Snippet<[boolean]>; view3d: Snippet<[boolean]> }`.
    - It renders both views once, always mounted (the 3D canvas must not remount on swap).
    - Each view sits in an absolutely positioned `div.view-slot[data-view]` placed over its anchor's client rect (a ResizeObserver plus a window resize listener).
    - The snippet argument is `mini` (true for the slot over `miniAnchor`).
    - A hidden mini (minimized panel) gets `visibility:hidden` and stays mounted.
    - The mini slot is interactive. There is no click-to-swap; only the panel's ⇄ swaps.
  - `MainViewBar.svelte` props: `{ main: MainView; onSelect: (v: MainView) => void }`. It renders the `2D | 3D` segmented control, `div[role=group][aria-label="Main view"]` with `button[aria-pressed]`, top-left of the main view.
  - `RoomViewer` `mini?: boolean`. When true it hides `ViewSnapOverlay`, `ProjectionToggle`, `.units-label` and `.viewer-actions`, and drops `min-height: 500px`. Orbit (drag to rotate) and wheel zoom keep working, and item and surface click handlers are ignored.
  - `PlanPane` `mini?: boolean`. When true: readonly rendering, no `.plan-toolbar`, `PlanCanvas navControls={false}`, no window key handling. Drag pans and the wheel zooms, as in Hand mode.
  - Page:
    - Desktop renders `<DockArea>` with panel snippets: editor → `editorColumn`, results → `resultsContent`, mini → a `div.mini-anchor` bound to `miniAnchor`.
    - The `main` snippet holds a `div.main-anchor`, `MainViewBar`, and `CalculateButton` top-right (absolute `top:12px; right:12px`). When `main === '2d'`, Hand/Zoom move below Calculate, as ViewsPane's `.hosts-calculate` rule did.
    - Mini titles: '3D' when main is '2d', else '2D'.
    - `resultsWide = !!$results`, as today.
    - `revealEditor()` restores a minimized editor (`toggleMinimized`) instead of `leftPanelCollapsed`.
    - Mobile keeps `ViewsPane` with `layout='stack'` and its current markup.
  - MenuBar:
    - drop the Layout submenu and the `workspaceLayout` / `onSetWorkspaceLayout` props;
    - keep "Swap views" (`onSwapViews` → `swapMain`);
    - add "Reset panel layout" (`onResetPanels` → `DEFAULT_DOCK`), on desktop and in the mobile menu.
  - e2e helpers: `planSvg` targets `.view-slot[data-view="2d"]:not(.mini) .plan-pane svg.plan`. Add a helper `showMain(page, '2d' | '3d')` that clicks `[aria-label="Main view"] button` with that name.

- [ ] **Step 1: Write failing tests:**
  - `ViewHost.test.ts`:
    - `renders each view once and passes mini to the docked one`
    - `swapping main keeps the same DOM nodes`: grab the 3D slot element, change `main`, and assert it is the same node with `mini` flipped.
    - `clicking the mini slot does not swap views`
    - `hidden mini stays mounted`
  - `MenuBar.test.ts`:
    - `View menu has Swap views and Reset panel layout and no Layout submenu`
    - `Reset panel layout calls onResetPanels`
  - A RoomViewer test (create `RoomViewer.test.ts` if missing, mocking Threlte as other 3D tests do): `mini hides view snap, projection toggle and actions`.
  - `PlanPane.test.ts`: `mini renders no toolbar and no Hand/Zoom`.

- [ ] **Step 2: Run them and confirm they fail.** Run those files. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Delete `ResizablePanel` usage on desktop only.
  - Remove the now-unused layout code from `layoutGeometry.ts` and `ViewsPane.svelte` only where mobile doesn't need it; keep the stack path working.
  - Update `ViewsPane.test.ts` and `layoutGeometry.test.ts` to the kept surface.
  - Add a CHANGELOG entry: "One main view with a 2D | 3D switch; the other view, the editor and results are dockable panels: drag them by their bar to either side, minimize them, and swap views from the mini view. View › Reset panel layout restores the default."

- [ ] **Step 4: Run all the tests.**
  - `pnpm test:run` passes and `pnpm check` reports 0 errors.
  - e2e: from `e2e/`, `npx playwright test tests/smoke.spec.ts tests/room.spec.ts tests/plan-lamps.spec.ts tests/plan-zones.spec.ts tests/ceiling.spec.ts tests/mobile.spec.ts tests/workflow.spec.ts` passes. Rerun any failing spec alone before calling it a regression (shared-dev-server HMR flake).

- [ ] **Step 5: Measure.** Use a throwaway Playwright script (delete it afterwards) at 1440×900 in the dark theme:
  - the mini 3D panel has no `.viewer-actions` or `.view-snap` element visible;
  - dragging `[data-panel=mini] .dock-bar` to the left column moves it there, and the layout persists after reload.

- [ ] **Step 6: Commit.** `feat(workspace): main view plus dockable editor, results and mini view`

### Task 10: Surface switcher and surface state

**Files:**
- Create: `ui/src/lib/plan/SurfaceSwitcher.svelte`
- Modify: `ui/src/lib/plan/planController.svelte.ts`
- Modify: `ui/src/lib/plan/PlanPane.svelte`
- Modify: `ui/src/routes/+page.svelte` (Room › Ceiling switches surface; opening a zone switches surface)
- Test: `planController.test.ts`, `PlanPane.test.ts`

**Interfaces:**
- Consumes: Task 4 (`Surface`, `allSurfaces`, `stepSurface`, `surfaceName`, `zoneSurface`).
- Produces, on `PlanController`:
  - `surface = $state<Surface>('floor')`
  - `setSurface(s: Surface): void`. It clears the draft and selection when the surface changes, unless called from `selectZone`.
  - `stepSurface(delta: 1 | -1): void`
  - `surfaces: Surface[]` (derived from the scene vertices)
  - `wallSeg: ReturnType<typeof wallSegment> | null` (derived for the current wall)
- Behaviour:
  - `[` and `]` in `onWindowKey` call `stepSurface(-1)` and `stepSurface(1)`, under the same `planShouldHandleKey` gate.
  - `setContext('ceiling')` sets surface `'ceiling'`. Leaving the ceiling context returns to `'floor'` unless the user picked another surface.
  - `selectZone(id)` on a plane sets `surface = zoneSurface(zone, roomZ)`.
  - If the current wall index ≥ the wall count after a room edit, surface becomes `'floor'`.
- `SurfaceSwitcher.svelte` props: `{ surface: Surface; surfaces: Surface[]; onSelect: (s: Surface) => void }`.
  - It renders `div[role=group][aria-label="Surface"]` with Floor and Ceiling buttons (`aria-pressed`) and a `select[aria-label="Walls"]`.
  - The select's placeholder option is "Walls" (disabled). Its options are "Wall 1"…, and it is marked `.on` when a wall is current.
  - It sits in the plan's top-left toolbar row and is not rendered when `mini`.

- [ ] **Step 1: Write failing tests:**
  - `planController.test.ts`:
    - `] steps floor → ceiling → wall:0 and wraps`
    - `[ from floor goes to the last wall`
    - `selecting a wall plane switches the surface to its wall`
    - `ceiling context sets the ceiling surface`
    - `surface falls back to floor when its wall disappears`
  - `PlanPane.test.ts`:
    - `switcher shows Floor, Ceiling and Walls; choosing Wall 2 sets wall:1`
    - `switcher hidden when mini`

- [ ] **Step 2: Run them and confirm they fail.** Run those files. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests.** Those files and `pnpm test:run` pass.

- [ ] **Step 5: Commit.** `feat(plan): Floor · Ceiling · Walls surface switcher with [ and ]`

### Task 11: Wall view in 2D

**Files:**
- Create: `ui/src/lib/plan/wallProjection.ts`
- Create: `ui/src/lib/plan/wallProjection.test.ts`
- Modify: `ui/src/lib/plan/planController.svelte.ts` (outline, shapes and markers for a wall surface)
- Modify: `ui/src/lib/plan/PlanPane.svelte` (wall underlay and overlays)
- Test: `PlanPane.test.ts`

**Interfaces:**
- Consumes: Task 10 (`surface`, `wallSeg`), Task 4 (`toWall`).
- Produces (in `wallProjection.ts`):
  - `wallOutline(seg, roomZ): [number, number][]`: `[[0,0],[len,0],[len,roomZ],[0,roomZ]]`.
  - `projectLamps(lamps, seg): { id: string; along: number; up: number; depth: number; opacity: number }[]`.
    - Only lamps in front of the wall count (`depth ≥ 0`).
    - `opacity = clamp(1 − depth / maxDepth, 0.25, 1)`, where `maxDepth` is the largest room extent perpendicular to the wall.
  - `projectStructures(objects, seg, roomZ): { id: string; rect: [number, number][]; depth: number; opacity: number }[]`. `rect` spans the footprint's along-range × [bottom, top].
  - `neighbourLabels(vertices, index): { left: string; right: string }`, giving 'Wall n' for the walls at each end.
- In a wall surface, PlanCanvas gets:
  - `outline = wallOutline(...)` in (along, up) as its x/y;
  - `allowNegative = false`;
  - `shapes` = projected structures, faded;
  - `lamps` = projected lamps, faded.
- Floor-only overlays (reference image, ceiling items, floor zone footprints) are not drawn on a wall. The neighbour labels sit at the bottom corners in the `hud`.

- [ ] **Step 1: Write failing tests:**
  - `wallProjection.test.ts`:
    - outline of a 4 m wall in a 3 m room;
    - a lamp 1 m in front of wall 0 at x = 2, z = 2.5 projects to along 2, up 2.5, depth 1;
    - a lamp behind the wall is excluded;
    - the opacity floor is 0.25;
    - a structure's rect spans its along-range and its bottom/top;
    - neighbour labels for wall 0 of a 4-wall room are Wall 4 and Wall 2.
  - `PlanPane.test.ts`: `wall view draws the wall outline and neighbour labels and no reference image`.

- [ ] **Step 2: Run them and confirm they fail.** Run them. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests.** They pass, along with `pnpm test:run`.

- [ ] **Step 5: Commit.** `feat(plan): wall elevations in 2D with lamps and structures projected and faded`

### Task 12: Editing lamps and structures in wall views

**Files:**
- Modify: `ui/src/lib/plan/planController.svelte.ts` (marker and shape drags on a wall surface)
- Modify: `ui/src/lib/plan/wallProjection.ts` (inverse helpers)
- Test: `planController.test.ts`, `wallProjection.test.ts`

**Interfaces:**
- Consumes: Task 11.
- Produces:
  - `unprojectLampMove(lamp, seg, along, up): Partial<Lamp>`.
    - A wall-stuck lamp on this wall changes `wall_t` (signed as `encodeT` does) and `z`.
    - Any other lamp keeps its depth and moves to `fromWall(along, …, depth)` for x/y; `up` becomes `z`.
    - The aim point moves by the same delta.
  - `unprojectStructureMove(object, seg, dAlong, dUp): Partial<RoomObject>`. It translates the footprint by `dAlong·u` and the bottom/top by `dUp`, and clamps the bottom at ≥ 0.
- In the Lamps context on a wall surface, dragging a projected lamp body calls `updateLamp` with `unprojectLampMove`. There is no aim handle in wall views.
- In the Structures context on a wall surface, dragging a projected structure calls `updateObstacle` with `unprojectStructureMove`. Only structures with opacity ≥ 0.5 (near the wall) are draggable, so far ones don't steal clicks *(plan ruling: spec says "editable"; nearness keeps hit-testing sane)*.

- [ ] **Step 1: Write failing tests:**
  - `stuck lamp slides along its wall and changes height`
  - `free lamp keeps its distance from the wall`
  - `aim moves with the lamp`
  - `structure slides along the wall and rises; bottom clamps at 0`
  - controller: `dragging a projected lamp on wall:0 in Lamps context calls updateLamp with the unprojected move`

- [ ] **Step 2: Run them and confirm they fail.** Run them. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests.** They pass, along with `pnpm test:run`. e2e `plan-lamps.spec.ts` and `objects.spec.ts` pass.

- [ ] **Step 5: Commit.** `feat(plan): slide and raise lamps and structures in wall views`

### Task 13: Picking surfaces in 3D

**Files:**
- Create: `ui/src/lib/components/surfacePicking.ts`
- Create: `ui/src/lib/components/surfacePicking.test.ts`
- Modify: `ui/src/lib/components/Room3D.svelte`: per-surface pick meshes with `userData {clickType:'surface', surface: Surface}`, plus a dashed outline for the surface shown in 2D.
- Modify: `ui/src/lib/components/Scene.svelte` (`handleSceneClick` :148, hover)
- Modify: `ui/src/lib/components/RoomViewer.svelte` (`onSurfaceClick`, `onSurfaceHover`, `viewedSurface` props; hover chip)
- Modify: `ui/src/routes/+page.svelte` (`processClickBatch` :437)
- Test: `surfacePicking.test.ts`

**Interfaces:**
- Consumes: Task 4 (`Surface`), Task 10 (`plan.setSurface`, `plan.surface`).
- Produces:
  - `orderSurfaceHits(hits: { surface: Surface; distance: number; facesCamera: boolean }[]): Surface[]`. The order, as in `ReflectancePreview3D.candidatesAt`:
    1. floor and far walls (seen from inside, `facesCamera` true), by distance;
    2. the ceiling;
    3. the near walls.
  - `nextSurface(order: Surface[], current: Surface | null): Surface | null`. It cycles: if `current` is in `order`, return the next one; after the last, return the first.
- Clicks:
  - Item clicks (lamp, structure, zone) keep their priority in `processClickBatch`.
  - Surface hits are used only when no item target fits the current context.
  - A surface click calls `plan.setSurface(nextSurface(order, plan.surface))`.
- Hover shows a chip near the cursor, `div.surface-chip`, with text `${surfaceName(s)} ${k}/${n}` (e.g. "Ceiling 2/2"). The hovered surface is highlighted faintly.
- The surface shown in 2D gets a subtle dashed outline (`LineDashedMaterial`) in 3D.
- Mini 3D: drag rotates; clicks neither select nor pick. There is no hover chip.

- [ ] **Step 1: Write failing tests:**
  - `surfacePicking.test.ts`:
    - ordering puts the floor before the ceiling before a near wall;
    - `nextSurface` cycles and wraps;
    - `nextSurface` with current not in the list returns the first.
  - A `+page`-free unit for the batch rule: extract `chooseClickTarget(items, surfaces, context)` into `surfacePicking.ts`, then test `item wins over surface in its context` and `surface used when no item applies`.

- [ ] **Step 2: Run them and confirm they fail.** Run them. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests.** They pass, along with `pnpm test:run`. Check manually in the dev server: clicking the ceiling in the 3D main view switches 2D to Ceiling when 2D is next swapped in.

- [ ] **Step 5: Commit.** `feat(3d): click a surface to view it in 2D, cycling stacked surfaces`

### Task 14: Planes on surfaces: add, draw, drag, fit, render

**Files:**
- Create: `ui/src/lib/utils/planeWorld.ts`
- Create: `ui/src/lib/utils/planeWorld.test.ts`
- Modify: `ui/src/lib/plan/planController.svelte.ts`:
  - wire `startZoneDraw` (:759) to the current surface;
  - make `commitDraft` wall-aware;
  - the zone `source` for wall and ceiling surfaces
- Modify: `ui/src/lib/workspace/parts/ZonesPart.svelte` (`addZone` per surface)
- Modify: `ui/src/lib/plan/PlanPane.svelte` (draw wall and ceiling planes on their surface; wall planes as a thick line on the floor view, *plan ruling*)
- Modify: `ui/src/lib/components/CalcPlane3D.svelte` (render from `planeWorldCorners`)
- Test: `planeWorld.test.ts`, `planController.test.ts`, `ZonesPart` tests in `parts.test.ts`, `undo` store test

**Interfaces:**
- Consumes: Tasks 4, 10, 11.
- Produces:
  - `planeWorldCorners(zone: CalcZone, room: RoomConfig): [number, number, number][]`: world corners of the plane's outline.
    - Wall planes: from `wallSegment`, `wall_vertices` (or the whole wall) and `normal_offset`.
    - Floor and ceiling planes: from `vertices` or the x/y bounds at `height`.
    - XZ/YZ planes not on a wall (legacy): from the existing bounds.
  - `planeNormal(zone, room): [number, number, number]`.
- `ZonesPart.addZone('plane')` defaults by `ctl.surface`:
  - floor: `{surface:'floor', fit_room:true, height: eye}` (1.8 m in units);
  - ceiling: `{surface:'ceiling', fit_room:true, height: roomZ, direction:-1}`;
  - wall i: `{surface:'wall:i', fit_room:true, normal_offset:0, flip:false}`, with no `wall_vertices`.
- Volumes and points are always floor.
- Drawing:
  - Draw on the current surface commits a polygon.
  - On a wall it goes to `wall_vertices` (along, up), with `fit_room:false`.
  - On the floor or ceiling it goes to `vertices`, with `fit_room:false`.
- On a wall surface, the selected wall plane's outline is the editable draft: body and corner drags, via `commitDraft`.
- `CalcPlane3D` draws any plane from `planeWorldCorners`, keeping its value-texture mapping for axis-aligned planes. For angled wall planes it maps the values grid along the wall (u) and up (v).

- [ ] **Step 1: Write failing tests:**
  - `planeWorld.test.ts`:
    - a whole wall plane on an angled wall gives 4 corners on the wall line, at z 0 and roomZ;
    - `normal_offset` 0.5 shifts the corners by 0.5·n;
    - flip keeps the corners and reverses `planeNormal`;
    - a ceiling plane's corners sit at `height`.
  - `parts.test.ts`:
    - `Plane on a wall surface creates a whole-wall plane on that wall`
    - `Plane on the ceiling faces down at the ceiling`
  - `planController.test.ts`:
    - `drawing on wall:1 sets wall_vertices in wall coordinates and clears fit_room`
    - `dragging a wall plane's corner on its wall updates wall_vertices`
  - Undo store test: `undo after adding a wall plane and drawing its outline restores the previous zones` (Review Focus 5).

- [ ] **Step 2: Run them and confirm they fail.** Run them. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests.** They pass, along with `pnpm test:run` and `pnpm check`. e2e `plan-zones.spec.ts` passes. Add a test there: `add a plane on Wall 2, calculate, and it has results`. This uses `showMain(page,'2d')`, the Walls select, Add zone › Plane and Calculate, and expects the zone's stats row to show a number.

- [ ] **Step 5: Commit.** `feat(zones): planes are added and drawn on the surface in view, including walls and the ceiling`

### Task 15: Zone editor rebuilt

**Files:**
- Create: `ui/src/lib/workspace/zones/ZonePanel.svelte` (picks the fields by type)
- Create: `ui/src/lib/workspace/zones/PlaneFields.svelte`
- Create: `ui/src/lib/workspace/zones/VolumeFields.svelte`
- Create: `ui/src/lib/workspace/zones/PointFields.svelte`
- Create: `ui/src/lib/workspace/zones/GridPointsFold.svelte`
- Create: `ui/src/lib/workspace/zones/DisplayFold.svelte`
- Create: `ui/src/lib/workspace/zones/zoneFields.ts` (pure helpers: distance ↔ geometry per surface, spacing text)
- Create: `ui/src/lib/workspace/zones/zoneFields.test.ts`
- Create: `ui/src/lib/workspace/zones/ZonePanel.test.ts`
- Modify: `ui/src/routes/+page.svelte` (`planZonePanel` snippet :1232 renders `ZonePanel`)
- Modify: `ui/src/lib/workspace/parts/ZonesPart.svelte` (rows: no `subtitle`)
- Modify: `ui/src/lib/plan/planController.svelte.ts` (remove `zoneSummary` if unused)
- Delete: `ui/src/lib/components/ZoneEditor.svelte` and `ZoneEditor.test.ts`, once nothing imports them
- Modify: `e2e/helpers/zones.ts` (`zoneEditor` selector → `.zone-panel`), plus the e2e specs that used ZoneEditor controls
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Tasks 4, 10, 14. The existing `project.updateZone`, the `pickMode` store (`'point_position'`, `'aim_point'`) and the `ep-disc` fold-out class in `parts.css`.
- Produces:
  - `ZonePanel.svelte` props `{ zone: CalcZone; room: RoomConfig; isStandard: boolean }`. It renders `div.zone-panel` and commits each change with `project.updateZone(zone.id, partial)` on change/blur, as `ObjectEditor` does. There is no local mirror state.
  - **Plane:**
    1. Calculation `select` (the existing calc-mode options and View direction / Target sub-fields, kept as they are).
    2. One distance field with a Flip button (`button[aria-label="Flip"]`, ⇅), labelled by surface:
       - "Height" on the floor (writes `height`);
       - "Below ceiling" on the ceiling (writes `height = roomZ − v`);
       - "From wall" on a wall (writes `normal_offset`).

       Flip writes `direction: −direction` on floor or ceiling, and `flip: !flip` on a wall.
    3. A divider, then full-width `.plan-btn` buttons: "Draw on floor/ceiling/wall" (calls `ctl.startZoneDraw('plane')`) and "Fit to room" or "Fit to wall" (`fit_room:true`, clearing the outline).
    4. ▸ Geometry: the corners table via `ShapeGeometryFields`, in wall coordinates on a wall. Read-only for legacy planes parallel to no wall.
    5. `GridPointsFold`.
    6. `DisplayFold`.
  - **Volume:**
    1. Bottom and Top fields (`z_min`, `z_max`) in a 2-column `.dims` grid.
    2. A divider, then "Draw on floor" and "Fit to room" (sets `fit_room:true`, `z_min:0`, `z_max:roomZ`).
    3. ▸ Geometry, `GridPointsFold` (three axes), `DisplayFold`.
  - **Point:**
    1. "Position" and "Aim at" rows, each a 3-column grid of X, Y, Z inputs at `width:100%; min-width:0`.
    2. "Place" (starts the `'point_position'` pick) and "Aim" (starts `'aim_point'`) in one row.
    3. ▸ Display, then ▸ Advanced (the existing custom flags and FOV fields).
  - `GridPointsFold` (`button.ep-disc` "Grid points", closed by default, with the current value at the right, e.g. "10 × 12"):
    - a "Points | Spacing" segmented control (`resolution_mode`);
    - two or three number fields (X × Y, or "Across" × "Up" on a wall, plus Z for volumes);
    - the spacing value text;
    - an "Inset | On edge" segmented control (`offset` true/false).
  - `DisplayFold` (`button.ep-disc` "Display", closed by default, with the value type at the right):
    - the Value display select;
    - Exposure time when `dose`;
    - a segmented control: "Heatmap | Numeric | Contours | Markers | None" for planes, "Iso | Numeric | Markers | None" for volumes, keeping the existing numeric-disabled rule;
    - a "Show label" checkbox.
  - **Removed:** the Type switch, the presets, the Whole room checkbox, the Reference surface and Normal direction controls, the Delete / Copy / Close footer and the help texts.
  - **Standard zones:** only `GridPointsFold`, open by default.
  - Rows show only the icon, name, eye and calculator (`ItemRow` without `subtitle`).
  - `zoneFields.ts`:
    - `distanceOf(zone, surface, roomZ): number`
    - `distancePartial(zone, surface, roomZ, v): Partial<CalcZone>`
    - `flipPartial(zone, surface): Partial<CalcZone>`
    - `gridSummary(zone): string`, e.g. '10 × 12' or '10 × 12 × 8'

- [ ] **Step 1: Write failing tests:**
  - `zoneFields.test.ts`: the distance round-trip for each surface; flip on floor negates `direction`, flip on a wall toggles `flip`; `gridSummary` for a plane and a volume.
  - `ZonePanel.test.ts`:
    - `plane on floor shows Height and Flip, Draw on floor, Fit to room, and folded Geometry, Grid points and Display`
    - `plane on ceiling labels the distance Below ceiling and writes height = roomZ − value`
    - `plane on a wall labels it From wall and writes normal_offset`
    - `no Type switch, no presets, no Whole room checkbox, no Delete/Copy/Close`
    - `volume shows Bottom and Top`
    - `point shows Position and Aim at rows with X Y Z and Place / Aim buttons`
    - `Grid points fold shows Points | Spacing and Inset | On edge, closed by default with the summary`
    - `standard zone shows only Grid points`
    - `a zone changed elsewhere shows the new values` (no stale mirror)
  - `parts.test.ts`: `zone rows show no subtitle`.

- [ ] **Step 2: Run them and confirm they fail.** Run them. Expected: FAIL.

- [ ] **Step 3: Implement.** Delete `ZoneEditor` once unreferenced. Update `e2e/helpers/zones.ts` and the specs that touched removed controls (grep `e2e/` for `zone-type-btn`, `Whole room`, `Head Height`, `Reference Surface`, `delete-btn`). Add a CHANGELOG entry: "Zone editor rebuilt: no type switch or presets; a plane shows its distance from its surface with Flip, Draw and Fit buttons, and folds Geometry, Grid points and Display away; rows show only the name."

- [ ] **Step 4: Run all the tests.**
  - `pnpm test:run` passes and `pnpm check` reports 0 errors.
  - e2e `plan-zones`, `workflow`, `save-load`, `guided`, `report` and `plot-settings` pass (each failing spec rerun alone before calling it a regression).
  - Throwaway Playwright measurement at 1440×900, dark theme, editor at 300 px: no element inside `.zone-panel` has `scrollWidth > clientWidth`, and no element's right edge passes the panel's right edge, for a plane, a volume and a point. Delete the script afterwards.

- [ ] **Step 5: Commit.** `feat(zones): rebuilt zone editor that fits the column`

### Task 16: Notes and final sweep

**Files:**
- Modify: `CHANGELOG.md` (check that every entry above reads as one coherent `[Unreleased]` section)
- Create: `docs/superpowers/notes/2026-10-27-zones-surfaces-docking-deferred.md` (rulings and deferred items gathered from the ledger)

- [ ] **Step 1: Run the full sweep.**
  - `cd ui && pnpm test:run && pnpm check`
  - `cd api && ../scripts/guv-calcs.sh exec uv run pytest -q -m "not slow"`
  - e2e: the full suite from `e2e/`, failures rerun alone.

  Expected: all green.

- [ ] **Step 2: Write the notes file.** It holds the ledger's rulings (what, why, cost if wrong) and the deferred items.

- [ ] **Step 3: Commit.** `docs: round 3 rulings and deferred items`
