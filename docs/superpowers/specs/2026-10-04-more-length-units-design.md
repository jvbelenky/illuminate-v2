# More length units: inches, centimeters, millimeters

**Date:** 2026-10-04
**Scope:** guv-calcs (library), illuminate-v2 API, illuminate-v2 UI
**Status:** implemented autonomously; user to review

## Review notes (what was found along the way)

- guv-calcs had two latent bugs that any non-meter room hit: a lamp restored
  from `to_dict()`/`.guv` had its emissive-surface size re-read from the IES
  file in meters but labeled in the room's units, and a grid in spacing mode
  could lose a point after conversion (7.9999999 → 7). Both fixed, with tests.
- The API must not use the new guv-calcs properties until the PyPI pin is
  bumped: CI tests against PyPI, and `make generate-api` uses `--no-sources`.
  `api/api/v1/units.py` carries its own abbreviation table for that reason,
  and the one API test that needs the grid fix is skipped on old guv-calcs.
- `api/tests/test_objects.py::TestObjectReport::test_report_lists_objects`
  already fails against PyPI guv-calcs 0.7.3 (it needs the unreleased report
  rows); unrelated to this work.
- IES header relabeling on `Lamp.set_units` was removed: the header only knows
  feet/meters and was never rescaled, so the IES keeps its native units and the
  surface converts at the boundary.


## Goal

Let a room be edited in any of five length units: meters, centimeters,
millimeters, feet, inches. Every unit must convert to every other unit
without loss (round trips within float tolerance), the backend must accept
all five everywhere it accepts `meters`/`feet` today, and each unit must
carry sensible default display precision, input step, and plan-canvas snap
so that editing in centimeters or inches feels as natural as meters or feet.

Yards exist in guv-calcs' `LengthUnits` but are not exposed in the app. A
`.guv` file saved in yards loads converted to meters.

## What already exists

guv-calcs 0.7.3 (the PyPI version CI tests against) already has
`LengthUnits` with `METERS`, `FEET`, `INCHES`, `CENTIMETERS`, `MILLIMETERS`
and `YARDS`, and `Room.set_units()` rescales dimensions, lamps, zones,
objects and surfaces for any pair. The API therefore needs no new guv-calcs
release to accept the new units; the guv-calcs changes below are polish that
can ship in the next release.

## Storage model (unchanged)

Lengths stay stored in the room's current display units on both sides, as
the 2026-07 review decided. The only canonical-unit storage remains the
floor-plan image placement (meters). Conversions keep happening at the one
boundary they do today: `PATCH /session/units`, which rescales in guv-calcs
and echoes the full geometry back to the store.

## Per-unit defaults

| unit        | abbrev | metric | decimals | round | step | fine step | snap   | grid cell |
|-------------|--------|--------|----------|-------|------|-----------|--------|-----------|
| meters      | m      | yes    | 1        | 2     | 0.1  | 0.01      | 0.1    | 1         |
| centimeters | cm     | yes    | 0        | 1     | 1    | 0.1       | 10     | 100       |
| millimeters | mm     | yes    | 0        | 0     | 10   | 1         | 100    | 1000      |
| feet        | ft     | no     | 1        | 2     | 0.1  | 0.01      | 0.25   | 1         |
| inches      | in     | no     | 0        | 1     | 1    | 0.1       | 3      | 12        |

- **decimals**: default room-level `precision` (display decimals) for that
  unit. Meters and feet keep the app's existing default of 1. When the user
  changes units the room precision moves to the new unit's default if it was
  still at the old unit's default; a user-chosen precision is kept.
- **round**: decimals kept when a value is *converted* into the unit (floor
  plan drafts, settings defaults, plane presets), one finer than display so
  266.69999 cm becomes 266.7. This is also guv-calcs' `LengthUnits.decimals`,
  used to round standard-zone heights (1.8 m → 70.9 in, 180 cm, 1800 mm).
- **step**: `step` attribute on room/lamp/zone/object position and size
  inputs (replaces the fixed `0.1` and the feet-only `0.25`).
- **fine step**: step for small dimensions (lamp housing and emissive
  surface), replacing the fixed `0.01`.
- **snap**: plan-canvas / floor-plan modal drawing snap (10 cm, 3 in).
- **grid cell**: 3D floor grid cell in display units (always 1 m or 1 ft).
  Section lines every 5 cells.

Equivalent-in-meters constants that were written as bare numbers
(`0.75`/`1.8` plane presets, `0.1` wall offset, `0.1` object height
clamp, 3D lifts and marker radii) are now converted from meters into the
current unit at the point of use.

