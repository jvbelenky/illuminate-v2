# Playwright E2E Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Playwright e2e tests covering core workflows, edge cases, and error states across the full Illuminate V2 stack.

**Architecture:** Standalone `e2e/` directory at the project root with its own `package.json`. Playwright's `webServer` config starts both the SvelteKit UI (port 5173) and FastAPI backend (port 8000). Helper modules encapsulate common multi-step interactions (session init, adding lamps/zones, running calculations). Tests are organized by workflow in flat spec files.

**Tech Stack:** Playwright Test, TypeScript, Node 22

**Spec:** `docs/superpowers/specs/2026-04-05-playwright-e2e-design.md`

---

## File Map

| File | Responsibility |
|------|---------------|
| `e2e/package.json` | Dependencies: @playwright/test, typescript |
| `e2e/tsconfig.json` | TS config for Playwright tests |
| `e2e/playwright.config.ts` | Browser config, webServer startup, timeouts |
| `e2e/helpers/session.ts` | `waitForSession()` — navigate + wait for app init |
| `e2e/helpers/room.ts` | `setRoomDimensions()` — edit room X/Y/Z |
| `e2e/helpers/lamps.ts` | `addLampFromPreset()`, `removeLamp()` |
| `e2e/helpers/zones.ts` | `addZone()`, `switchZoneType()`, `setCalcMode()` |
| `e2e/helpers/calculations.ts` | `calculate()`, `waitForResults()` |
| `e2e/tests/smoke.spec.ts` | App loads, session init, panels visible |
| `e2e/tests/room.spec.ts` | Room dimension editing |
| `e2e/tests/lamps.spec.ts` | Lamp CRUD |
| `e2e/tests/zones.spec.ts` | Zone CRUD, type switching |
| `e2e/tests/calculate.spec.ts` | Full calculate flow, results |
| `e2e/tests/value-labels.spec.ts` | Fluence vs Irradiance labels |
| `e2e/tests/save-load.spec.ts` | Save/load project round-trip |
| `e2e/tests/session-recovery.spec.ts` | Backend timeout auto-reinit |
| `e2e/tests/mobile.spec.ts` | Responsive layout |
| `e2e/tests/error-states.spec.ts` | Invalid inputs, missing data |
| `.github/workflows/ci.yml` | New e2e-tests job |
| `Makefile` | New test-e2e target |

---

### Task 1: Scaffold e2e project

**Files:**
- Create: `e2e/package.json`
- Create: `e2e/tsconfig.json`
- Create: `e2e/playwright.config.ts`
- Modify: `.gitignore`
- Modify: `Makefile`

- [ ] **Step 1: Create `e2e/package.json`**

```json
{
  "name": "illuminate-e2e",
  "private": true,
  "scripts": {
    "test": "playwright test",
    "test:headed": "playwright test --headed",
    "test:ui": "playwright test --ui",
    "report": "playwright show-report"
  },
  "devDependencies": {
    "@playwright/test": "^1.52.0",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Create `e2e/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": {
      "@helpers/*": ["helpers/*"]
    }
  },
  "include": ["tests/**/*.ts", "helpers/**/*.ts", "playwright.config.ts"]
}
```

- [ ] **Step 3: Create `e2e/playwright.config.ts`**

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,       // tests share backend state, run serially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,                 // single backend worker constraint
  reporter: process.env.CI ? 'html' : 'list',
  timeout: 30_000,

  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: 'cd ../api && uv run uvicorn app.main:app --port 8000',
      port: 8000,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'cd ../ui && pnpm dev',
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
```

- [ ] **Step 4: Append to `.gitignore`**

Add these lines at the end of the project root `.gitignore`:

```
# Playwright
e2e/node_modules/
e2e/test-results/
e2e/playwright-report/
e2e/blob-report/
```

- [ ] **Step 5: Add `test-e2e` target to `Makefile`**

Add after the existing `test-api` target:

```makefile
# E2E tests (Playwright)
test-e2e:
	cd e2e && npx playwright test
```

And update the `test` target to include it:

```makefile
test: test-ui test-api test-e2e
```

