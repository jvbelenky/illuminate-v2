# Fixture editor: emitter orientation and offset within the housing

Date: 2026-10-05
Status: approved design, awaiting implementation plan

## Problem

A lamp's housing is drawn as a box glued to the emitter: centered on the
photometric point in X/Y, with its emitting face perpendicular to the beam and
the box extending straight behind it. The only freedom is
`photometric_depth` (how far the point sits behind that face), and the UI hides
even that because it cannot be negative.

Real fixtures do not look like that:

- A wall box whose window is in its underside (beam leaves the bottom face of a
  box that is mounted on a wall).
- An emitter near one end of a long housing, or a lamp that protrudes from the
  housing face.
- A linear source that runs across, not along, its housing.

The custom-lamp upload picker and the advanced Fixture tab both only offer the
beam direction in the IES file (Down / Up / Sideways) and the housing W/L/H.

## Goals

- The user can say, on upload and later in the advanced Fixture tab, which face
  of the housing the beam leaves, how the emitter is rolled on that face (90°
  steps), and where the emitter sits relative to that face (any X/Y/Z offset,
  negative allowed).
- A live 3D preview shows the housing box, the emissive surface and the beam.
- The lamp's X/Y/Z position remains the emitter (photometric center). The
  photometry and every calculation are unchanged; only the housing box moves.
- Room fit (`nudge_into_bounds`), ceiling placement and wall clearance use the
  real housing box.
- Old `.guv`, `.illum`, session and custom-lamp-library data load unchanged.

## Non-goals

- Free-angle emitter rotation (only the 24 axis-aligned orientations).
- Non-box housing shapes.
- Dragging the emitter in the preview; editing is numeric plus snap buttons.
- Drawing the emissive surface in the room viewer (it already draws surface
  points and the housing box from the backend).

## Approach

Native in guv_calcs, on `Fixture`, mirroring how `photometric_axis` was done.
Rejected: computing the housing box in Illuminate's API only. guv_calcs reads
the fixture for `nudge_into_bounds` and for ceiling/wall placement, so the two
would disagree, and a `.guv` opened in plain guv_calcs would lose the layout.

## Frames

- **Aim frame** (existing): origin at the emitter, beam along −z, +x = surface
  length, +y = surface width. `Lamp.pose` maps it to the world.
- **IES frame** (existing): `photometric_axis.matrix` maps it to the aim frame.
  Affects photometry only.
- **Housing frame** (new): the housing box's own axes — x = housing length,
  y = housing width, z = housing height. `Fixture.housing_matrix` maps it to the
  aim frame. Affects the housing box only.

With the defaults (beam leaves the bottom face, roll 0) the housing frame is the
aim frame, which is today's behavior.

## 1. guv_calcs model

### `HousingFace` (new `ParseableEnum`, `lamp/fixture.py`)

Which face of the housing the beam leaves through.

| token              | housing face | rotation to aim frame |
|--------------------|--------------|-----------------------|
| `bottom` (default) | −z           | identity              |
| `top`              | +z           | R_x(180)              |
| `front`            | +x           | R_y(90)               |
| `back`             | −x           | R_y(−90)              |
| `left`             | +y           | R_x(−90)              |
| `right`            | −y           | R_x(90)               |

Each rotation sends the face's outward normal to aim −z. `from_token` accepts
the tokens and `-z`/`+z`/`+x`/`-x`/`+y`/`-y`.

### `Fixture` fields

```python
housing_width: float = 0.0
housing_length: float = 0.0
housing_height: float = 0.0
beam_face: HousingFace = HousingFace.BOTTOM
roll: int = 0                                    # 0/90/180/270, about the beam
emitter_offset: tuple[float, float, float] = (0.0, 0.0, 0.0)
shape: FixtureShape = FixtureShape.RECTANGULAR
```

- `roll` is validated to {0, 90, 180, 270} (normalised mod 360).
- `emitter_offset` is the emitter's position in **housing axes**, measured from
  the center of the beam face. `(0, 0, 0)` = flush, centered on the face.
- `housing_matrix` (property) = `R_z(roll) @ face_rotation`, cleaned of float
  noise like `PhotometricAxis.matrix`.
- `photometric_depth` (property, read-only) = the offset component along the
  face's inward normal. For `bottom` this is `emitter_offset[2]`.
- `Fixture.from_dict` and the `Lamp` constructor still accept
  `photometric_depth`: when no `emitter_offset` is given it becomes
  `inward_normal * depth`, so legacy `depth = d` → `(0, 0, d)` for the bottom
  face. `to_dict` writes `beam_face`, `roll`, `emitter_offset` and, for
  readability, `photometric_depth`.
- Resizing the housing keeps the emitter at the same place relative to its face
  (because the offset is measured from the face center).

### Housing box

`LampGeometry.get_bounding_box_corners()`:

1. Face center in housing frame: e.g. bottom → `(0, 0, −H/2)`.
2. Emitter in housing frame: `e = face_center + emitter_offset`.
3. Corners in housing frame: `(±L/2, ±W/2, ±H/2) − e` (emitter at origin).
4. Aim frame: `housing_matrix @ corner`.
5. Keep today's union with the luminous opening's z-extent
   (`±surface.height/2` along aim z), applied as an aim-frame AABB, only when
   `surface.height > 0`.
