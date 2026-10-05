# Per-plane reflectance: room surfaces and obstacle faces

**Date:** 2026-10-04
**Scope:** guv-calcs (library), illuminate-v2 API, illuminate-v2 UI
**Status:** design approved in conversation; implemented autonomously, user to review the feel

## Goal

Objects don't have uniform optics on every side. Let the user set reflectance
(and, for obstacles, transmittance) per plane in the room: every room surface
and every face of every obstacle. Keep the common case trivial: one number in
the sidebar applies to every surface, 0.078 prefilled. Keep the modal's
default view to optics only; grid resolution and interreflection settings
are advanced. Calculation-point dots are hidden unless asked for.

## What already exists

- guv-calcs 0.7.3 (the PyPI pin) `Object` keeps a `Surface` per face, keyed
  `top`, `bottom`, `wall_0…wall_{n-1}`, each with its own R and T.
  `get_face_properties`/`set_face_properties(R, T, face=None)` exist and
  validate R + T <= 1 per face. `to_dict` writes a sparse `face_properties`
  map holding only faces that differ from the object-level R/T;
  `from_dict` restores them. Reshaping an object carries face overrides by id.
- guv-calcs `Object.set_num_points(n, face=None)` only takes one count: a
  face gets an n×n grid, and `face=None` rebuilds every face from a single
  object-level `_num_points` (default 5). `Object.set_spacing(x, y, face)`
  already takes both axes. Room surfaces take `num_x`/`num_y` per wall via
  `Room.set_reflectance_num_points`.
- The API exposes a single object-level `reflectance`/`transmittance` and
  no face resolution. `GET /session/room/surfaces` lists room surfaces only.
- The UI: `ReflectanceStep` (sidebar step 3) has an enable checkbox, a
  "Walls…" button and an R/T row per object; `ReflectanceSettingsModal`
  shows a 3D room preview with grid dots always on, a table of room
  surfaces with reflectance and x/y spacing-or-points in every row,
  "0.078 (222nm)" / "0.05 (254nm)" quickset buttons, and an interreflection
  section. `ObjectEditor` has object-level R/T.

## Design

### guv-calcs

`Object.set_num_points(num_x=None, num_y=None, face=None)` mirrors
`Room.set_reflectance_num_points`: with a face it sets that face's grid per
axis; without one it applies to every face. The object-level `_num_points`
stays as the initial build resolution and `to_dict` keeps emitting it, so
existing files load unchanged. Positional calls `set_num_points(5)` keep
working (num_x only → square grid). `face_ids` keeps its order
(`bottom`, `top`, walls in edge order).

### API

`SessionObjectInput` / `SessionObjectState` / `SessionObjectUpdate` gain:

- `face_properties: Dict[str, FaceOptics]` where `FaceOptics = {R, T}`,
  sparse (only faces that differ from the object-level pair). On input it is
  applied after the object-level pair; on update, an object-level R/T in the
  same request is applied first, then the face map, so "set all then
  override" is one request. Setting only the object-level pair resets every
  face (guv-calcs semantics). Unknown face ids are a 400 via `ValueError`.
- `face_x_spacings`, `face_y_spacings`, `face_x_num_points`,
  `face_y_num_points: Dict[str, float|int]` keyed by face id, same flat
  shape the room uses. State echoes the current values for every face.

`GET /session/room/surfaces` adds object faces under `"{object_id}:{face}"`
so the modal can show the backend's actual grids for every plane.

Objects are rebuilt on shape change by `_rebuild_object`; it must carry
face optics and per-face resolution over by id (optics already are).

### UI data model

`SceneObject` keeps `reflectance`/`transmittance` as the object-level
baseline and gains:

```ts
face_properties: Record<string, { R: number; T: number }>;   // sparse overrides
face_spacings: Record<string, { x: number; y: number }>;
face_num_points: Record<string, { x: number; y: number }>;
```

Helpers in `$lib/utils/objectFaces.ts`:

- `objectFaceIds(obj)`: `['bottom', 'top', 'wall_0', …]` from the footprint
  (4 walls for a box, n for an extrusion), matching guv-calcs order.
- `faceLabel(id)`: "Bottom", "Top", "Side 1"….
- `faceOptics(obj, id)`: override or object-level pair.
- `faceSpans(obj, id)`: physical x/y extents of a face for spacing↔points.
- `withFaceOptics(obj, id, {R, T})`: returns the updated sparse map (drops
  the entry when it equals the object-level pair).

`project.updateObject` already routes through the sync queue; no new sync
command. Migration: objects without the three maps get `{}`.

### Sidebar step

Enable checkbox, then one row: label "Reflectance", a `ValidatedNumberInput`
prefilled with the common value (0.078 by default), and an "Edit surfaces…"
button. Committing the input sets R on every room surface and R on every
object face (object-level R, overrides cleared on R only — each override's
R becomes the new value, T is kept). When the room surfaces and object faces
don't all share one value the input is blank with placeholder "mixed".
The per-object R/T rows leave the sidebar. The object editor keeps its R/T
fields as the object-level quickset with a hint pointing at the modal.

### Modal

Left column: the 3D preview. Below it a "Show grid points" checkbox,
off by default, modal-local.

Right column, scrollable:

- **Room surfaces** group, open by default. Header: name, a quickset R
  input (blank/"mixed" when they differ) and a chevron. Body: a row per
  surface (floor, ceiling, walls in edge order) with an R input.
- One **obstacle** group per object, in `$objects` order, collapsed by
  default. Header: object name, quickset R and T inputs, chevron. Body: a
  row per face (bottom, top, sides) with R and T inputs, each input's max
  derived from the other so the pair stays valid before the request.
  Disabled objects are listed but their group is dimmed.
- **Advanced** disclosure, closed by default. When open: the spacing/points
  mode switch, and every row (room and face) gains an x/y resolution pair
  with the computed counterpart below it, exactly the room table today.
  The interreflection max passes and threshold fields sit under it too.

Quickset labels say "0.078" plainly; no wavelength presets. `0.078` is the
room default already.

### Preview interaction

`ReflectancePreview3D` gets `objects`, `showPoints`, `selectedSurface` and an
`onSelect(key)` callback. Object faces render as individual meshes placed
with the object's position/rotation (same transform chain as
`SceneObject3D`), keyed `"{objectId}:{face}"`. Clicking a face or a room
surface calls `onSelect`; the modal expands the owning group, scrolls the
row into view, focuses its R input and highlights the plane. Hover/focus on
a row still highlights the plane. Grid points render only when `showPoints`
is on, bright for the selected plane and dim otherwise; face grids use the
face's num_points like room surfaces do.

### Testing

- guv-calcs: `set_num_points(num_x, num_y, face)` per face and for all
  faces; positional single count still square; to_dict/from_dict round trip.
- API: input with face overrides, update that sets object-level then face in
  one request, invalid R + T on a face rejected with the object untouched,
  unknown face id 400, per-face spacing/points echoed, surfaces endpoint
  lists faces, rebuild on reshape carries face optics and resolution.
- UI: `objectFaces` helpers; store quickset-all and "mixed" summary; sidebar
  step input behaviour; modal grouping, quickset per group, select-on-click
  expanding and focusing; existing room e2e still passes.

## Out of scope

- Per-face colouring in the main scene.
- Persisting the "show grid points" preference.
- Pricing object faces in the cost model.
