# E2E Test Consolidation & Comprehensive Coverage

## Overview

Consolidate the existing 10 e2e test files into 6 focused, comprehensive tests. Eliminate redundancy, add thorough coverage for all lamp operations (placement modes, advanced settings), all zone operations (every geometry type, every calc mode), copy verification, reflections, file uploads, and save/load roundtrips.

## Current State

10 test files with ~25 individual tests. Significant overlap (e.g., `calculate.spec.ts`, `lamps.spec.ts`, and `zones.spec.ts` all add lamps/zones independently). Major features untested: reflections, file uploads, copy, multiple lamp types, placement presets, aim presets, tilt/orientation mode, advanced lamp settings, zone calc modes, reference surfaces, grid resolution, offset, bounds editing, dose settings, display modes.

## Target State

6 test files. Each file owns a clear domain. No redundant setup.

---

## Test Files

### 1. `smoke.spec.ts` — App Initialization

Single test verifying the app starts correctly:
- Navigate to `/`
- Session initializes (status indicator visible)
- Canvas renders
- Left panel sections visible (Room, Lamps, Calc Zones headers)
- Status bar shows lamp/zone counts

### 2. `workflow.spec.ts` — Comprehensive App Workflow

Uses `test.describe.serial` with a shared page. Multiple tests build on shared state (one session init, no redundant setup). This is the heaviest test file — exercises most UI interactions.

#### Test: "preset lamp: placement, aim, tilt, toggles, advanced settings"

Exercises ALL interactive lamp features on a preset lamp:

**Basic setup:**
1. Add lamp from preset → verify editor opens, `lampCount() === 1`
2. Edit position manually (x=2, y=3, z=2.5) via `.vector-row` inputs
3. Edit aim point manually (aimx=2, aimy=3, aimz=0)

**All 4 placement presets** (buttons in `.placement-buttons`):
4. Click "Downlight" → verify position changes (z should be at ceiling)
5. Click "Corner" → verify position changes
6. Click "Edge" → verify position changes
7. Click "Horizontal" → verify position changes

**All 4 aim presets** (buttons in `.aim-presets`):
8. Click "Down" → verify aim point changes (aimz should be 0)
9. Click "Corner" → verify aim point changes
10. Click "Edge" → verify aim point changes
11. Click "Horizontal" → verify aim point changes

**Tilt/Orientation mode:**
12. Click "Set Tilt/Orientation" mode switch → verify tilt/orientation inputs appear
13. Set tilt value (e.g., 30°) and orientation value (e.g., 45°)
14. Click "Set Aim Point" to switch back → verify aim point inputs reappear

**Toggles:**
15. Toggle "Show Label" checkbox
16. Toggle "Show Photometric Web" checkbox
17. Toggle lamp enable/disable (verify `.calc-disabled` class)

**Advanced settings modal** (4 tabs):
18. Click "Details..." button → modal opens with "Photometric and Spectral Info" tab visible
19. Click "Scaling & Units" tab → change scaling method via `select#scaling-method` to "Scale to max irradiance", set `#scaling-value`
20. Click "Luminous Opening" tab → set `#source-width` and `#source-length`
21. Click "Lamp Fixture" tab → set `#housing-width`, `#housing-length`, `#housing-height`
22. Close modal

#### Test: "custom lamp: file upload, wavelength, placement, advanced settings"

Exercises lamp features on a custom-upload lamp:

1. Add lamp with type "other" via `select#lamp-type`
2. Upload IES file via hidden `input[type="file"][accept=".ies"]` → verify `.file-status.success`
3. Set wavelength to 265 via `#wavelength` input
4. Use "Downlight" placement preset → verify position updates
5. Edit aim point manually
6. Open advanced settings → "Scaling & Units" tab → change scaling method to "Scale to total power", set value
7. Switch to "Luminous Opening" tab → set source dimensions
8. Close modal

#### Test: "plane zone: all calc modes, reference surfaces, grid, offset, bounds, dose"

Exercises ALL plane zone features:

**Basic setup:**
1. Add zone (defaults to plane) → verify editor opens
2. Set height to 1.5