6. `pose.transform_to_world` as today.

For bottom/roll 0/offset `(0, 0, d)` this is exactly today's box
(z from `−d` to `H − d`).

### `Lamp`

- Constructor kwargs `beam_face=None`, `housing_roll=None`,
  `emitter_offset=None` (plus the existing `photometric_depth`); `housing_units`
  conversion covers the offset.
- `Lamp.update_fixture(**changes)` — `dataclasses.replace` on the frozen
  fixture with token/unit parsing. The API uses this instead of building
  `Fixture(...)` by hand.
- `set_units` converts `emitter_offset`.
- `to_dict`/`from_dict`/`__eq__` and `from_keyword` preset `fixture` config
  accept the new keys.

### Placement (`lamp_placement.py`)

- `ceiling_offset`: the largest aim-frame +z of the housing box (how far it
  extends behind the emitter) + margin, instead of `housing_height`.
- `wall_clearance`: the largest aim-frame XY distance from the emitter to a
  housing corner, instead of the footprint half-diagonal.
- With default fixtures both reduce to today's values.

### Release

guv_calcs commits are allowed for this work (laconic lowercase messages,
changelog entry). Not pushed or released by me. Illuminate CI installs
guv_calcs from PyPI, so the Illuminate branch goes green only after the user
releases guv_calcs and the pin is bumped.

## 2. API

- `SessionLampUpdate` and `SessionLampInput` gain `beam_face`
  (`HousingFaceToken` literal), `housing_roll` (0/90/180/270) and
  `emitter_offset_x/y/z` (floats, any sign). `photometric_depth` stays as an
  accepted alias that sets the inward normal component; its `ge=0` limit is
  dropped.
- The PATCH handler applies fixture changes through `lamp.update_fixture`;
  preset/type rebuilds and the IES-upload default keep the new fields.
- The advanced-settings GET and the lamp read-back return `beam_face`,
  `housing_roll`, `emitter_offset_x/y/z` (and `photometric_depth`).
  `session_core` unit conversion covers the offset.
- `fixture_bounds` in the photometric-web responses already comes from
  `get_bounding_box_corners`, so the room viewer needs no change.
- Regenerate `openapi.json` / `api-types.ts`; alias in `contract.ts`.

## 3. UI

### Geometry port (`ui/src/lib/utils/housingGeometry.ts`)

A TypeScript port of `housing_matrix` and the housing-box corners (aim frame),
plus `matchFileFrame(axis)` → the `(beam_face, roll)` whose `housing_matrix`
equals the photometric axis matrix (so housing W/L/H read in the IES file's own
frame). A shared JSON test fixture generated from guv_calcs keeps the port and
the Python in agreement.

### `FixtureEditor.svelte` (shared)

Used by the upload flow (`LampManagerModal`) and the advanced Fixture tab
(`AdvancedLampTabFixture`), replacing their separate housing inputs, the
`PhotometricAxisPicker` and `FixturePreview3D` in the Fixture tab.

- **Beam direction in file** — the existing Down / Up / Sideways control with
  its "Detected from file" badge and azimuth select (`PhotometricAxisPicker`'s
  controls, minus the hidden depth block, which is deleted).
- **Housing** — W / L / H.
- **Beam leaves through** — six face buttons (Bottom, Top, Front, Back, Left,
  Right) and a "Rotate emitter 90°" button showing the current roll.
- **Emitter position** — X / Y / Z offset inputs in housing axes, negative
  allowed, with "Flush with face" (zero) and "Center of housing" snap buttons.
- **Preview** — one Threlte scene: housing wireframe, emissive surface
  rectangle (surface W × L at the emitter, perpendicular to the beam), beam
  arrow, housing axis labels, and the photometric web when available (analysis
  mesh on upload, session web in the advanced tab). It is computed client-side
  from the geometry port and updates as the user types. The housing is drawn
  upright (housing frame fixed, emitter and beam move), because that is how the
  user thinks about the physical box.
- On upload, while the user has not touched the housing orientation, changing
  the beam direction sets face/roll to `matchFileFrame(axis)` so the default
  housing dims (file extents) stay correct.

### Data

- `CustomLampDef.housing` gains `beamFace`, `roll`, `offset: [x, y, z]`.
  `photometricDepth` is migrated on read (`offset = [0, 0, depth]`) and no
  longer written.
- `advancedFieldsFromDef`, `applyCustomLamp`, session re-hydration and
  `updateLampFromAdvanced` carry the new fields (converted to session units).
- The advanced modal's client-side fallback box is replaced by the geometry
  port (fixes its swapped x/y and ignored depth).

## Testing

- guv_calcs: housing box for every face × roll with offsets; legacy-depth
  equivalence; `to_dict`/`from_dict` round-trip incl. 0.8.1 dicts; unit
  conversion; ceiling offset and wall clearance; generator for the shared TS
  fixture.
- API: PATCH/GET of the new fields, the `photometric_depth` alias, negative
  offsets, unit conversion, preset rebuild keeps the fixture.
- UI unit: geometry port against the fixture; `matchFileFrame`; editor
  controls and snap buttons; library migration of `photometricDepth`.
- e2e: upload a custom lamp with a non-bottom face and an offset, place it,
  open the advanced Fixture tab, see the values, edit the offset, and check
  that the room viewer's housing box moved.
