# E2E Test Consolidation & Comprehensive Coverage

## Overview

Consolidate the existing 10 e2e test files into 6 focused, comprehensive tests. Eliminate redundancy, add missing coverage for copy verification, multiple lamp/zone types, reflections, and save/load roundtrips.

## Current State

10 test files with ~25 individual tests. Significant overlap (e.g., `calculate.spec.ts`, `lamps.spec.ts`, and `zones.spec.ts` all add lamps/zones independently). Major features untested: reflections, file uploads, copy, multiple lamp types, advanced settings.

## Target State

6 test files with ~6 substantive tests. Each file owns a clear domain. No redundant setup.

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

Single test simulating a full user session. This is the heaviest test and exercises most UI interactions:

**Lamp operations:**
1. Add lamp from preset → verify editor opens, `lampCount() === 1`
2. Edit lamp position (x=2, y=3, z=2.5) and aim point (aimx=2, aimy=3, aimz=0)
3. Use a placement preset (Downlight)
4. Toggle lamp enable/disable (verify `.calc-disabled` class toggles)

**Zone operations:**
5. Add zone (defaults to plane) → change height to 1.5, set calc mode to Fluence Rate
6. Add zone → switch to volume type
7. Add zone → switch to point type, set position (x=2, y=3, z=1)
8. Check value labels: plane shows "Irradiance", volume shows "Irradiance"

**Copy verification (zones):**
9. Copy the plane zone → `GET /session/zones` from backend → compare all fields of original and copy (must match except `id` and `name`; name should have " (Copy)" suffix)
10. Copy the volume zone → same backend verification
11. Copy the point zone → same backend verification

**Copy verification (lamp):**
12. Copy the lamp → `page.evaluate()` to read `$project.lamps` from store → compare original and copy fields (must match except `id` and `name`)
13. Verify total counts: 2 lamps, 6 custom zones (3 originals + 3 copies)

**Cleanup and continued workflow:**
14. Delete the 3 copied zones and copied lamp → verify counts return to 1 lamp, 3 zones
15. Toggle a standard zone on/off

**Calculation:**
16. Calculate → verify results appear (`.stat-value` visible) → status bar shows "Last calculated:" timestamp

**Display settings:**
17. Toggle a display setting from the View menu (e.g., precision or show/hide grid)

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
```

### `e2e/helpers/zones.ts` — New Exports

```typescript
/** Click the copy button on the currently-open zone editor */
copyZone(page: Page): Promise<void>

/** Delete a custom zone by index */
removeZone(page: Page, index?: number): Promise<void>
```

---

## DOM Selectors Reference

Key selectors used across helpers and tests:

| Element | Selector |
|---------|----------|
| Lamp type dropdown | `select#lamp-type` |
| Preset dropdown | `select#preset` |
| Wavelength input | `input#wavelength` |
| IES file input | `input[type="file"][accept=".ies"]` |
| Spectrum file input | `input[type="file"][accept=".csv,.xls,.xlsx"]` |
| IES upload success | `.file-status.success` (in IES section) |
| Zone type buttons | `button.zone-type-btn[title="CalcPlane\|CalcVol\|CalcPoint"]` |
| Enable reflections | checkbox inside `label` with text "Enable reflections" |
| Set Reflectance button | `button` with text "Set Reflectance" |
| Surface row | `.surface-row` containing `.surface-name` with surface text |
| Max passes input | `#max_passes` |
| Threshold input | `#threshold` |
| Lamp list items | `.item-list-item[data-lamp-id]` |
| Zone list items | `.item-list-item[data-zone-id]:not(.standard-zone)` |
| Copy button | `button[aria-label*="Copy"]` or similar in editor |
| Delete button | `button[aria-label*="Delete"]` in list item |
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
