# Polygon Rooms — Design

Date: 2026-09-15

## Goal

Let a user model a room whose floor plan is any simple polygon (L-shaped, T-shaped,
chamfered corners, ...) with a uniform ceiling height, using the same lamps, zones,
reflectance and calculation flows that rectangular rooms use today.

## What guv-calcs already provides (v0.7.2)

Every `Room` is polygon-based internally: `RoomDimensions.polygon` is a `Polygon2D`,
rectangles are a 4-vertex axis-aligned special case. Lamp placement (`LampPlacer`),
position warnings, nudging, occlusion, standard zones and reflectance surfaces already
handle arbitrary simple polygons. Non-rectangular rooms name their walls `wall_0..wall_{n-1}`
(edge order, CCW); rectangular rooms keep `south, east, north, west`.

### Issues found and fixed in `~/guv-calcs` (uncommitted; user commits)

1. **No public way to change a room's polygon.** `Room.set_dimensions` only took x/y/z,
   and `_update_dimensions(polygon=…)` silently no-op'd on rectangular rooms.
   → `set_dimensions(x, y, z, polygon)` and `set_polygon(vertices, z)`. Passing x/y to a
   polygon room converts it back to a rectangle (unspecified axis keeps its bounding-box
   extent). `RoomDimensions.with_(x=, y=)` no longer ignores x/y on polygon dims.
2. **Stale wall surfaces after a shape change.** `_update_standard_surfaces` only
   overwrote; shrinking 6 walls → 5 left an orphan `wall_5` in the reflectance solve, and
   polygon → rectangle left `wall_N` alongside cardinal names.
   → stale room-wall surfaces are removed; reflectance/transmittance/grid resolution are
   carried over **by edge index**, so `south`→`wall_0` etc. survive the rename.
3. **Standard zones did not follow polygon changes.** `_resize_standard_zones` used
   `zone.set_dimensions(x1..y2)`, which `SurfaceGrid.update_dimensions` ignores for
   non-rectangular grids. → standard zones are rebuilt with `*Grid.from_polygon`,
   preserving `spacing_init`/`num_points_init`/`offset` and plane height.
4. **Degenerate polygons were accepted.** Repeated consecutive vertices produced NaN edge
   normals; zero-area polygons passed. → `Polygon2D` raises `ValueError` for non-pair /
   non-finite vertices, coincident consecutive vertices, self-intersection, zero area
   (user-facing messages, which `_log_and_raise` passes through).

## Data model

### Backend (session)

`SessionRoomConfig` / `SessionRoomUpdate` gain `polygon: Optional[list[tuple[float, float]]]`
(≥ 3 vertices, each coordinate ≥ 0). Init passes it to `project.create_room(polygon=…)`.
PATCH: `polygon` → `room.set_dimensions(polygon=…, z=…)`; `x`/`y` → rectangle. Sending
both is a 400.

Room geometry echo. `PATCH /session/room` now returns `RoomUpdateResponse`, which extends
`SuccessResponse` with `room: RoomGeometry`:

```
RoomGeometry { x, y, z, shape: "rectangle"|"polygon", vertices: [[x,y],…],
               wall_ids: [str], reflectances: {surface: R},
               reflectance_spacings: {surface: {x,y}}, reflectance_num_points: {surface: {x,y}} }
```

`x`/`y` are the bounding-box **max** coordinates (the frontend treats them as extents from
the origin). The same `RoomGeometry` is returned by `PATCH /session/units` (as `room`) and
`POST /session/load` (`LoadedRoom` gains `shape`, `vertices`; reflectances already dynamic).