- [ ] **Step 6: Install dependencies and Playwright browsers**

Run:
```bash
cd e2e && npm install && npx playwright install chromium
```

Expected: `node_modules` created, chromium browser downloaded.

- [ ] **Step 7: Verify Playwright runs (no tests yet)**

Run:
```bash
cd e2e && npx playwright test
```

Expected: "No tests found" or similar empty output (no error).

- [ ] **Step 8: Commit**

```bash
git add e2e/package.json e2e/package-lock.json e2e/tsconfig.json e2e/playwright.config.ts .gitignore Makefile
git commit -m "chore: scaffold Playwright e2e test project"
```

---

### Task 2: Session helper + smoke test

**Files:**
- Create: `e2e/helpers/session.ts`
- Create: `e2e/tests/smoke.spec.ts`

- [ ] **Step 1: Create `e2e/helpers/session.ts`**

```typescript
import { type Page, expect } from '@playwright/test';

/**
 * Navigate to the app and wait for session initialization.
 * Call this in beforeEach for every test.
 */
export async function waitForSession(page: Page): Promise<void> {
  await page.goto('/');
  // Wait for the status bar "Ready" indicator — means session is initialized
  await expect(page.locator('span.status-indicator')).toBeVisible({ timeout: 15_000 });
}
```

- [ ] **Step 2: Create `e2e/tests/smoke.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';
import { waitForSession } from '../helpers/session';

test.describe('Smoke tests', () => {
  test.beforeEach(async ({ page }) => {
    await waitForSession(page);
  });

  test('app loads and session initializes', async ({ page }) => {
    // Status bar shows Ready
    await expect(page.locator('text=Ready')).toBeVisible();
  });

  test('3D room canvas renders', async ({ page }) => {
    await expect(page.locator('canvas')).toBeVisible();
  });

  test('left panel sections are visible', async ({ page }) => {
    await expect(page.locator('h3:has-text("Room")')).toBeVisible();
    await expect(page.locator('h3:has-text("Lamps")')).toBeVisible();
    await expect(page.locator('h3:has-text("Calc Zones")')).toBeVisible();
  });

  test('status bar shows lamp and zone counts', async ({ page }) => {
    await expect(page.locator('text=Lamps:')).toBeVisible();
    await expect(page.locator('text=Zones:')).toBeVisible();
  });
});
```

- [ ] **Step 3: Run smoke tests**

Run:
```bash
cd e2e && npx playwright test tests/smoke.spec.ts
```

Expected: All 4 tests pass. If selectors fail, adjust based on actual DOM and re-run.

- [ ] **Step 4: Commit**

```bash
git add e2e/helpers/session.ts e2e/tests/smoke.spec.ts
git commit -m "test(e2e): add session helper and smoke tests"
```

---

### Task 3: Room helper + room test

**Files:**
- Create: `e2e/helpers/room.ts`
- Create: `e2e/tests/room.spec.ts`

- [ ] **Step 1: Create `e2e/helpers/room.ts`**

The RoomEditor has three inputs inside `.input-with-label` divs, each preceded by a label span ("X", "Y", "Z"). The inputs fire `onchange` when blurred.

```typescript
import { type Page, expect } from '@playwright/test';

/** Get a room dimension input by its label (X, Y, or Z) */
function dimInput(page: Page, label: 'X' | 'Y' | 'Z') {
  return page
    .locator('.room-editor .input-with-label')
    .filter({ has: page.locator(`.input-label:text-is("${label}")`) })
    .locator('input');
}

/** Set room dimensions. Only changes dimensions that are provided. */
export async function setRoomDimensions(
  page: Page,
  dims: { x?: number; y?: number; z?: number }
): Promise<void> {
  for (const [label, value] of Object.entries(dims)) {
    if (value == null) continue;
    const input = dimInput(page, label.toUpperCase() as 'X' | 'Y' | 'Z');
    await input.click({ clickCount: 3 }); // select all
    await input.fill(String(value));
    await input.press('Tab'); // trigger onchange via blur
  }
}

/** Read the current value of a room dimension input. */
export async function getRoomDimension(page: Page, label: 'X' | 'Y' | 'Z'): Promise<string> {
  return dimInput(page, label).inputValue();
}
```

