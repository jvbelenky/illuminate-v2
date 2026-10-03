# Objects (obstacles) — Design

Date: 2026-10-02
Status: decided without a brainstorm dialogue (user asked for reasonable decisions and no
questions; review the Decisions table first when revisiting)

## Goal

Let a user place physical objects — desks, partitions, cabinets, columns — in the room so
that the simulation accounts for the light they block and reflect. guv-calcs already models
this (`Object`, `room.objects`, ray occlusion in `geometry/occlusion.py`); illuminate has
nothing. This spec is the full vertical slice: backend API, session snapshot, save/load,
sync queue, store, sidebar, 3D view, tests.

## What guv-calcs already provides (v0.7.0+, so the PyPI 0.7.3 pin has it)

- `Object(object_id, name, position, yaw, pitch, roll, R, T, enabled, num_points, _shape)`
  with factories `Object.box(width, length, height, …)` and
  `Object.extrusion(polygon, height, …)`; `move`, `rotate`, `set_dimensions`,
  `set_face_properties(R, T)`, `set_reflectance`, `set_transmittance`, `copy`, `_assign_id`,
  `to_dict`/`from_dict`, `convert_units`, `nudge_into_bounds`.
- **Origin convention:** `position` is the centre of the footprint at the object's base
  (z = bottom face). A box footprint is centred on `position`; an extrusion's polygon is
  translated so its centroid sits on `position`. Rotation is `Rz(yaw) @ Ry(pitch) @ Rx(roll)`
  in degrees, applied about that origin.
- `room.objects` (`ObjectRegistry`), `room.add_object(obj, on_collision=…)`,
  `room.remove_object`, `room.set_units` converts objects, `room.to_dict`/`Room.load`
  round-trip `"objects"`, `room.check_positions()["objects"]`,
  `room.objects.nudge_into_bounds()`, `get_calc_state()["objects"]` hash, and
  `Room.calculate` uses `all_surfaces` (walls + enabled object faces) for both reflectance
  incidence and occlusion. Verified: a 1×1×1.5 box under a beacon lamp lowers the mean of a
  30×20 plane at 0.5 m from 0.084 to 0.057 µW/cm².
- Collision policy defaults to `increment`; passing `on_collision="error"` raises `KeyError`
  (the same hook lamps/zones use to produce a 409).
- Validation raises plain `ValueError` (dimensions must be positive, `R`/`T` in [0, 1],
  `R + T <= 1`), which `_log_and_raise` passes through to the user verbatim.

No guv-calcs change is needed, and none is made.

## Decisions

| Question | Decision |
|---|---|
| Name in the UI | "Objects" (matches guv-calcs and the request; "obstacle" appears only in help text) |
| Shapes created in the UI | **Box** only. Extruded-polygon objects loaded from a `.guv` are fully rendered and editable (position, rotation, height, bounding width/length scale, R, T, name, enabled); their footprint vertices are read-only in this iteration |
| Why no footprint drawing yet | The user wants spatial editing in a large draw-first modal, never a vertex table. `FloorPlanModal.svelte` is ~1500 lines and room-specific; a footprint editor is its own feature. Recorded under Out of scope |
| Rotation fields | Yaw is a first-class field. Pitch and roll are stored, round-tripped and rendered, and editable under an "Advanced" disclosure in the editor |
| Optical properties | One reflectance and one transmittance per object, applied to all faces. Per-face `face_properties` from a Python-authored file survive load/save untouched until the user edits R or T, which then applies to every face (documented in the editor tooltip) |
| ID authority | Client-minted `object-N` via `nextEntityId`, backend 409 on collision, exactly like lamps/zones |
| Units | Values are in the room's current units on both sides. Unit changes go through `PATCH /session/units`, which now echoes object coordinates/dimensions/vertices too |
| Sync | `object-update` (coalescing, optimistic) and `object-delete` (supersedes queued updates) commands; add and copy await the API directly, like zones |
| Staleness | `StateHashes` gains `objects`; `needsCalculation` treats a changed objects hash like a changed lamps hash (whole-room stale) |
| 3D | Solid grey box/extrusion with edge lines; opacity falls with transmittance; click selects (opens the editor and scrolls to it); hover highlights; disabled objects are drawn dim and dashed. No drag gizmo (lamps and zones have none either) |
| Floor-plan editor | Object footprints are drawn as faint context outlines, like the lamp dots |
| Position warnings / nudge | `/check-positions` and `/nudge-into-bounds` include objects; the store's `nudgeEntitiesIntoBounds` applies nudged object positions |
| Grid resolution (`num_points`) | Not exposed. Default 5 per face |

## Data model

### Backend (`api/api/v1/session_schemas.py`)

