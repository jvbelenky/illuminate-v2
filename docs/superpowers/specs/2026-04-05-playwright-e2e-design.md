# Playwright E2E Testing Design

## Overview

Add end-to-end testing to Illuminate V2 using Playwright, covering core workflows, edge cases, and error states across the full stack (SvelteKit UI + FastAPI backend + guv_calcs).

The project currently has strong unit/integration test coverage (592 UI tests, 16 API test modules) but zero e2e tests. Bugs like the zone-type-switch editor closing (caused by ID remapping across store/UI boundaries) demonstrate the need for tests that exercise real user interactions through the full stack.

## Architecture

### Location

Project root `e2e/` directory — the tests exercise both UI and API, so they don't belong to either.

### Directory Structure

```
e2e/
  package.json              # @playwright/test, typescript
  playwright.config.ts      # dev server startup, browser config
  tsconfig.json
  helpers/
    session.ts              # waitForSession(), waitForApi()
    room.ts                 # setRoomDimensions()
    lamps.ts                # addLampFromPreset(), removeLamp()
    zones.ts                # addZone(), switchZoneType(), setCalcMode()
    calculations.ts         # calculate(), waitForResults()
  tests/
    smoke.spec.ts           # App loads, session initializes
    room.spec.ts            # Room dimension editing
    lamps.spec.ts           # Add/remove/configure lamps
    zones.spec.ts           # Zone CRUD, type switching, calc modes
    calculate.spec.ts       # Full calculate flow, results panel
    value-labels.spec.ts    # Fluence vs Irradiance label logic
    save-load.spec.ts       # Save/load project round-trip
    session-recovery.spec.ts # Backend timeout, auto-reinit
    mobile.spec.ts          # Responsive layout at narrow viewport
    error-states.spec.ts    # Invalid inputs, budget exceeded
```

### Playwright Configuration

```typescript
// playwright.config.ts key settings
{
  testDir: './tests',
  timeout: 30_000,           // calculations can be slow
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'cd ../api && uv run uvicorn app.main:app --port 8000',
      port: 8000,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'cd ../ui && pnpm dev',
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
  ],
}
```

- Chromium only for speed (Firefox/WebKit can be added later)
- `reuseExistingServer` lets you run against already-started dev servers locally
- Both servers started automatically if not already running

## Test Scenarios

### smoke.spec.ts
- App loads without errors
- Session is created (API call succeeds)
- 3D room renders (canvas element present)
- Left panel visible with Room, Lamps, Zones sections
- Status bar shows connected state

### room.spec.ts
- Edit room X/Y/Z dimensions
- Values persist after editing
- Room updates visually (canvas re-renders)

### lamps.spec.ts
- Add a lamp from the preset dropdown
- Lamp appears in the lamp list
- Edit lamp position
- Toggle lamp enabled/disabled
- Delete a lamp
- Copy a lamp

### zones.spec.ts
- Add a plane zone — editor opens with plane-specific fields
- Add a volume zone — editor opens with volume-specific fields
- Add a point zone — editor opens with point-specific fields
- **Switch zone type** — editor stays open (the bug we fixed)
- Delete a zone
- Copy a zone
- Edit zone dimensions/position

### calculate.spec.ts
- Full workflow: default room → add lamp → add zone → click Calculate
- Progress indicator appears during calculation
- Results appear in the stats panel (min/max/mean values)
- Results panel shows zone-specific statistics
- Stale indicator appears when changing parameters after calculation

### value-labels.spec.ts
- Default plane zone shows "Irradiance (uW/cm2)" in Value Display
- Fluence Rate label appears only when vert=true, horiz=true, use_normal=false, no view targeting
- Switching calc modes updates the Value Display label correctly
- Volume zones show correct label based on calc properties
- Point zones show correct label

### save-load.spec.ts
- Configure a project (room + lamp + zone)
- Save to file via export
- Load the saved file
- Verify all state matches (room dimensions, lamp positions, zone settings)

### session-recovery.spec.ts
- Start a session, configure some state
- Simulate backend unavailability (intercept API calls to return 401/expired)
- Verify the app auto-reinitializes the session
- Verify state is restored from sessionStorage

### mobile.spec.ts
- Set viewport to 375x812 (iPhone-sized)
- Tab navigation is present and functional
- All panels are accessible via tabs
- Key workflows still function at narrow width

### error-states.spec.ts
- Submit invalid room dimensions (zero, negative)
- Attempt to calculate with no lamps
- Budget exceeded scenario (if simulatable)
- Verify error messages appear and are dismissable

## Helper Modules

Helpers encapsulate common multi-step interactions so test files stay readable.

### session.ts
```typescript
// Wait for API health endpoint
async function waitForApi(page: Page): Promise<void>
// Wait for session initialization (network idle after page load)
async function waitForSession(page: Page): Promise<void>
```

### room.ts
```typescript
// Set room dimensions via the RoomEditor panel
async function setRoomDimensions(page: Page, x: number, y: number, z: number): Promise<void>
```

### lamps.ts
```typescript
// Add a lamp from the preset catalog
async function addLampFromPreset(page: Page, presetName?: string): Promise<void>
// Remove a lamp by index or name
async function removeLamp(page: Page, identifier: string | number): Promise<void>
```

### zones.ts
```typescript
// Add a new calc zone of the given type
async function addZone(page: Page, type?: 'plane' | 'volume' | 'point'): Promise<void>
// Switch an existing zone's type via the type buttons
async function switchZoneType(page: Page, zoneName: string, newType: 'plane' | 'volume' | 'point'): Promise<void>
// Set calc mode on a plane zone
async function setCalcMode(page: Page, zoneName: string, mode: string): Promise<void>
```

### calculations.ts
```typescript
// Click Calculate and wait for results to appear
async function calculate(page: Page): Promise<void>
// Wait for calculation to complete (progress bar disappears, results populate)
async function waitForResults(page: Page): Promise<void>
```

## CI Integration

New job in `.github/workflows/ci.yml`, runs after the existing UI and API test jobs:

```yaml
e2e-tests:
  needs: [ui-tests, api-tests]
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '22'
    - uses: astral-sh/setup-uv@v6
    - name: Install UI dependencies
      run: cd ui && corepack enable && pnpm install --frozen-lockfile
    - name: Install API dependencies
      run: cd api && uv sync --no-sources --dev
    - name: Install e2e dependencies
      run: cd e2e && npm ci
    - name: Install Playwright browsers
      run: cd e2e && npx playwright install --with-deps chromium
    - name: Run e2e tests
      run: cd e2e && npx playwright test
    - name: Upload test report
      if: failure()
      uses: actions/upload-artifact@v4
      with:
        name: playwright-report
        path: e2e/playwright-report/
        retention-days: 7
```

## Scope Boundaries

**Included:**
- Core user workflows (room, lamps, zones, calculate)
- Edge cases (session recovery, save/load, mobile, errors)
- Label correctness (fluence vs irradiance)
- CI pipeline integration

**Excluded:**
- Visual regression testing (screenshot comparison) — high maintenance, can add later
- Performance benchmarks — different tooling concern
- Multi-browser testing — Chromium only to start, trivially expandable in config
- 3D scene assertions — canvas internals are opaque to Playwright; we verify the canvas renders but not pixel content
- Desktop app (Electron/Tauri) testing — separate concern

## Dependencies

- `@playwright/test` (latest)
- `typescript`
- Node 22 (matches existing CI)
- Python 3.12 + uv (for API server)
- pnpm (for UI server)