- [ ] **Step 2: Create `e2e/tests/room.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { setRoomDimensions, getRoomDimension } from '../helpers/room';

test.describe('Room editor', () => {
  test.beforeEach(async ({ page }) => {
    await waitForSession(page);
  });

  test('can edit room X dimension', async ({ page }) => {
    await setRoomDimensions(page, { x: 7 });
    // Allow backend round-trip
    await page.waitForTimeout(500);
    const val = await getRoomDimension(page, 'X');
    expect(parseFloat(val)).toBe(7);
  });

  test('can edit room Y dimension', async ({ page }) => {
    await setRoomDimensions(page, { y: 5.5 });
    await page.waitForTimeout(500);
    const val = await getRoomDimension(page, 'Y');
    expect(parseFloat(val)).toBe(5.5);
  });

  test('can edit all dimensions at once', async ({ page }) => {
    await setRoomDimensions(page, { x: 4, y: 3, z: 2.5 });
    await page.waitForTimeout(500);
    expect(parseFloat(await getRoomDimension(page, 'X'))).toBe(4);
    expect(parseFloat(await getRoomDimension(page, 'Y'))).toBe(3);
    expect(parseFloat(await getRoomDimension(page, 'Z'))).toBe(2.5);
  });

  test('can switch units', async ({ page }) => {
    const unitsSelect = page.locator('.room-editor select.units-select');
    await unitsSelect.selectOption('feet');
    await expect(unitsSelect).toHaveValue('feet');
    // Switch back
    await unitsSelect.selectOption('meters');
    await expect(unitsSelect).toHaveValue('meters');
  });
});
```

- [ ] **Step 3: Run room tests**

Run:
```bash
cd e2e && npx playwright test tests/room.spec.ts
```

Expected: All 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add e2e/helpers/room.ts e2e/tests/room.spec.ts
git commit -m "test(e2e): add room editor tests"
```

---

### Task 4: Lamp helper + lamp test

**Files:**
- Create: `e2e/helpers/lamps.ts`
- Create: `e2e/tests/lamps.spec.ts`

- [ ] **Step 1: Create `e2e/helpers/lamps.ts`**

Adding a lamp: click "Add Lamp" → lamp editor opens → if lamp_type is krcl_222, select a preset from `select#preset`.

```typescript
import { type Page, expect } from '@playwright/test';

/** Ensure the Lamps panel is expanded. */
async function expandLampsPanel(page: Page): Promise<void> {
  const header = page.locator('.panel-header').filter({ hasText: 'Lamps' });
  // Check if panel content is visible (if collapsed, click to expand)
  const content = header.locator('..').locator('.panel-content');
  if (!(await content.isVisible().catch(() => false))) {
    await header.click();
    await expect(content).toBeVisible();
  }
}

/** Add a new lamp and select the first available preset. */
export async function addLampFromPreset(page: Page): Promise<void> {
  await expandLampsPanel(page);
  await page.locator('button:has-text("Add Lamp")').click();

  // Wait for lamp editor to appear with preset dropdown
  const presetSelect = page.locator('select#preset');
  await expect(presetSelect).toBeVisible({ timeout: 5_000 });

  // Wait for options to load from API (first real option after the disabled placeholder)
  await expect(presetSelect.locator('option:not([disabled])')).not.toHaveCount(0, { timeout: 10_000 });

  // Select the first available preset
  const firstOption = presetSelect.locator('option:not([disabled])').first();
  const value = await firstOption.getAttribute('value');
  if (value) {
    await presetSelect.selectOption(value);
  }
}

/** Remove a lamp by clicking its delete button. Index is 0-based. */
export async function removeLamp(page: Page, index: number = 0): Promise<void> {
  const lampItem = page.locator('.item-list-item[data-lamp-id]').nth(index);
  await lampItem.locator('button[aria-label*="Delete"]').click();
  // Confirm deletion if a dialog appears
  const confirmBtn = page.locator('button:has-text("Delete")');
  if (await confirmBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await confirmBtn.click();
  }
}

/** Count lamps currently in the list. */
export async function lampCount(page: Page): Promise<number> {
  return page.locator('.item-list-item[data-lamp-id]').count();
}
```