```python
class SessionObjectInput(BaseModel):
    id: Optional[str]            # client-minted; None keeps guv-calcs' own naming
    name: Optional[str]
    shape: Literal["box", "extrusion"] = "box"
    width: float > 0             # box: X extent; extrusion: ignored on create
    length: float > 0
    height: float > 0
    vertices: Optional[list[tuple[float, float]]]  # extrusion only, ≥ 3, room units
    x, y, z: float = 0           # base-centre position, room units
    yaw, pitch, roll: float = 0  # degrees
    reflectance: float = 0.0     # 0..1
    transmittance: float = 0.0   # 0..1, reflectance + transmittance <= 1
    enabled: bool = True

class SessionObjectUpdate(BaseModel):   # all Optional; shape and vertices are not updatable
class SessionObjectState(BaseModel):    # everything above plus id (required) and shape
class AddObjectResponse(BaseModel):     # object_id, state: SessionObjectState, state_hashes
class SessionObjectUpdateResponse(BaseModel)  # object_id, state, state_hashes
class GetObjectsResponse(BaseModel):    # objects: list[SessionObjectState]
class LoadedObject = SessionObjectState (alias)
class SetUnitsObjectCoords(BaseModel):  # x, y, z, width, length, height, vertices
```

`SessionInitRequest.objects: list[SessionObjectInput] = []`.
`LoadSessionResponse.objects: list[LoadedObject] = []`.
`SetUnitsResponse.objects: Dict[str, SetUnitsObjectCoords] = {}`.
`NudgedObjectPosition` and `NudgeIntoBoundsResponse.objects`.
`PositionWarningItem` already carries `entity_type`; `check-positions` adds `"object"`.
`SessionStatusResponse` gains `object_count` / `object_ids`.

Mapping to guv-calcs lives in two helpers in `session_helpers.py`:
`_create_object_from_input(inp) -> Object` and `_object_to_state(obj) -> SessionObjectState`
(width/length from the `width`/`length` properties, vertices from
`shape["polygon"]["vertices"]` for extrusions).

### Frontend (`ui/src/lib/types/project.ts`)

```ts
export type ObjectShape = 'box' | 'extrusion';
export interface SceneObject {
  id: string;
  name?: string;
  shape: ObjectShape;
  width: number; length: number; height: number;   // room units
  vertices?: [number, number][];                   // extrusion only, read-only in the UI
  x: number; y: number; z: number;                 // base-centre position
  yaw: number; pitch: number; roll: number;        // degrees
  reflectance: number; transmittance: number;      // 0..1
  enabled: boolean;
}
Project.objects: SceneObject[]
StateHashes.objects?: number | null
```

`defaultObject(room, overrides)` places a 1 × 1 × 1 (metres; 3 × 3 × 3 feet) box at the
room's floor centre with R = 0, T = 0, named by its id. `defaultProject` and
`loadFromStorage` default `objects` to `[]` so stored projects from before this change load.

## Backend endpoints (`api/api/v1/object_session_routers.py`, prefix `/session/objects`)

| Method | Path | Notes |
|---|---|---|
| POST | `/` | `locked_session`; `on_collision="error"` when an id is given → 409 `Object id 'x' already exists`; returns `AddObjectResponse` |
| PATCH | `/{object_id}` | `locked_session`; `_get_object_or_404`; applies name, enabled, move, rotate, `set_dimensions`, `set_face_properties(R, T)` (read the current value for whichever of R/T is omitted so the pair is validated atomically) |
| DELETE | `/{object_id}` | `locked_session`; `SuccessResponse` |
| POST | `/{object_id}/copy` | `CopyEntityRequest.new_id`; `obj.copy(object_id=new_id)`; 409 on collision |
| GET | `/` | no lock, snapshot iteration |

Also: `/init` adds objects after zones; `/load` returns `objects`; `/units` echoes them;
`/check-positions` and `/nudge-into-bounds` include them; `/status` counts them.

Router registered in `session_routers.py`. Then `make generate-api`, and alias
`SessionObjectState`, `AddObjectResponse`, `SessionObjectUpdateResponse`,
`SessionObjectInput`, `SessionObjectUpdate`, `SetUnitsObjectCoords` in `contract.ts`.

## Frontend

### API client (`lib/api/client.ts`, `lib/api/schemas.ts`)

`addSessionObject`, `updateSessionObject`, `deleteSessionObject`, `copySessionObject`,
`getSessionObjects`. Zod: `LoadedObjectSchema`, `LoadSessionResponseSchema.objects`
(default `[]`), `SetUnitsResponseSchema.objects` (default `{}`),
`NudgedObjectPositionSchema`. MSW handlers for the new routes.

### Store (`lib/stores/project.ts`)

- `mintEntityId('object', …)`; `entityId.ts` prefix union gains `'object'`.
- `projectToSessionInit` maps `objects` via `objectToSessionObject`.
- `addObject(overrides?)`: mint id → `addSessionObject` → store write → `applyStateHashes`.
- `updateObject(id, partial)`: optimistic store write, enqueue `object-update`.
- `removeObject(id)`: store write, enqueue `object-delete`.
- `copyObject(id)`: mint id, `copySessionObject`, store write.
- `applyObjectServerValues(id, state)`: echo write (plain store write).
- `syncQueue.ts`: `SyncCommand` gains `object-update {id, partial}` and
  `object-delete {id}`; `findCoalesceTarget` and `supersedeRelated` handle them by kind
  prefix exactly as for zones; executors call the API and apply the echo.