**All 7 calc modes** (cycle through illustrated selector):
3. Set "Fluence Rate" → verify active
4. Set "Planar Normal" → verify active
5. Set "Planar Maximum" → verify active
6. Set "Eye (Worst Case)" → verify FOV inputs appear (`#fov-vert`, `#fov-horiz`), set FOV values
7. Set "Eye (Directional)" → verify view direction inputs appear (`.vector-row`), set direction values
8. Set "Eye (Target)" → verify target point inputs appear (`.vector-row`), set target values
9. Set "Custom" → verify custom flag checkboxes appear (cos(θ), sin(θ), block back-hemisphere), toggle each

**Reference surface** (illustrated selector):
10. Switch to XZ → verify bounds inputs change (X Range, Z Range)
11. Switch to YZ → verify bounds inputs change (Y Range, Z Range)
12. Switch back to XY → verify original bounds layout

**Grid resolution:**
13. Click "Set Spacing" mode toggle → verify spacing inputs appear
14. Set X and Y spacing values
15. Click "Set Num Points" → verify num points inputs appear
16. Set num_x and num_y values

**Offset:**
17. Toggle offset via illustrated selector (from default to opposite)

**Bounds:**
18. Edit plane bounds (x1, x2, y1, y2) via `.range-row` inputs

**Display mode:**
19. Switch to "Numeric" display mode (click `.zone-type-btn`)
20. Switch to "Markers"
21. Switch back to "Heatmap"

**Dose:**
22. Switch value type to "Dose" via `select#value-type`
23. Set time values: hours (`#dose-hours`), minutes (`#dose-minutes`), seconds (`#dose-seconds`)
24. Switch back to irradiance/fluence

**Final state:** leave zone with a specific calc mode (e.g., Fluence Rate) for later copy test.

#### Test: "volume zone: bounds, grid, offset, display"

1. Add zone → switch to volume type
2. Edit bounds: set x_min, x_max, y_min, y_max, z_min, z_max via `.range-row` inputs
3. Verify calc type is readonly (fluence rate / irradiance — no selector)
4. Toggle grid resolution mode, set values
5. Toggle offset
6. Switch display modes (Heatmap/Iso, Numeric, Markers, None)
7. Enable dose, set time values

#### Test: "point zone: position, aim, advanced flags, FOV, label"

1. Add zone → switch to point type
2. Set position (x=2, y=3, z=1) via `.vector-row` inputs
3. Set aim point (x=2, y=3, z=0) via `.vector-row` inputs
4. Expand "Advanced" section
5. Toggle custom flags: cos(θ), sin(θ), block back-hemisphere checkboxes
6. Set FOV values (`#fov-vert`, `#fov-horiz`)
7. Toggle "Show Label" checkbox

#### Test: "copy verification: all zone types"

Verifies copy creates appropriately identical backend objects:

1. Click into the plane zone → click Copy button → verify zone count increments
2. `GET /session/zones` → find original and copy by matching name (copy has " (Copy)" suffix)
3. Assert all fields match except `id` and `name`
4. Click into the volume zone → Copy → same backend verification
5. Click into the point zone → Copy → same backend verification
6. Verify total custom zone count = 6 (3 originals + 3 copies)

#### Test: "copy verification: lamp"

1. Click into the preset lamp → click Copy button → verify lamp count increments
2. `page.evaluate()` to read `$project.lamps` from store
3. Find original and copy, assert all fields match except `id` and `name`
4. Verify total lamp count = 3 (preset + custom + copy)

#### Test: "cleanup, standard zones, calculation, display settings"

1. Delete the 3 copied zones → verify zone count returns to 3
2. Delete the copied lamp → verify lamp count returns to 2
3. Toggle a standard zone on/off
4. Calculate → verify results appear (`.stat-value` visible)
5. Verify status bar shows "Last calculated:" timestamp
6. Toggle a display setting from the View menu (e.g., precision, show/hide grid)

### 3. `room.spec.ts` — Room Configuration & Validation

Single test covering room editing:
1. Edit room dimensions X=7, Y=5.5, Z=2.8 → verify values persist
2. Reject zero dimension (set X=0 → reverts to original)
3. Reject negative dimension (set Y=-3 → reverts to original)
4. Switch units to feet → verify dropdown value → switch back to meters