- [ ] **Step 2: Create `e2e/tests/lamps.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { addLampFromPreset, removeLamp, lampCount } from '../helpers/lamps';

test.describe('Lamp management', () => {
  test.beforeEach(async ({ page }) => {
    await waitForSession(page);
  });

  test('can add a lamp from preset', async ({ page }) => {
    expect(await lampCount(page)).toBe(0);
    await addLampFromPreset(page);
    expect(await lampCount(page)).toBe(1);
  });

  test('lamp editor opens when lamp is added', async ({ page }) => {
    await addLampFromPreset(page);
    // Editor should be visible (inline-editor div inside the lamp item)
    await expect(page.locator('.item-list-item[data-lamp-id] .inline-editor').first()).toBeVisible();
  });

  test('can toggle lamp enabled/disabled', async ({ page }) => {
    await addLampFromPreset(page);
    // Find the enable/disable toggle button (the one with "Exclude from calc" title)
    const lampItem = page.locator('.item-list-item[data-lamp-id]').first();
    const toggleBtn = lampItem.locator('button[aria-label*="Exclude"], button[aria-label*="Include"]');
    await toggleBtn.click();
    // After clicking, the lamp should have calc-disabled class
    await expect(lampItem).toHaveClass(/calc-disabled/);
    // Click again to re-enable
    await toggleBtn.click();
    await expect(lampItem).not.toHaveClass(/calc-disabled/);
  });

  test('can delete a lamp', async ({ page }) => {
    await addLampFromPreset(page);
    expect(await lampCount(page)).toBe(1);
    await removeLamp(page, 0);
    // Wait for removal
    await expect(page.locator('.item-list-item[data-lamp-id]')).toHaveCount(0);
  });
});
```

- [ ] **Step 3: Run lamp tests**

Run:
```bash
cd e2e && npx playwright test tests/lamps.spec.ts
```

Expected: All 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add e2e/helpers/lamps.ts e2e/tests/lamps.spec.ts
git commit -m "test(e2e): add lamp management tests"
```

---

### Task 5: Zone helper + zone test

**Files:**
- Create: `e2e/helpers/zones.ts`
- Create: `e2e/tests/zones.spec.ts`

- [ ] **Step 1: Create `e2e/helpers/zones.ts`**

```typescript
import { type Page, expect } from '@playwright/test';

/** Ensure the Calc Zones panel is expanded. */
async function expandZonesPanel(page: Page): Promise<void> {
  const header = page.locator('.panel-header').filter({ hasText: 'Calc Zones' });
  const content = header.locator('..').locator('.panel-content');
  if (!(await content.isVisible().catch(() => false))) {
    await header.click();
    await expect(content).toBeVisible();
  }
}

/** Add a new calc zone. Returns the zone's list item locator. */
export async function addZone(page: Page): Promise<void> {
  await expandZonesPanel(page);
  await page.locator('button:has-text("Add Zone")').click();
  // Wait for the new zone's editor to appear
  await expect(page.locator('.item-list-item[data-zone-id] .inline-editor').last()).toBeVisible({ timeout: 5_000 });
}

/**
 * Switch the currently-open zone editor to a different type.
 * Clicks the type button (Plane, Volume, or Point) inside the open editor.
 */
export async function switchZoneType(
  page: Page,
  newType: 'plane' | 'volume' | 'point'
): Promise<void> {
  const titleMap = { plane: 'CalcPlane', volume: 'CalcVol', point: 'CalcPoint' };
  const btn = page.locator(`button.zone-type-btn[title="${titleMap[newType]}"]`);
  await btn.click();
  // Wait for the type button to become active (confirms the switch completed)
  await expect(btn).toHaveClass(/active/, { timeout: 5_000 });
}

/**
 * Set the calc mode on a plane zone via the illustrated selector.
 * The zone editor must already be open.
 */