`SurfaceReflectances` becomes `Dict[str, float]`; `CalcPlaneFromFace.wall` becomes `str`
(validated against the room's faces at runtime). Unknown surface ids in a reflectance
patch are a 400 (guv_calcs `KeyError` → ValueError message).

Masked grids. For non-rectangular zone grids the calculate endpoint expands values back
to the full bounding-box grid `(num_x, num_y[, num_z])` with `null` outside the polygon,
using `grid._xy_mask`. `num_points` reports the full-grid shape. Statistics are unchanged
(computed by guv_calcs on inside points only).

### Frontend (`RoomConfig`)

```
shape: 'rectangle' | 'polygon'      // default 'rectangle'
vertices?: [number, number][]       // polygon only, display units, CCW, all ≥ 0
x, y                                // extents: rectangle size, or polygon bbox max
```

`x`/`y` stay as the bounding-box extents so every existing consumer (camera, clamps,
zone defaults, rulers) keeps working. `SurfaceReflectances`, `SurfaceSpacings`,
`SurfaceNumPointsAll` become `Record<string, …>` keyed by surface id.

New `ui/src/lib/utils/roomGeometry.ts` (pure, unit-tested): `roomVertices(room)`,
`polygonArea`, `polygonBoundingBox`, `polygonCentroid`, `isAxisAlignedRectangle`,
`wallIdsFor(vertices)`, `surfaceIdsFor(room)`, `pointInPolygon`, `isSimplePolygon`,
`validatePolygon` (mirrors guv_calcs rules, returns a message), `edgeMidpoints`,
`distanceToBoundary`, `rayToBoundary`, `roomFloorArea`.

Migration: projects without `shape` get `shape: 'rectangle'`. Legacy reflectance records
already have the cardinal keys, which are exactly the rectangle wall ids.

## UI / UX

Room panel gets a **Shape** segmented control (Rectangle | Polygon) above the dimensions.

**Rectangle** (default): unchanged X / Y / Z inputs + units select. E2E selectors unchanged.

**Polygon**: Z input + units select, then a **floor-plan editor** (`FloorPlanEditor.svelte`,
SVG, fits the panel width):

- Polygon drawn in plan view (x right, y up, origin bottom-left, light grid at 1 unit,
  axes labelled). Existing lamps are shown as small dots for context.
- Drag a vertex to move it. Positions snap to 0.1 (meters) / 0.25 (feet); hold Alt to
  disable snapping. Coordinates are clamped to ≥ 0.
- A `+` handle at each edge midpoint inserts a vertex there.
- Click a vertex to select it; Delete/Backspace or the row's × removes it (min 3).
- While dragging, an invalid shape (self-intersecting, zero area) is drawn red and is not
  committed; releasing reverts to the last valid shape and shows the reason.
- A **vertex table** below (X, Y numeric inputs per vertex, ×) for precise entry, plus
  "Add vertex" (appends the midpoint of the closing edge).
- Read-out line: floor area, wall count.

Commits go through `project.updateRoom({ shape:'polygon', vertices })` (drag end / input
change). Switching Rectangle → Polygon seeds the four corners of the current rectangle.
Switching Polygon → Rectangle uses the bounding-box extents and sends `x`, `y`.

After a shape change the store applies the backend echo (wall ids, carried-over
reflectances, spacings) as a plain store write, then refreshes standard zones as it does
for dimension changes today, then calls nudge-into-bounds so lamps/zones stranded outside
the new outline are pulled back in (existing endpoint; response applied as a store write).

**3D scene**: `Room3D` draws the extruded polygon for all rooms — floor/ceiling as
`THREE.ShapeGeometry` (handles concave outlines), one quad per wall, wireframe from the
outline. Rulers stay on the bounding box. `Scene` camera/grid sizing is bbox-based and
unchanged.

**Reflectance settings**: surface rows are generated from `surfaceIdsFor(room)`; labels
are `Floor`, `Ceiling`, cardinal names for rectangles, `Wall 1..n` for polygons (with the
edge length in the tooltip). The 3D preview builds wall quads from polygon edges and
masks floor/ceiling grid points to the polygon.

**Lamp placement**: `lampPlacement.ts` becomes polygon-aware: downlight grid search over
the bbox restricted to inside points at ≥ wall-offset from the boundary; corners = polygon
vertices (offset inward along the vertex bisector), aiming at the farthest floor vertex;
edges = edge midpoints offset along the inward normal, aiming at the boundary hit along
that normal. For rectangles this reproduces today's positions and aims exactly.
`LampEditor` corner/edge aim cycling uses the same targets; `% 4` becomes `% n`.

**Zones**: user zones stay rectangular (bbox clamps unchanged). Standard zones are
polygon-masked on the backend; the frontend renders `null` cells as holes: `CalcPlane3D`
skips triangles touching a null vertex and null numeric labels; `CalcPlanePlotModal`
passes null through to Plotly (renders as gaps); `isosurface.ts` treats null as
"outside" (−∞) so the shell closes at the outline; `CalcVol3D` numeric labels skip null.
Value-range computations ignore null.

**Volume**: `roomVolumeM3(room, units)` uses `roomFloorArea(room) * z`.

## Out of scope (YAGNI)

- Holes / multiple polygons, non-uniform ceilings, sloped walls.
- Polygon-shaped user zones (guv_calcs supports `CalcPlane.from_polygon`; not exposed).
- Polygon default room in user settings.
- Drawing the outline directly in the 3D view.
- Object/furniture interaction changes.

## Testing

- guv-calcs: `TestPolygonRoom` gains tests for rect→polygon→rect conversion, reflectance
  carry-over by edge, stale-surface removal, standard-zone rebuild, degenerate rejection.
- API: init with polygon; PATCH polygon (echo, wall ids, reflectance carry-over);
  invalid polygon → 400 with guv_calcs message; polygon → rectangle; units conversion
  echoes vertices; calculate returns full-grid values with nulls; save/load round-trip.
- UI (vitest): `roomGeometry.test.ts` (area, bbox, point-in-polygon, simplicity,
  validation, wall ids, targets); `lampPlacement.test.ts` extended with an L-shaped room
  and a rectangle regression check; store tests for shape switching, echo application,
  migration; `unitConversion.test.ts` for polygon volume; `RoomEditor`/`FloorPlanEditor`
  component tests (toggle, vertex table edit, invalid input rejection).
- E2E: `room.spec.ts` gains a polygon scenario (switch shape, add a vertex via the
  table, verify wall count and that results still calculate).
- `make generate-api` regenerates `openapi.json` / `api-types.ts`; `pnpm check` at zero
  errors.