### 4. `save-load.spec.ts` — Comprehensive Save/Load Roundtrip

Single test verifying full project serialization/deserialization:

**Setup — Room:**
- Set room dimensions to X=6, Y=4, Z=3

**Setup — 5 Lamps:**

| # | Type | lamp_type | Configuration |
|---|------|-----------|---------------|
| 1 | 222nm preset | `krcl_222` | First available preset from dropdown |
| 2 | 222nm custom | `krcl_222` | Skip preset, upload `test-lamp.ies` |
| 3 | 254nm | `lp_254` | Upload `test-lamp.ies` |
| 4 | Other (wavelength) | `other` | Upload `test-lamp.ies`, set wavelength=265 |
| 5 | Other (spectrum) | `other` | Upload `test-lamp.ies`, upload `test-spectrum.csv` |

**Setup — 3 Zones:**

| # | Type | Non-default settings |
|---|------|---------------------|
| 1 | Plane | Height=1.5 |
| 2 | Volume | Type switched from default plane |
| 3 | Point | Type switched, position set to x=2, y=3, z=1 |

**Setup — Reflections:**
- Enable reflections (default: off)
- Set floor reflectance to 0.50 (default: 0.078)
- Set ceiling reflectance to 0.25 (default: 0.078)
- Other surfaces left at defaults

**Save/Load cycle:**
- Save via File menu → capture download
- Navigate to fresh page (`page.goto('/')`)
- Wait for new session
- Load the saved file via `input#load-file`

**Verification after load:**
- Lamp count = 5
- Zone count = 3 (zoneCount() excludes standard zones)
- Room dimensions = 6, 4, 3
- Reflections checkbox is checked
- Open reflectance modal → floor = 0.50, ceiling = 0.25
- No error toasts (`.toast-container .toast` count = 0)

### 5. `mobile.spec.ts` — Mobile Viewport

Single test at 375x812 viewport:
- Navigate, wait for canvas visible

### 6. `session-recovery.spec.ts` — Session Expiration Recovery

Unchanged from current implementation:
- Add a lamp
- Intercept API calls to return 401
- Trigger an action
- Remove intercept
- Verify app recovers (status indicator visible)

---

## Files to Delete

- `e2e/tests/calculate.spec.ts` — subsumed by workflow
- `e2e/tests/lamps.spec.ts` — subsumed by workflow
- `e2e/tests/zones.spec.ts` — subsumed by workflow
- `e2e/tests/value-labels.spec.ts` — subsumed by workflow
- `e2e/tests/error-states.spec.ts` — subsumed by room

---

## New Fixture Files

### `e2e/fixtures/test-lamp.ies`

Copy of an existing IES file from `~/guv-calcs/src/guv_calcs/data/lamp_data/` (e.g., `aerolamp.ies`). Real, valid photometric data that the backend can parse.

### `e2e/fixtures/test-spectrum.csv`

Minimal spectrum CSV peaked at 265nm:

```csv
wavelength,intensity
250,0.1
255,0.3
260,0.7
265,1.0
270,0.7
275,0.3
280,0.1
```

---

## New Helper Files

### `e2e/helpers/api.ts` — Backend State Access

```typescript
/** Fetch all zones from the backend API */
getZonesFromBackend(page: Page): Promise<SessionZoneState[]>

/** Read lamp instances from the frontend Svelte store */
getLampsFromStore(page: Page): Promise<LampInstance[]>

/** Compare two objects, asserting all fields match except the given exclusions */
assertObjectsMatch(original: Record<string, any>, copy: Record<string, any>, excludeKeys: string[]): void
```

### `e2e/helpers/reflections.ts` — Reflectance Controls

```typescript
/** Check the "Enable reflections" checkbox (idempotent) */
enableReflections(page: Page): Promise<void>

/** Read whether reflections are enabled */
isReflectionsEnabled(page: Page): Promise<boolean>

/** Open the Reflectance Settings modal */
openReflectanceModal(page: Page): Promise<void>

/** Close the Reflectance Settings modal */
closeReflectanceModal(page: Page): Promise<void>

/** Set a specific surface's reflectance value */
setSurfaceReflectance(page: Page, surface: string, value: number): Promise<void>

/** Read a specific surface's reflectance value */
getSurfaceReflectance(page: Page, surface: string): Promise<number>
```