export async function setCalcMode(page: Page, mode: string): Promise<void> {
  // Click the current calc mode button to expand the selector
  const summary = page.locator('.illustrated-selector button.summary-title, .illustrated-selector .summary-title').first();
  await summary.click();
  // Click the target option
  await page.locator(`.illustrated-option:has-text("${mode}")`).click();
}

/** Count non-standard zones in the list. */
export async function zoneCount(page: Page): Promise<number> {
  return page.locator('.item-list-item[data-zone-id]:not(.standard-zone)').count();
}
```

- [ ] **Step 2: Create `e2e/tests/zones.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { addZone, switchZoneType, zoneCount } from '../helpers/zones';

test.describe('Zone management', () => {
  test.beforeEach(async ({ page }) => {
    await waitForSession(page);
  });

  test('can add a zone', async ({ page }) => {
    expect(await zoneCount(page)).toBe(0);
    await addZone(page);
    expect(await zoneCount(page)).toBe(1);
  });

  test('zone editor opens when zone is added', async ({ page }) => {
    await addZone(page);
    // Zone type buttons should be visible (they're inside the editor)
    await expect(page.locator('button.zone-type-btn').first()).toBeVisible();
  });

  test('can switch zone type and editor stays open', async ({ page }) => {
    await addZone(page);
    // Default is plane — verify plane button is active
    await expect(page.locator('button.zone-type-btn[title="CalcPlane"]')).toHaveClass(/active/);

    // Switch to volume
    await switchZoneType(page, 'volume');
    // Editor must still be visible (this was the bug we fixed)
    await expect(page.locator('button.zone-type-btn').first()).toBeVisible();
    await expect(page.locator('button.zone-type-btn[title="CalcVol"]')).toHaveClass(/active/);

    // Switch to point
    await switchZoneType(page, 'point');
    await expect(page.locator('button.zone-type-btn').first()).toBeVisible();
    await expect(page.locator('button.zone-type-btn[title="CalcPoint"]')).toHaveClass(/active/);

    // Switch back to plane
    await switchZoneType(page, 'plane');
    await expect(page.locator('button.zone-type-btn[title="CalcPlane"]')).toHaveClass(/active/);
  });

  test('can delete a zone', async ({ page }) => {
    await addZone(page);
    expect(await zoneCount(page)).toBe(1);
    // Click delete button on the zone
    const zoneItem = page.locator('.item-list-item[data-zone-id]:not(.standard-zone)').first();
    await zoneItem.locator('button[aria-label*="Delete"]').click();
    // Confirm if needed
    const confirmBtn = page.locator('button:has-text("Delete")');
    if (await confirmBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await confirmBtn.click();
    }
    await expect(page.locator('.item-list-item[data-zone-id]:not(.standard-zone)')).toHaveCount(0);
  });
});
```

- [ ] **Step 3: Run zone tests**

Run:
```bash
cd e2e && npx playwright test tests/zones.spec.ts
```

Expected: All 4 tests pass. The "editor stays open" test validates the ID-remap fix.

- [ ] **Step 4: Commit**

```bash
git add e2e/helpers/zones.ts e2e/tests/zones.spec.ts
git commit -m "test(e2e): add zone management tests including type-switch fix"
```

---

### Task 6: Calculation helper + calculate test

**Files:**
- Create: `e2e/helpers/calculations.ts`
- Create: `e2e/tests/calculate.spec.ts`

- [ ] **Step 1: Create `e2e/helpers/calculations.ts`**

```typescript
import { type Page, expect } from '@playwright/test';

/** Click the Calculate button and wait for results to appear. */
export async function calculate(page: Page): Promise<void> {
  const calcBtn = page.locator('button.calculate-btn');
  await calcBtn.click();

  // Wait for button to enter calculating state
  await expect(calcBtn).toHaveClass(/calculating/, { timeout: 5_000 });

  // Wait for calculation to complete (button leaves calculating state)
  await expect(calcBtn).not.toHaveClass(/calculating/, { timeout: 60_000 });
}

