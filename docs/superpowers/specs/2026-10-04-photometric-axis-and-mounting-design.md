# Photometric axis and mounting for custom lamps

Date: 2026-10-04
Status: approved design, awaiting implementation plan

## Problem

Illuminate assumes the principal axis of a lamp's photometry points along the
aim direction (IES θ = 0, straight down by default). Every bundled 222 nm
preset is measured that way. Many 254 nm and upper-room fixtures are not:

- **Lumalier 1400 (and the rest of that family).** A one-directional
  horizontal sheet: peak at θ = 91°, φ = 0°, bilateral symmetry. With the
  default aim-down pose the physics is right, but "aim" means nothing to the
  user: pointing the beam into the room requires editing `angle`, tilting the
  beam is a sideways bank, and the housing box is drawn with its emitting face
  down and housing above, while the real fixture is a wall box with a vertical
  emitting face. The IES dimension triple is also in the file's frame: its
  1.26 ft "length" runs along the beam, so it is really housing depth.
- **Light Progress UV-Flow 4/10P-CL.** A four-way horizontal sheet (peaks at
  φ = 0/90/180/270, all power in θ = 85°–120°). Aim-down is physically right,
  and the photometry is centered on the device. But guv_calcs spans the housing
  box from `−surface_height/2` to `housing_height` along the aim axis, so the
  0.58 × 0.58 × 0.12 m device is drawn as a 6 cm slab hanging *below* the
  photometric point instead of ±6 cm around it.

There is no way to express either fact when importing a custom lamp.

## Goals

- Importing a custom lamp lets the user state, with a point-and-click preview,
  (1) which direction in the IES frame the beam goes and (2) how deep inside
  the housing the photometric center sits.
- After that, Illuminate's aim vector points where the beam goes: tilt,
  orientation, aim point, the aim arrow and the Horizontal placement all mean
  the obvious thing for upper-room fixtures.
- The housing box is drawn where the physical fixture is.
- Everything is lossless (the manufacturer's IES data is never resampled) and
  round-trips through `.guv` files, session init/reinit, the photometric web,
  calculations, reports and plots.
- Both properties live on the custom lamp definition and flow to placed
  instances, and can be corrected per instance in the advanced Fixture tab.

## Non-goals

- Free (arbitrary θ, φ, roll) photometric rotation. IES files put the
  principal axis on one of six axis directions essentially always; a free
  rotation needs a roll choice that is hard to show and rarely meaningful.
- New placement modes. The lamp editor's existing Horizontal placement is
  sufficient.
- Changing the bundled presets. All preset IES headers have zero height, so
  the housing-box fix leaves their drawing unchanged.

## Approach

Native in guv_calcs. Alternatives rejected: baking a rotation into the IES at
upload (lossy, breaks symmetry, exported files differ from the datasheet) and
wrapping the lamp in Illuminate's API (every guv_calcs code path that reads
photometry would need wrapping, and a `.guv` opened in plain guv_calcs would
silently lose the orientation).

## 1. guv_calcs model

### New properties

Both are `Lamp` constructor arguments and are included in `to_dict` /
`from_dict`, with defaults so old `.guv` files and lamp dicts load unchanged.

**`photometric_axis`** — a `ParseableEnum` (same pattern as `FixtureShape`)
with six values naming the direction, in the IES file's own frame, that the
fixture's beam goes:

| token            | IES direction            |
|------------------|--------------------------|
| `down` (default) | θ = 0                    |
| `up`             | θ = 180                  |
| `horizontal_0`   | θ = 90 toward φ = 0      |
| `horizontal_90`  | θ = 90 toward φ = 90     |
| `horizontal_180` | θ = 90 toward φ = 180    |
| `horizontal_270` | θ = 90 toward φ = 270    |

Each value owns a fixed 3×3 matrix **M** mapping IES frame → aim frame.
guv_calcs' photometric coords put θ = 0 on −z, θ = 90/φ = 0 on +x, and the
zenith (θ = 180) on +z. The aim frame is the existing local frame of
`LampOrientation` (−z = aim, +z = behind the surface, +x = along fixture
length).

- `down`: identity.
- `up`: R_y(180°).
- `horizontal_φ₀`: R_y(90°) · R_z(−φ₀). The yaw brings the beam onto +x; the
  pitch sends +x → −z (the aim) and the zenith +z → local +x. Local +x is the
  axis the existing pose math (`R_z(−heading)`, `R_y(bank)`, `R_z(−angle)`)
  sends to world-up when the lamp is banked to 90°, so a wall-mounted fixture
  with tilt 90° emits horizontally with the file's "up" pointing up in the
  room and `angle = 0`.