---

## Modified Helper Files

### `e2e/helpers/lamps.ts` — New Exports

```typescript
/** Add a lamp and select a specific lamp type (does NOT select a preset) */
addLampWithType(page: Page, lampType: 'krcl_222' | 'lp_254' | 'other'): Promise<void>

/** Upload an IES file in the currently-open lamp editor */
uploadLampIes(page: Page, filePath: string): Promise<void>

/** Upload a spectrum file in the currently-open lamp editor */
uploadLampSpectrum(page: Page, filePath: string): Promise<void>

/** Set the wavelength input for an "other" type lamp */
setLampWavelength(page: Page, value: number): Promise<void>

/** Click the copy button on the nth lamp's editor */
copyLamp(page: Page, index?: number): Promise<void>

/** Click a placement preset button in the open lamp editor */
clickPlacementPreset(page: Page, preset: 'Downlight' | 'Corner' | 'Edge' | 'Horizontal'): Promise<void>

/** Click an aim preset button in the open lamp editor */
clickAimPreset(page: Page, preset: 'Down' | 'Corner' | 'Edge' | 'Horizontal'): Promise<void>

/** Toggle tilt/orientation mode */
toggleTiltMode(page: Page): Promise<void>

/** Open the advanced lamp settings modal (click "Details..." button) */
openAdvancedSettings(page: Page): Promise<void>

/** Click a tab in the advanced settings modal */
selectAdvancedTab(page: Page, tab: 'info' | 'scaling' | 'opening' | 'fixture'): Promise<void>

/** Close the advanced lamp settings modal */
closeAdvancedSettings(page: Page): Promise<void>
```

### `e2e/helpers/zones.ts` — New Exports

```typescript
/** Click the copy button on the currently-open zone editor */
copyZone(page: Page): Promise<void>

/** Delete a custom zone by index */
removeZone(page: Page, index?: number): Promise<void>

/** Set the reference surface for a plane zone */
setRefSurface(page: Page, surface: 'XY' | 'XZ' | 'YZ'): Promise<void>

/** Toggle the grid resolution mode (spacing ↔ num_points) */
toggleResolutionMode(page: Page): Promise<void>

/** Set the offset mode via illustrated selector */
toggleOffset(page: Page): Promise<void>

/** Set the display mode for a zone */
setDisplayMode(page: Page, mode: 'heatmap' | 'numeric' | 'markers' | 'none'): Promise<void>

/** Select a zone from the list by index and open its editor */
selectZone(page: Page, index: number): Promise<void>

/** Enable dose mode and set time values */
setDose(page: Page, hours: number, minutes: number, seconds: number): Promise<void>
```

---

## DOM Selectors Reference

Key selectors used across helpers and tests:

### Lamp Editor
| Element | Selector |
|---------|----------|
| Lamp type dropdown | `select#lamp-type` |
| Preset dropdown | `select#preset` |
| Wavelength input | `#wavelength` |
| IES file input | `input[type="file"][accept=".ies"]` |
| Spectrum file input | `input[type="file"][accept=".csv,.xls,.xlsx"]` |
| IES upload success | `.file-status.success` |
| Position inputs | `.vector-row` under "Position" label, X/Y/Z `ValidatedNumberInput`s |
| Aim point inputs | `.vector-row` under "Aim Point" label |
| Placement preset buttons | `.placement-buttons button` with text "Downlight"/"Corner"/"Edge"/"Horizontal" |
| Aim preset buttons | `.aim-presets button` with text "Down"/"Corner"/"Edge"/"Horizontal" |
| Tilt/Orientation mode toggle | `button.mode-switch` with text "Set Tilt/Orientation" or "Set Aim Point" |
| Tilt input | `.form-row` under "Tilt / Orientation" label, first `input[inputmode="decimal"]` |
| Orientation input | `.form-row` under "Tilt / Orientation" label, second `input[inputmode="decimal"]` |
| Show Label checkbox | `.toggle-row` containing "Show Label" text |
| Show Photometric Web checkbox | `.toggle-row` containing "Show Photometric Web" text |
| Details button | button with text "Details..." |
| Copy button | `.editor-actions button.secondary` with copy semantics |
| Delete button | `.editor-actions button.delete-btn` |