- `syncOperationLabel` covers the new kinds.
- `changeUnits` applies `response.objects` (x, y, z, width, length, height, vertices).
- `loadFromApiResponse` maps `response.objects`.
- `nudgeEntitiesIntoBounds` applies `response.objects`.
- `needsCalculation`: `objects` hash differs → stale.
- Derived `objects` store; `window.__illuminate_store__.objects` for e2e.

### Sidebar (`routes/+page.svelte`)

An **Objects** panel after Calc Zones with the same anatomy as Lamps: header with
visibility eye and collapse, "Add Object" button, list rows (`data-object-id`) with
enabled checkbox, name, copy, delete (confirm dialog, `pendingDelete.type = 'object'`),
and an inline `ObjectEditor`. Editing state `editingObjects`, `hoveredObjectId`,
`selectedObjectIds`, `highlightedObjectIds`, per-id visibility, `toggleObjectEditor`,
`addNewObject`. `MenuBar` gets `onAddObject`. `StatusBar` shows an object count.
3D click dispatch: `clickType: 'object'`, priority after lamps and before zones (objects
are solid and smaller than zones).

### `ObjectEditor.svelte` (new)

Reads the store prop directly, no mirrored `$state`. Sections:
Name (text, commits on change) · Position X/Y/Z · Size Width/Length/Height · Rotation Yaw
· Optical Reflectance/Transmittance (0–1, step 0.05; the pair is sent together so the
backend's `R + T <= 1` check sees both) · Advanced (Pitch, Roll) · Shape line
("Box" or "Polygon footprint, N corners — editable in Python / future editor"). Numeric
inputs use `ValidatedNumberInput` with `oncommit → project.updateObject`.

### 3D (`lib/components/SceneObject3D.svelte`, new)

Wrapped in `<T.Group rotation.x={-π/2}>` so geometry is authored in room coordinates:
rotation about X by −90° maps room (x, y, z) to three (x, z, −y), the mapping the rest of
the scene uses. Inside: `<T.Group position={[x, y, z]} rotation={[roll, pitch, yaw]}
rotation.order="ZYX">` (three's `ZYX` is `Rz·Ry·Rx`, the guv-calcs matrix). Box:
`BoxGeometry(width, length, height)` translated by `height / 2` in z. Extrusion:
`THREE.Shape` from vertices minus centroid, `ExtrudeGeometry({ depth: height,
bevelEnabled: false })`. Material: `MeshStandardMaterial`, grey (`#9ca3af` light theme /
`#6b7280` dark), `opacity = 0.35 + 0.55 · (1 − transmittance)`, selected `#d946ef`,
highlighted `#60a5fa`, disabled `#888888` at 0.2 with dashed edges. Edges via
`EdgesGeometry`. Mesh `userData = { clickType: 'object', clickId }`.

### Floor-plan editor

`FloorPlanModal.svelte` accepts `objects?: SceneObject[]` and draws each footprint (box
rectangle rotated by yaw, or the extrusion polygon rotated by yaw, pitch/roll ignored for
the plan view) as a faint filled outline, in the same pass as the lamp dots.

## Error handling

- Backend validation errors from guv-calcs (`ValueError`) reach the user verbatim via
  `_log_and_raise`; pydantic constraints (`gt=0`, `ge=0, le=1`) catch the obvious ones
  before the room is touched.
- A failed `object-update` is reported through the sync queue's `onError` like zones (the
  optimistic value stays; the user sees the toast).
- Unknown object id → 404 `_get_object_or_404`.

## Testing

- **API** (`api/tests/test_objects.py`): add box (client id honoured), duplicate id 409, no
  id keeps guv-calcs naming, update every field, `R + T > 1` → 400 with the guv-calcs
  message, delete, copy with `new_id` + collision 409, GET list, init with objects,
  save/load round-trip including an extrusion, units conversion echoes object coords,
  calculate with an object produces lower values than without, check-positions and nudge
  include objects.
- **UI**: `entityId.test.ts` (object prefix), `schemas.test.ts` (LoadedObject),
  `syncQueue.test.ts` (object coalescing/supersede), `project.test.ts` (add/update/remove/
  copy objects, init payload includes objects, loadFromStorage backfills `objects`,
  units echo, needsCalculation with objects hash), `ObjectEditor.test.ts` (renders store
  values, commits via `project.updateObject`, sends R and T together).
- **e2e** (`e2e/tests/objects.spec.ts`, helper `e2e/helpers/objects.ts`): add an object,
  edit its width, confirm the backend state via GET `/session/objects`, delete it, and a
  save/load round-trip keeps it.
- `pnpm check` zero errors; `make generate-api` committed.

## Out of scope (recorded for later)

- Drawing / editing an extrusion footprint in the UI (needs a footprint modal; the floor
  plan modal's canvas is the model).
- Per-face reflectance/transmittance editing.
- Drag-to-move in 3D (no entity has it).
- Object labels in 3D.
- Presets (desk, partition, …) — trivial to add once the box flow exists.
- Per-object grid resolution (`num_points`).