**`photometric_depth`** — a float field on `Fixture` (so it serializes in the
fixture dict), in the lamp's length units: the distance from the fixture's
emitting face back to the photometric center. Default 0 keeps today's
behavior. It converts with the other housing lengths on `set_units`.

### Frame separation

`LampOrientation` stays the pure aim pose and is not changed.
`Lamp.transform_to_lamp(coords)` and `Lamp.transform_to_world(coords, ...)`
become *photometric-frame* transforms by composing M with the pose:

- world → IES: `Mᵀ · R_pose · v`
- IES → world: `R_poseᵀ · M · v`

These two methods are already the only path used for intensity lookups and
web drawing: both `calc_manager._irradiance_at` sites, `Lamp.irradiance_at`
(including the near-field target at the `pose.inverse_rotation_matrix` call,
which switches to the composed inverse), `room_plotter`, `lamp_plotter`, and
Illuminate's preset photometric-web endpoint. `LampSurface._recompute` and
`LampGeometry.get_bounding_box_corners` call `pose.transform_to_world`
directly and keep doing so, so surface points and the housing box stay
perpendicular to the aim.

New public surface: `Lamp.photometric_axis` (property + `set_photometric_axis`)
and `Lamp.photometric_axis_matrix` (M), which Illuminate's session web endpoint
uses to build canonical coordinates. `Lamp.calc_state` includes the axis so
zone caches invalidate when it changes; depth affects display only and is not
included.

### Dimension remap

`LampSurface.set_ies` receives the axis and permutes the IES
(length, width, height) triple — IES length along x, width along y, height
along z — through |M| before storing, so for `horizontal_0` the IES height
becomes the surface length (local x), width stays width (local y) and the IES
length becomes the surface height / depth (local z). Housing defaults derived
from the surface follow. Explicit user dimensions (`_user_width` etc.) are
already in the aim frame and are never permuted. `set_photometric_axis`
re-derives dimensions from the stored IES unless the user overrode them.

### Housing box

`get_bounding_box_corners`, with d = `photometric_depth`, s = surface height / 2
and h = `housing_height`, spans the local aim axis as

```
z_min = min(−d, −s)
z_max = max(h − d, s)
```

The 3D luminous volume (s) is always shown in both directions, which it was
not before. With d = 0 the UV-Flow box becomes ±6 cm around the point.
"Centered" for any fixture is d = h / 2. Presets have s = 0, d = 0 and are
unchanged.

### Tests (guv_calcs)

- For each of the six axes, M maps the named IES direction to −z and the IES
  zenith to the expected aim-frame axis; M is orthonormal with det +1.
- A `horizontal_0` lamp banked to 90° and headed along +x produces the same
  irradiance field as a `down` lamp aimed down whose IES values are rotated
  analytically; `down` lamps are bit-identical to current behavior.
- Dimension permutation for each axis; user-set dimensions survive an axis
  change.
- Bounding box for the UV-Flow shape (s = 0.06, h = 0, d = 0) spans ±0.06;
  "centered" with h = 0.12, d = 0.06 spans ±0.06; presets unchanged.
- `to_dict` / `from_dict` round trip with both fields; legacy dicts without
  them load with defaults.

## 2. API contract

### Pass-through fields

`photometric_axis` (`Literal` of the six tokens) and `photometric_depth`
(float, session units) are added wherever the housing fields already appear:

- `SessionLampUpdate` (PATCH body). Axis is applied via
  `lamp.set_photometric_axis`; depth via a rebuilt frozen `Fixture`, as the
  housing dims are today.
- `AdvancedLampSettingsResponse`.
- `SetUnitsLampCoords` (depth converts with the other lengths; axis is not a
  length and is not included).
- The lamp snapshot in `session_core.py`, so init/reinit and `.guv` load return
  them.
- `SessionLampInput` for lamp creation, defaulting to `down` / 0.

### Upload ordering

`upload_session_lamp_ies` re-applies the lamp's current axis after
`load_ies`, so the dimension remap runs after `set_ies` has overwritten
surface units (mirrors the existing units fix-up at the end of that handler).

### Photometric web

- Preset endpoint: unchanged (already uses `lamp.transform_to_world`).
- Session endpoint: multiplies `photometric_coords` by M before scaling, so
  the returned mesh is in the aim frame and the frontend's existing quaternion
  code is untouched. Fixture bounds and surface points already return in the
  aim frame.

### New stateless analysis endpoint

`POST /lamps/analyze-ies`, next to `/lamps/content-hash`, sharing its upload
validation and size limits. Input: an IES file. Output:

- `suggested_axis`: token nearest the intensity-weighted mean emission
  direction (`down` for UV-Flow, `horizontal_0` for Lumalier).