### Advanced Lamp Settings Modal
| Element | Selector |
|---------|----------|
| Tab bar | `.tab-bar` with `role="tablist"` |
| Info tab | `button[role="tab"]:has-text("Photometric and Spectral Info")` |
| Scaling tab | `button[role="tab"]:has-text("Scaling & Units")` |
| Opening tab | `button[role="tab"]:has-text("Luminous Opening")` |
| Fixture tab | `button[role="tab"]:has-text("Lamp Fixture")` |
| Scaling method | `select#scaling-method` |
| Scaling value | `#scaling-value` |
| Source width | `#source-width` |
| Source length | `#source-length` |
| Source density | `#source-density` |
| Housing width | `#housing-width` |
| Housing length | `#housing-length` |
| Housing height | `#housing-height` |

### Zone Editor
| Element | Selector |
|---------|----------|
| Zone type buttons | `button.zone-type-btn[title="CalcPlane\|CalcVol\|CalcPoint"]` |
| Calc mode selector | `.illustrated-selector-summary` in "Calculation Type" form-group |
| Calc mode options | `.illustrated-option` with mode name text |
| Reference surface selector | `.illustrated-selector-summary` in reference surface form-group |
| Ref surface options | `.illustrated-option` with "XY"/"XZ"/"YZ" text |
| Offset selector | `.illustrated-selector-summary` in offset form-group |
| Grid mode toggle | `button.mode-switch-btn` |
| Grid inputs | `.grid-inputs .grid-input` containing `ValidatedNumberInput` |
| Bounds inputs | `.range-row` containing two `input` elements with `.range-sep` between |
| Display mode buttons | `.zone-type-btn` with heatmap/numeric/markers/none titles (in display section) |
| Point position | `.vector-row` under "Position" in point editor |
| Point aim | `.vector-row` under "Aim Point" in point editor |
| FOV vertical | `#fov-vert` |
| FOV horizontal | `#fov-horiz` |
| View direction | `.vector-row` in eye_directional section |
| Target point | `.vector-row` in eye_target section |
| Custom flags | `.toggle-row` checkboxes for cos(θ), sin(θ), block back-hemisphere |
| Value type dropdown | `select#value-type` |
| Dose hours | `#dose-hours` |
| Dose minutes | `#dose-minutes` |
| Dose seconds | `#dose-seconds` |
| Show Label | `.toggle-row` containing "Show Label" (point zones only) |
| Advanced expand | expandable "Advanced" section toggle |

### Reflectance
| Element | Selector |
|---------|----------|
| Enable reflections | checkbox inside label with text "Enable reflections" |
| Set Reflectance button | button with text "Set Reflectance" |
| Surface row | `.surface-row` containing `.surface-name` with surface text |
| Max passes | `#max_passes` |
| Threshold | `#threshold` |

### General
| Element | Selector |
|---------|----------|
| Lamp list items | `.item-list-item[data-lamp-id]` |
| Zone list items (custom) | `.item-list-item[data-zone-id]:not(.standard-zone)` |
| Standard zone items | `.item-list-item.standard-zone` |
| File menu | `.menu-bar-item:has-text("File") span[role="button"]` |
| Save menu item | `div[role="menuitem"]:has-text("Save")` |
| Load file input | `input#load-file` |
| Status indicator | `span.status-indicator` |
| Calculate button | `button.calculate-btn` |
| Stat values | `.stat-value` |
| Error toasts | `.toast-container .toast` |

---

## Backend API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `GET /session/zones` | Fetch all zone state for copy verification |
| `POST /session/lamps/{id}/copy` | Copy a lamp (triggered via UI) |
| `POST /session/zones/{id}/copy` | Copy a zone (triggered via UI) |

Frontend store access via `page.evaluate()` for lamp state (no bulk lamp GET endpoint exists).