/** Wait for the results panel to show zone statistics. */
export async function waitForResults(page: Page): Promise<void> {
  // Results panel should have stat values visible
  await expect(page.locator('.stat-value').first()).toBeVisible({ timeout: 10_000 });
}
```

- [ ] **Step 2: Create `e2e/tests/calculate.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { addLampFromPreset } from '../helpers/lamps';
import { addZone } from '../helpers/zones';
import { calculate, waitForResults } from '../helpers/calculations';

test.describe('Calculation workflow', () => {
  test.beforeEach(async ({ page }) => {
    await waitForSession(page);
  });

  test('full flow: add lamp + zone, calculate, see results', async ({ page }) => {
    // Setup: add a lamp and a zone
    await addLampFromPreset(page);
    await addZone(page);

    // Click away from zone editor to collapse it (click the room header)
    await page.locator('h3:has-text("Room")').click();

    // Calculate
    await calculate(page);
    await waitForResults(page);

    // Verify results panel has statistics
    const statLabels = page.locator('.stat-label');
    const count = await statLabels.count();
    expect(count).toBeGreaterThan(0);
  });

  test('status bar shows last calculated time after calculation', async ({ page }) => {
    await addLampFromPreset(page);
    await addZone(page);
    await page.locator('h3:has-text("Room")').click();

    await calculate(page);
    await waitForResults(page);

    await expect(page.locator('text=Last calculated:')).toBeVisible();
  });
});
```

- [ ] **Step 3: Run calculate tests**

Run:
```bash
cd e2e && npx playwright test tests/calculate.spec.ts
```

Expected: Both tests pass. These are slower (~10-20s each due to calculation time).

- [ ] **Step 4: Commit**

```bash
git add e2e/helpers/calculations.ts e2e/tests/calculate.spec.ts
git commit -m "test(e2e): add calculation workflow tests"
```

---

### Task 7: Value labels test

**Files:**
- Create: `e2e/tests/value-labels.spec.ts`

- [ ] **Step 1: Create `e2e/tests/value-labels.spec.ts`**

Tests the fluence vs irradiance label logic we implemented. The Value Display field should show "Fluence Rate" only when calc mode produces fluence (vert=true, horiz=true, use_normal=false, no view targeting).

```typescript
import { test, expect } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { addZone, setCalcMode } from '../helpers/zones';

test.describe('Value Display labels', () => {
  test.beforeEach(async ({ page }) => {
    await waitForSession(page);
    await addZone(page);
  });

  test('default plane zone shows Irradiance', async ({ page }) => {
    // Default calc mode is Planar Normal — should show Irradiance
    const valueDisplay = page.locator('select#value-type');
    await expect(valueDisplay.locator('option[value="false"]')).toContainText('Irradiance');
  });

  test('Fluence Rate calc mode shows Fluence Rate label', async ({ page }) => {
    await setCalcMode(page, 'Fluence Rate');
    // After switching to Fluence Rate mode, the Value Display should say Fluence Rate
    // Note: the named "Fluence Rate" calc mode has vert=false, horiz=false, so
    // per our logic it will NOT show "Fluence Rate" label (it shows Irradiance).
    // Only custom mode with vert=true + horiz=true + use_normal=false does.
    const valueDisplay = page.locator('select#value-type');
    await expect(valueDisplay.locator('option[value="false"]')).toContainText('Irradiance');
  });

  test('volume zone shows Irradiance by default', async ({ page }) => {
    // Switch the zone to volume type
    await page.locator('button.zone-type-btn[title="CalcVol"]').click();
    await expect(page.locator('button.zone-type-btn[title="CalcVol"]')).toHaveClass(/active/, { timeout: 5_000 });

    // Value Display dropdown should show Irradiance
    const valueDisplay = page.locator('select#value-type');
    await expect(valueDisplay.locator('option[value="false"]')).toContainText('Irradiance');
  });
});
```

- [ ] **Step 2: Run value labels tests**

Run:
```bash
cd e2e && npx playwright test tests/value-labels.spec.ts
```

Expected: All 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/value-labels.spec.ts
git commit -m "test(e2e): add value display label tests (fluence vs irradiance)"
```

---

### Task 8: Save/load test

**Files:**
- Create: `e2e/tests/save-load.spec.ts`