- `axis_scores`: for each of the six tokens, the fraction of emitted power
  within 45° of that direction.
- `ies_dimensions`: `{width, length, height}` in meters as the file states.
- `web`: canonical photometric web in the file's frame (`vertices`,
  `triangles`), built by the same helper as the preset endpoint.
- `fixture_bounds_by_axis`: the eight housing-box corners (aim frame, meters,
  depth 0, housing height 0) for each of the six axes, so the preview can
  re-pose on click without another round trip.

### Contract and tests

Run `make generate-api`; alias new types in `ui/src/lib/api/contract.ts`.
API tests: PATCH round-trips both fields; unit change converts depth; session
web mesh for a `horizontal_0` lamp peaks along −z; analyze endpoint returns
`horizontal_0` / `down` for small synthetic files shaped like Lumalier /
UV-Flow; `.guv` save/load round trip of a lamp with a horizontal axis and
non-zero depth.

## 3. Custom lamp definition, picker and preview

### Definition

`CustomLampDef` gains `photometricAxis?: PhotometricAxis` and
`housing.photometricDepth?: number` (stored in `surface.units` like the other
lengths). `advancedFieldsFromDef` maps both onto the PATCH body, converting
depth to session units. Editing and re-saving a definition re-applies to its
instances through the existing path. Stored definitions without the fields
behave as today.

### Where the picker lives

An `Orientation & Mounting` block in the lamp manager form, shown once an IES
file is present (new upload or editing a saved definition). The same component
also appears on the advanced settings Fixture tab so a placed lamp can be
corrected without touching the library.

### `PhotometricAxisPicker.svelte`

A Threlte canvas plus a short control row.

- On IES change it calls the analyze endpoint once, cached by content hash.
  The web is drawn in the file's frame with six handles (small cones at the
  axis tips) labelled Down, Up, 0°, 90°, 180°, 270°. The suggested handle is
  pre-selected; handles with near-zero power score are dimmed.
- Clicking a handle, or clicking the web (raycast to the mesh, snapped to the
  nearest of the six by angle), selects an axis. The scene animates a short
  rotation into the aim frame: beam down, housing box behind it, aim arrow at
  the bottom. The box comes from `fixture_bounds_by_axis`, adjusted
  client-side for housing height and depth with the same formula as guv_calcs.
  `prefers-reduced-motion` skips the animation.
- Below the canvas: the depth control, a number input in the definition's
  units with two preset buttons, `At emitting face` (0) and `Centered`
  (housing height / 2, disabled until a housing height is set). The box slides
  live.
- A one-line readout states the result in words, e.g. "Beam exits toward 0° in
  the file; aim it horizontally to mount on a wall."
- Pure helpers (snapping, bounds formula, readout text, axis matrices) live in
  `ui/src/lib/utils/photometricAxis.ts` so they are unit-testable without a
  canvas. The scene reuses `FixturePreview3D`'s background/theme handling and
  `lampLocalToThree`.

### Lamp editor follow-through

When a definition with a horizontal axis is applied to a lamp whose aim is
still the default straight-down, the apply flow runs the existing Horizontal
placement once, so the first thing the user sees is a wall-mounted fixture
emitting into the room. Up-axis definitions stay aimed down.

### Layout

Single column at the modal's current width; canvas about 260 px tall so the
form stays scrollable on small screens. Editor components read and write the
store directly or use `$derived` (no mirrored `$state`), per project
convention. The `.svelte` files are edited with the project's tab-safe helper.

## 4. Testing and rollout

- guv_calcs: tests in §1.
- API: tests in §2 (`uv run pytest` in `api/`).
- UI: Vitest for `advancedFieldsFromDef` (both fields, unit conversion), for
  the `photometricAxis.ts` helpers, and a component test that the picker
  pre-selects the suggested axis and emits the chosen one. `pnpm check` at
  zero errors; `pnpm test:run` green.
- E2E: one Playwright test importing a Lumalier-shaped synthetic IES through
  the lamp manager, checking the picker suggests 0°, saving, applying to a
  lamp and asserting tilt 90°.
- Manual: the two real files (Lumalier 1400, UV-Flow) — web, box and a
  calculation each way.

Rollout order (the API cannot use new guv_calcs features until the PyPI pin
moves):

1. guv_calcs changes, committed per logical change with changelog entries
   (user cuts the release and bumps `api/pyproject.toml` / `uv.lock` together
   with the pending length-units commits).
2. API changes against the local editable guv_calcs; contract regenerated.
3. UI changes.
4. `CHANGELOG.md` entry under Unreleased.

Work happens on a feature branch in a worktree, committed frequently, with the
light verification loop (targeted tests plus the room e2e); no push or release
until the user says the round is done.