## guv-calcs changes

- `LengthUnits` gains `abbreviation` (`m`, `ft`, `in`, `cm`, `mm`, `yd`),
  `is_metric`, and `decimals` (the *round* column; yards 2). A module helper
  `round_length(value, units)` rounds to the unit's decimals.
- `generate_report()` labels area/volume with the room unit's abbreviation
  (`cm 2`, `in 3`, ...) instead of `m`-or-`ft`.
- `Room.get_efficacy_data()` chooses lps vs cfm with `is_metric`
  (millimeters were falling into cfm).
- `create_standard_zones()` rounds converted heights to the unit's
  decimals (1.8 m → 70.9 in, 180 cm, 1800 mm) so standard planes land on
  friendly values the way the hand-rounded feet values do.
- `LampPlacer` scales its meter-based wall offsets, ceiling offsets,
  clearances and tolerances into the room's units.
- `RoomPlotter._plot_lamp` photometric-web scale converted the wrong way
  (room → meters instead of meters → room); fixed.
- `Project(units=...)` validates through `LengthUnits.from_any` and stores
  the canonical token.
- Lamp `units` docstring corrected (int 1/2 is not feet/meters here).
- Tests: `LengthUnits` metadata; `Room.set_units` across every pair for
  lamps, zones, objects, polygon rooms, standard zones, and `to_dict`
  round trips; report labels; efficacy metric choice; placement offsets.

## API changes

- One `LengthUnit = Literal["meters", "centimeters", "millimeters", "feet",
  "inches"]` in `session_schemas.py`, used by `SessionRoomConfig`,
  `SessionRoomUpdate`, `SetUnitsRequest`, `SetUnitsResponse`, `LoadedRoom`,
  and `PhotometricWebRequest`.
- Room-extent bounds (`le=1000` m for x/y, `le=100` m for z,
  `ROOM_COORD_MAX`) and the 5 mm zone-spacing floor become unit-aware: the
  field keeps `gt=0`, and a shared validator converts the limit into the
  request's or session's units before comparing.
- Photometric-web endpoints use `guv_calcs.units.convert_length` instead
  of inlined `0.3048` feet branches, for all units.
- `POST /session/load` converts a room in an unsupported unit (yards) to
  meters before building the response.
- Tests: units round trips through every pair via `PATCH /session/units`
  with lamps, zones and objects; init in each unit; bounds in cm/mm/in;
  photometric web in inches; load of a yards file.
- `make generate-api` regenerates `openapi.json` and `api-types.ts`.

## UI changes

- `ui/src/lib/utils/unitConversion.ts` becomes the single registry:
  `LENGTH_UNITS`, `LengthUnit` type, `UNIT_INFO` (table above),
  `isLengthUnit`, `metersPerUnit`, `unitsPerMeter`, `convertLength`,
  `lengthFactor`, `unitAbbrev`, `unitLabel`, `unitDecimals`, `unitStep`,
  `unitFineStep`, `unitSnap`, `gridCellSize`, `isMetric`, `fromMeters`,
  and `roomVolumeM3` generalized. `METERS_PER_FOOT`/`FEET_PER_METER` stay
  exported for the CI grep guard and legacy callers.
- Every hand-written `'meters' | 'feet'` becomes `LengthUnit`; every
  `=== 'feet' ? a : b` becomes a registry call.
- Unit selects (room editor, floor-plan modal, settings default units, lamp
  manager surface units) list all five units.
- `project.changeUnits` also moves room precision per the rule above.
- Settings default room size rescales via `convertLength`; lamp library
  definitions convert from their own unit to the session unit for any pair.
- 3D scene: grid cell/section from `gridCellSize`, perspective camera far
  plane scaled by room size, lifts/radii/aim lengths converted from meters.
- localStorage settings and `.guv` load validate the unit string with
  `isLengthUnit` and fall back to meters.
- Tests: registry conversions for all 20 pairs and round trips; store
  `changeUnits` echo for inches/cm; precision rule; lamp-def conversion
  inches → cm; FloorPlanModal snap/convert in inches; RoomEditor summary
  `cm²`; e2e room spec selects each unit and checks the summary suffix.

## Out of scope

- Storing geometry canonically in meters (deliberately not done).
- The PDF report branch (`pdf-report`, unmerged) has its own `_is_feet`
  labels; it should switch to the abbreviation helpers when merged.
- Rescaling IES file width/length when the header unit code is relabeled
  (pre-existing behavior for feet).