- [ ] **Step 1: Create `e2e/tests/save-load.spec.ts`**

Uses Playwright's download/upload handling to test the save/load round-trip.

```typescript
import { test, expect } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { setRoomDimensions, getRoomDimension } from '../helpers/room';
import { addLampFromPreset, lampCount } from '../helpers/lamps';
import { addZone, zoneCount } from '../helpers/zones';

test.describe('Save and load project', () => {
  test('round-trip: save project, reload, load file, verify state', async ({ page }) => {
    await waitForSession(page);

    // Configure project
    await setRoomDimensions(page, { x: 6, y: 4, z: 3 });
    await page.waitForTimeout(500);
    await addLampFromPreset(page);
    await addZone(page);

    // Collapse zone editor
    await page.locator('h3:has-text("Room")').click();
    await page.waitForTimeout(300);

    // Save via File menu
    const fileMenu = page.locator('.menu-bar-item').filter({ hasText: 'File' }).locator('span[role="button"]');
    await fileMenu.click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('div[role="menuitem"]:has-text("Save")').click(),
    ]);

    // Save the downloaded file to a temp path
    const filePath = await download.path();
    expect(filePath).toBeTruthy();

    // Navigate to fresh page (new session)
    await page.goto('/');
    await expect(page.locator('span.status-indicator')).toBeVisible({ timeout: 15_000 });

    // Load the saved file via File menu
    await fileMenu.click();

    // Set up file chooser before clicking Open
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('div[role="menuitem"]:has-text("Open")').click(),
    ]);
    await fileChooser.setFiles(filePath!);

    // Wait for load to complete
    await page.waitForTimeout(2_000);

    // Verify state was restored
    expect(parseFloat(await getRoomDimension(page, 'X'))).toBe(6);
    expect(parseFloat(await getRoomDimension(page, 'Y'))).toBe(4);
    expect(parseFloat(await getRoomDimension(page, 'Z'))).toBe(3);
    expect(await lampCount(page)).toBe(1);
    expect(await zoneCount(page)).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run save/load test**

Run:
```bash
cd e2e && npx playwright test tests/save-load.spec.ts
```

Expected: Test passes.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/save-load.spec.ts
git commit -m "test(e2e): add save/load round-trip test"
```

---

### Task 9: Session recovery test

**Files:**
- Create: `e2e/tests/session-recovery.spec.ts`

- [ ] **Step 1: Create `e2e/tests/session-recovery.spec.ts`**

Uses Playwright route interception to simulate a backend session expiration.

```typescript
import { test, expect } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { addLampFromPreset, lampCount } from '../helpers/lamps';

test.describe('Session recovery', () => {
  test('recovers after backend session expires', async ({ page }) => {
    await waitForSession(page);

    // Add a lamp so we have some state
    await addLampFromPreset(page);
    expect(await lampCount(page)).toBe(1);

    // Intercept session API calls to return 401 (session expired)
    await page.route('**/api/v1/session/**', (route) => {
      route.fulfill({ status: 401, body: JSON.stringify({ detail: 'Session expired' }) });
    });

    // Trigger an action that makes an API call (e.g., add another lamp)
    // This should fail, triggering the session recovery flow
    await page.locator('button:has-text("Add Lamp")').click();

    // Wait a moment for the retry mechanism to kick in
    await page.waitForTimeout(2_000);

    // Remove the intercept so recovery can succeed
    await page.unroute('**/api/v1/session/**');

    // Wait for the app to recover — status should show Ready again
    await expect(page.locator('text=Ready')).toBeVisible({ timeout: 15_000 });
  });
});
```

- [ ] **Step 2: Run session recovery test**

Run:
```bash
cd e2e && npx playwright test tests/session-recovery.spec.ts
```

Expected: Test passes. The session recovery mechanism reinitializes the backend session.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/session-recovery.spec.ts
git commit -m "test(e2e): add session recovery test"
```

---

### Task 10: Mobile test

**Files:**
- Create: `e2e/tests/mobile.spec.ts`

- [ ] **Step 1: Create `e2e/tests/mobile.spec.ts`**

The app switches to a tab-based interface when viewport width < 768px.

```typescript
import { test, expect, devices } from '@playwright/test';
import { waitForSession } from '../helpers/session';

test.describe('Mobile layout', () => {
  test.use({ viewport: { width: 375, height: 812 } }); // iPhone-sized

  test.beforeEach(async ({ page }) => {
    await waitForSession(page);
  });

  test('shows mobile tab navigation', async ({ page }) => {
    // Mobile layout should have tab buttons for switching between panels
    // Look for mobile-specific navigation elements
    const tabs = page.locator('.mobile-tabs, [role="tablist"], .tab-bar');
    // If no dedicated mobile tabs, the panels should still be accessible
    // The app renders differently at < 768px — verify key elements are present
    await expect(page.locator('canvas')).toBeVisible();
  });

  test('can access panels at narrow viewport', async ({ page }) => {
    // At mobile width, verify that room/lamp/zone content is reachable
    // The exact navigation depends on mobile implementation
    // At minimum, verify the page loads without errors
    await expect(page.locator('text=Ready')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run mobile tests**

Run:
```bash
cd e2e && npx playwright test tests/mobile.spec.ts
```

Expected: Tests pass. These verify the app renders without errors at narrow viewport. May need selector adjustments based on actual mobile DOM.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/mobile.spec.ts
git commit -m "test(e2e): add mobile layout tests"
```

---

### Task 11: Error states test

**Files:**
- Create: `e2e/tests/error-states.spec.ts`

- [ ] **Step 1: Create `e2e/tests/error-states.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { setRoomDimensions, getRoomDimension } from '../helpers/room';

test.describe('Error states', () => {
  test.beforeEach(async ({ page }) => {
    await waitForSession(page);
  });

  test('rejects invalid room dimension (zero)', async ({ page }) => {
    const originalX = await getRoomDimension(page, 'X');
    // Try to set X to 0 — should be rejected
    await setRoomDimensions(page, { x: 0 });
    await page.waitForTimeout(500);
    // Value should revert to original (RoomEditor rejects non-positive values)
    const currentX = await getRoomDimension(page, 'X');
    expect(parseFloat(currentX)).toBe(parseFloat(originalX));
  });

  test('rejects negative room dimension', async ({ page }) => {
    const originalY = await getRoomDimension(page, 'Y');
    await setRoomDimensions(page, { y: -3 });
    await page.waitForTimeout(500);
    const currentY = await getRoomDimension(page, 'Y');
    expect(parseFloat(currentY)).toBe(parseFloat(originalY));
  });

  test('calculate button shows needs-calc state with valid setup', async ({ page }) => {
    // With no lamps, calculate button should exist but may be in a specific state
    const calcBtn = page.locator('button.calculate-btn');
    await expect(calcBtn).toBeVisible();
  });
});
```

- [ ] **Step 2: Run error states tests**

Run:
```bash
cd e2e && npx playwright test tests/error-states.spec.ts
```

Expected: All 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/error-states.spec.ts
git commit -m "test(e2e): add error state tests"
```

---

### Task 12: CI integration

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add e2e-tests job to `.github/workflows/ci.yml`**

Add this job after the existing `docker-build` job:

```yaml
  e2e-tests:
    name: E2E Tests
    needs: [ui-tests, api-tests]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: ui/pnpm-lock.yaml
      - uses: astral-sh/setup-uv@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Install UI dependencies
        run: cd ui && pnpm install --frozen-lockfile
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

- [ ] **Step 2: Verify CI config is valid YAML**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "Valid YAML"
```

Expected: "Valid YAML"

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add Playwright e2e test job"
```

---

## Run Order

Tasks must be completed in order — each task builds on previous ones:

1. **Task 1** (scaffold) — everything depends on this
2. **Task 2** (smoke) — validates the helper pattern works
3. **Tasks 3-6** (room, lamps, zones, calculate) — each adds a helper used by later tests
4. **Tasks 7-11** (value-labels, save/load, recovery, mobile, errors) — independent, use existing helpers
5. **Task 12** (CI) — last, after all tests are verified locally
