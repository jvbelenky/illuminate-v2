# E2E Test Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate 10 e2e test files into 6 comprehensive tests with full coverage of lamp operations, zone operations, copy verification, reflections, and save/load roundtrips.

**Architecture:** Playwright e2e tests organized into shared helper modules and focused test files. Helpers encapsulate DOM interactions. Tests use `test.describe.serial` with shared page state for efficiency. Backend state verified via API calls and frontend store access.

**Tech Stack:** Playwright Test, TypeScript, Chromium

**Spec:** `docs/superpowers/specs/2026-04-11-e2e-test-consolidation-design.md`

---

### Task 1: Create fixture files

**Files:**
- Create: `e2e/fixtures/test-lamp.ies`
- Create: `e2e/fixtures/test-spectrum.csv`

- [ ] **Step 1: Copy the aerolamp IES file**

```bash
cp ~/guv-calcs/src/guv_calcs/data/lamp_data/aerolamp.ies e2e/fixtures/test-lamp.ies
```

- [ ] **Step 2: Create the test spectrum CSV**

Create `e2e/fixtures/test-spectrum.csv`:

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

- [ ] **Step 3: Commit**

```bash
git add e2e/fixtures/
git commit -m "test: add e2e fixture files for IES and spectrum uploads"
```

---

### Task 2: Create `e2e/helpers/api.ts` — backend state access

**Files:**
- Create: `e2e/helpers/api.ts`

- [ ] **Step 1: Write the helper module**

Create `e2e/helpers/api.ts`:

```typescript
import { type Page, expect } from '@playwright/test';

const API_BASE = 'http://localhost:8000/api/v1';

/** Fetch all zones from the backend API. */
export async function getZonesFromBackend(page: Page): Promise<Record<string, any>[]> {
  const response = await page.request.get(`${API_BASE}/session/zones`, {
    headers: { 'X-Session-Id': await getSessionId(page) },
  });
  expect(response.ok()).toBe(true);
  const data = await response.json();
  return data.zones;
}

/** Read lamp instances from the frontend Svelte store. */
export async function getLampsFromStore(page: Page): Promise<Record<string, any>[]> {
  return page.evaluate(() => {
    // Access the Svelte store via the module-level export
    // The store is reactive; get() reads the current value synchronously
    const storeModule = (window as any).__illuminate_store__;
    if (!storeModule) throw new Error('Store not exposed on window');
    return JSON.parse(JSON.stringify(storeModule.lamps));
  });
}

/**
 * Compare two objects, asserting all fields match except excluded keys.
 * Throws descriptive assertion errors for mismatched fields.
 */
export function assertObjectsMatch(
  original: Record<string, any>,
  copy: Record<string, any>,
  excludeKeys: string[]
): void {
  const allKeys = new Set([...Object.keys(original), ...Object.keys(copy)]);
  for (const key of allKeys) {
    if (excludeKeys.includes(key)) continue;
    const origVal = JSON.stringify(original[key]);
    const copyVal = JSON.stringify(copy[key]);
    expect(copyVal, `Field "${key}" should match: original=${origVal}`).toBe(origVal);
  }
}

/** Get the session ID from the page's session state. */
async function getSessionId(page: Page): Promise<string> {
  return page.evaluate(() => {
    return (window as any).__illuminate_store__?.sessionId ?? '';
  });
}
```

- [ ] **Step 2: Check if the store is already exposed on `window`**

The helpers above assume the store is exposed as `window.__illuminate_store__`. We need to check whether this is already done or if we need to add it. Search for any existing `window.__` exposure in the project store:

```bash
grep -r '__illuminate\|window\.__' ui/src/lib/stores/ e2e/
```

If NOT already exposed, we have two options:
1. Add a small exposure in the store file (only in dev mode)
2. Use `page.evaluate` with `document.querySelector` to read from DOM instead

**If the store is NOT exposed**, add this to the bottom of `ui/src/lib/stores/project.ts` (after the `export const project = createProjectStore();` line):

```typescript
// Expose store state for e2e test access (dev only)
if (import.meta.env.DEV) {
  project.subscribe((state) => {
    (window as any).__illuminate_store__ = {
      lamps: state.lamps,
      zones: state.zones,
      sessionId: state.room?.session_id ?? '',
    };
  });
}
```

**If the store IS already exposed**, adapt the `getLampsFromStore` and `getSessionId` functions to match the existing exposure pattern.

- [ ] **Step 3: Commit**

```bash
git add e2e/helpers/api.ts ui/src/lib/stores/project.ts
git commit -m "test: add e2e helper for backend state access and store exposure"
```

---

### Task 3: Create `e2e/helpers/reflections.ts` — reflectance controls

**Files:**
- Create: `e2e/helpers/reflections.ts`

- [ ] **Step 1: Write the helper module**

Create `e2e/helpers/reflections.ts`:

```typescript
import { type Page, expect } from '@playwright/test';

/** Ensure the Room panel is expanded. */
async function expandRoomPanel(page: Page): Promise<void> {
  const header = page.locator('.panel-header').filter({ hasText: 'Room' });
  const content = header.locator('..').locator('.panel-content');
  if (!(await content.isVisible().catch(() => false))) {
    await header.click();
    await expect(content).toBeVisible();
  }
}

/** Check the "Enable reflections" checkbox (idempotent — no-op if already checked). */
export async function enableReflections(page: Page): Promise<void> {
  await expandRoomPanel(page);
  const checkbox = page.locator('label').filter({ hasText: 'Enable reflections' }).locator('input[type="checkbox"]');
  if (!(await checkbox.isChecked())) {
    await checkbox.check();
  }
}

/** Read whether reflections are enabled. */
export async function isReflectionsEnabled(page: Page): Promise<boolean> {
  await expandRoomPanel(page);
  return page.locator('label').filter({ hasText: 'Enable reflections' }).locator('input[type="checkbox"]').isChecked();
}

/** Open the Reflectance Settings modal. */
export async function openReflectanceModal(page: Page): Promise<void> {
  await expandRoomPanel(page);
  await page.locator('button.reflectance-btn').click();
  await expect(page.locator('.modal-backdrop')).toBeVisible({ timeout: 5_000 });
}

/** Close the Reflectance Settings modal via the close button. */
export async function closeReflectanceModal(page: Page): Promise<void> {
  await page.locator('.header-btn.close-btn').click();
  await expect(page.locator('.modal-backdrop')).not.toBeVisible({ timeout: 5_000 });
}

/** Set a specific surface's reflectance value. Modal must be open. */
export async function setSurfaceReflectance(
  page: Page,
  surface: string,
  value: number
): Promise<void> {
  const row = page.locator('.surface-row').filter({ has: page.locator(`.surface-name:text-is("${surface}")`) });
  const input = row.locator('input').first();
  await input.click({ clickCount: 3 });
  await input.fill(String(value));
  await input.press('Tab');
}

/** Read a specific surface's reflectance value. Modal must be open. */
export async function getSurfaceReflectance(
  page: Page,
  surface: string
): Promise<number> {
  const row = page.locator('.surface-row').filter({ has: page.locator(`.surface-name:text-is("${surface}")`) });
  const val = await row.locator('input').first().inputValue();
  return parseFloat(val);
}
```

- [ ] **Step 2: Commit**

```bash
git add e2e/helpers/reflections.ts
git commit -m "test: add e2e helper for reflectance settings"
```

---

### Task 4: Expand `e2e/helpers/lamps.ts` — new lamp helpers

**Files:**
- Modify: `e2e/helpers/lamps.ts`

- [ ] **Step 1: Add all new lamp helper functions**

Append the following exports to the existing `e2e/helpers/lamps.ts` file (after the existing `lampCount` function):

```typescript
/** Add a lamp and select a specific lamp type (does NOT select a preset). */
export async function addLampWithType(
  page: Page,
  lampType: 'krcl_222' | 'lp_254' | 'other'
): Promise<void> {
  await expandLampsPanel(page);
  await page.locator('button:has-text("Add Lamp")').click();
  const typeSelect = page.locator('select#lamp-type');
  await expect(typeSelect).toBeVisible({ timeout: 15_000 });
  await typeSelect.selectOption(lampType);
}

/** Upload an IES file in the currently-open lamp editor. */
export async function uploadLampIes(page: Page, filePath: string): Promise<void> {
  const fileInput = page.locator('.inline-editor input[type="file"][accept=".ies"]');
  await fileInput.setInputFiles(filePath);
  // Wait for the upload to process — file status shows success or the filename appears
  await expect(page.locator('.inline-editor .file-status')).toBeVisible({ timeout: 15_000 });
}

/** Upload a spectrum file in the currently-open lamp editor. */
export async function uploadLampSpectrum(page: Page, filePath: string): Promise<void> {
  const fileInput = page.locator('.inline-editor input[type="file"][accept=".csv,.xls,.xlsx"]');
  await fileInput.setInputFiles(filePath);
  await expect(page.locator('.inline-editor .file-status').last()).toBeVisible({ timeout: 15_000 });
}

/** Set the wavelength input for an "other" type lamp. */
export async function setLampWavelength(page: Page, value: number): Promise<void> {
  const input = page.locator('#wavelength');
  await input.click({ clickCount: 3 });
  await input.fill(String(value));
  await input.press('Tab');
}

/** Click a placement preset button in the open lamp editor. */
export async function clickPlacementPreset(
  page: Page,
  preset: 'Downlight' | 'Corner' | 'Edge' | 'Horizontal'
): Promise<void> {
  await page.locator('.placement-buttons button').filter({ hasText: preset }).click();
  // Brief wait for the backend to respond with new position
  await page.waitForTimeout(500);
}

/** Click an aim preset button in the open lamp editor. */
export async function clickAimPreset(
  page: Page,
  preset: 'Down' | 'Corner' | 'Edge' | 'Horizontal'
): Promise<void> {
  await page.locator('.aim-presets button').filter({ hasText: preset }).click();
  await page.waitForTimeout(500);
}

/** Click the tilt/orientation mode toggle button. */
export async function toggleTiltMode(page: Page): Promise<void> {
  await page.locator('button.mode-switch').click();
}

/** Open the advanced lamp settings modal (click "Details..." button). */
export async function openAdvancedSettings(page: Page): Promise<void> {
  await page.locator('.inline-editor button.secondary').filter({ hasText: 'Details...' }).click();
  await expect(page.locator('.modal-backdrop')).toBeVisible({ timeout: 5_000 });
}

/** Click a tab in the advanced settings modal. */
export async function selectAdvancedTab(
  page: Page,
  tabText: string
): Promise<void> {
  const tab = page.locator('button[role="tab"]').filter({ hasText: tabText });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** Close the advanced lamp settings modal. */
export async function closeAdvancedSettings(page: Page): Promise<void> {
  await page.locator('.header-btn.close-btn').click();
  await expect(page.locator('.modal-backdrop')).not.toBeVisible({ timeout: 5_000 });
}

/** Click a lamp list item to open its editor. */
export async function selectLamp(page: Page, index: number = 0): Promise<void> {
  await expandLampsPanel(page);
  const item = page.locator('.item-list-item[data-lamp-id]').nth(index);
  await item.locator('button.name-display').click();
  await expect(item.locator('.inline-editor')).toBeVisible({ timeout: 5_000 });
}

/** Copy the currently open lamp via the editor's Copy button. */
export async function copyLamp(page: Page): Promise<void> {
  await page.locator('.inline-editor .editor-actions button').filter({ hasText: 'Copy' }).click();
  // Copy closes the editor; wait for the new item to appear
  await page.waitForTimeout(1_000);
}
```

- [ ] **Step 2: Commit**

```bash
git add e2e/helpers/lamps.ts
git commit -m "test: add comprehensive lamp helper functions for e2e tests"
```

---

### Task 5: Expand `e2e/helpers/zones.ts` — new zone helpers

**Files:**
- Modify: `e2e/helpers/zones.ts`

- [ ] **Step 1: Add all new zone helper functions**

Append the following exports to the existing `e2e/helpers/zones.ts` file (after the existing `zoneCount` function):

```typescript
/** Click a zone list item to open its editor. */
export async function selectZone(page: Page, index: number = 0): Promise<void> {
  await expandZonesPanel(page);
  const item = page.locator('.item-list-item[data-zone-id]:not(.standard-zone)').nth(index);
  await item.locator('button.name-display').click();
  await expect(item.locator('.inline-editor')).toBeVisible({ timeout: 5_000 });
}

/** Copy the currently open zone via the editor's Copy button. */
export async function copyZone(page: Page): Promise<void> {
  await page.locator('.inline-editor .editor-actions button').filter({ hasText: 'Copy' }).click();
  await page.waitForTimeout(1_000);
}

/** Delete a custom zone by index. */
export async function removeZone(page: Page, index: number = 0): Promise<void> {
  const zoneItem = page.locator('.item-list-item[data-zone-id]:not(.standard-zone)').nth(index);
  await zoneItem.locator('button[aria-label*="Delete"]').click();
  const confirmBtn = page.locator('button.confirm-btn');
  await expect(confirmBtn).toBeVisible({ timeout: 2_000 });
  await confirmBtn.click();
}

/**
 * Set the reference surface for a plane zone via the illustrated selector.
 * The zone editor must be open and the zone must be a plane type.
 */
export async function setRefSurface(page: Page, surface: 'XY' | 'XZ' | 'YZ'): Promise<void> {
  // Open the reference surface selector (second illustrated-selector in the editor after calc type)
  const editor = page.locator('.inline-editor');
  const refSurfaceGroups = editor.locator('.form-group').filter({
    has: page.locator('label:text-is("Reference Surface")')
  });
  await refSurfaceGroups.locator('button.illustrated-selector-summary').click();
  await page.locator('.illustrated-option').filter({ hasText: surface }).click();
}

/** Toggle the grid resolution mode (spacing ↔ num_points). */
export async function toggleResolutionMode(page: Page): Promise<void> {
  await page.locator('button.mode-switch-btn').click();
}

/** Toggle the offset via illustrated selector. */
export async function toggleOffset(page: Page): Promise<void> {
  const editor = page.locator('.inline-editor');
  // The offset selector is in the form-group that has "Boundary Offset" or similar label.
  // Click the summary to open, then click the non-active option.
  const offsetGroups = editor.locator('.form-group').filter({
    has: page.locator('.illustrated-selector-summary')
  }).last(); // Offset is typically the last illustrated selector
  await offsetGroups.locator('button.illustrated-selector-summary').click();
  // Click whichever option is NOT currently active
  const options = page.locator('.illustrated-option');
  const count = await options.count();
  for (let i = 0; i < count; i++) {
    const opt = options.nth(i);
    const classes = await opt.getAttribute('class') || '';
    if (!classes.includes('active')) {
      await opt.click();
      return;
    }
  }
}

/**
 * Set the display mode for a zone.
 * These are the buttons in the display section (Heatmap, Numeric, Markers, None).
 */
export async function setDisplayMode(
  page: Page,
  mode: 'Heatmap' | 'Iso' | 'Numeric' | 'Markers' | 'None'
): Promise<void> {
  const editor = page.locator('.inline-editor');
  // Display mode buttons are in a .zone-type-buttons container that is separate from the type selector
  // They contain text like "Heatmap", "Numeric", "Markers", "None"
  const btn = editor.locator('.zone-type-buttons').last().locator('button.zone-type-btn').filter({ hasText: mode });
  await btn.click();
  await expect(btn).toHaveClass(/active/, { timeout: 2_000 });
}

/** Enable dose mode and set time values. */
export async function setDose(
  page: Page,
  hours: number,
  minutes: number,
  seconds: number
): Promise<void> {
  const valueType = page.locator('select#value-type');
  await valueType.selectOption({ value: 'true' }); // dose = true
  // Wait for time inputs to appear
  await expect(page.locator('#dose-hours')).toBeVisible({ timeout: 2_000 });

  for (const [id, val] of [['dose-hours', hours], ['dose-minutes', minutes], ['dose-seconds', seconds]]) {
    const input = page.locator(`#${id}`);
    await input.click({ clickCount: 3 });
    await input.fill(String(val));
    await input.press('Tab');
  }
}

/** Disable dose mode (switch back to irradiance/fluence). */
export async function disableDose(page: Page): Promise<void> {
  await page.locator('select#value-type').selectOption({ value: 'false' });
}
```

- [ ] **Step 2: Commit**

```bash
git add e2e/helpers/zones.ts
git commit -m "test: add comprehensive zone helper functions for e2e tests"
```

---

### Task 6: Rewrite `e2e/tests/smoke.spec.ts`

**Files:**
- Modify: `e2e/tests/smoke.spec.ts`

- [ ] **Step 1: Rewrite to single comprehensive test**

Replace the entire contents of `e2e/tests/smoke.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { waitForSession } from '../helpers/session';

test.describe('Smoke tests', () => {
  test('app loads, session initializes, UI renders', async ({ page }) => {
    await waitForSession(page);

    // Canvas renders
    await expect(page.locator('canvas')).toBeVisible();

    // Left panel sections visible
    await expect(page.locator('h3:has-text("Room")')).toBeVisible();
    await expect(page.locator('h3:has-text("Lamps")')).toBeVisible();
    await expect(page.locator('h3:has-text("Calc Zones")')).toBeVisible();

    // Status bar shows counts
    await expect(page.locator('text=Lamps:')).toBeVisible();
    await expect(page.locator('text=Zones:')).toBeVisible();
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add e2e/tests/smoke.spec.ts
git commit -m "test: consolidate smoke tests into single comprehensive test"
```

---

### Task 7: Rewrite `e2e/tests/room.spec.ts` — merge room + error-states

**Files:**
- Modify: `e2e/tests/room.spec.ts`

- [ ] **Step 1: Rewrite with merged error-state coverage**

Replace the entire contents of `e2e/tests/room.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { setRoomDimensions, getRoomDimension } from '../helpers/room';

test.describe('Room configuration', () => {
  test('edit dimensions, reject invalid values, switch units', async ({ page }) => {
    await waitForSession(page);

    // Edit all three dimensions
    await setRoomDimensions(page, { x: 7, y: 5.5, z: 2.8 });
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'X'))).toBe(7);
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'Y'))).toBe(5.5);
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'Z'))).toBe(2.8);

    // Reject zero dimension
    const originalX = await getRoomDimension(page, 'X');
    await setRoomDimensions(page, { x: 0 });
    await expect.poll(() => getRoomDimension(page, 'X')).toBe(originalX);

    // Reject negative dimension
    const originalY = await getRoomDimension(page, 'Y');
    await setRoomDimensions(page, { y: -3 });
    await expect.poll(() => getRoomDimension(page, 'Y')).toBe(originalY);

    // Switch units
    const unitsSelect = page.locator('.room-editor select.units-select');
    await unitsSelect.selectOption('feet');
    await expect(unitsSelect).toHaveValue('feet');
    await unitsSelect.selectOption('meters');
    await expect(unitsSelect).toHaveValue('meters');
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add e2e/tests/room.spec.ts
git commit -m "test: consolidate room and error-state tests"
```

---

### Task 8: Rewrite `e2e/tests/mobile.spec.ts`

**Files:**
- Modify: `e2e/tests/mobile.spec.ts`

- [ ] **Step 1: Rewrite to single test**

Replace the entire contents of `e2e/tests/mobile.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Mobile layout', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('app renders at mobile viewport', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 15_000 });
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add e2e/tests/mobile.spec.ts
git commit -m "test: consolidate mobile tests"
```

---

### Task 9: Create `e2e/tests/workflow.spec.ts` — comprehensive workflow

**Files:**
- Create: `e2e/tests/workflow.spec.ts`

This is the largest task. The workflow test uses `test.describe.serial` with a shared page. Each serial test builds on the state left by the previous one.

- [ ] **Step 1: Write the file scaffold and preset lamp test**

Create `e2e/tests/workflow.spec.ts`:

```typescript
import { test, expect, type Page } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import {
  addLampFromPreset, lampCount, removeLamp, selectLamp, copyLamp,
  clickPlacementPreset, clickAimPreset, toggleTiltMode,
  openAdvancedSettings, selectAdvancedTab, closeAdvancedSettings,
  addLampWithType, uploadLampIes, setLampWavelength,
} from '../helpers/lamps';
import {
  addZone, switchZoneType, setCalcMode, zoneCount, selectZone,
  copyZone, removeZone, setRefSurface, toggleResolutionMode,
  toggleOffset, setDisplayMode, setDose, disableDose,
} from '../helpers/zones';
import { calculate, waitForResults } from '../helpers/calculations';
import { getZonesFromBackend, getLampsFromStore, assertObjectsMatch } from '../helpers/api';
import path from 'path';

const IES_FIXTURE = path.resolve(__dirname, '../fixtures/test-lamp.ies');

test.describe.serial('Comprehensive workflow', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await waitForSession(page);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('preset lamp: placement, aim, tilt, toggles, advanced settings', async () => {
    test.setTimeout(60_000);

    // Add preset lamp
    await addLampFromPreset(page);
    expect(await lampCount(page)).toBe(1);
    await expect(page.locator('.item-list-item[data-lamp-id] .inline-editor').first()).toBeVisible();

    // --- Position editing ---
    const positionGroup = page.locator('.inline-editor .form-group').filter({
      has: page.locator('label:has-text("Position")')
    }).first();
    const posInputs = positionGroup.locator('.vector-row input');
    for (const [i, val] of [[0, '2'], [1, '3'], [2, '2.5']] as [number, string][]) {
      await posInputs.nth(i).click({ clickCount: 3 });
      await posInputs.nth(i).fill(val);
      await posInputs.nth(i).press('Tab');
    }

    // --- Aim point editing ---
    const aimGroup = page.locator('.inline-editor .form-group').filter({
      has: page.locator('label:has-text("Aim Point")')
    }).first();
    const aimInputs = aimGroup.locator('.vector-row input');
    for (const [i, val] of [[0, '2'], [1, '3'], [2, '0']] as [number, string][]) {
      await aimInputs.nth(i).click({ clickCount: 3 });
      await aimInputs.nth(i).fill(val);
      await aimInputs.nth(i).press('Tab');
    }

    // --- All 4 placement presets ---
    await clickPlacementPreset(page, 'Downlight');
    await clickPlacementPreset(page, 'Corner');
    await clickPlacementPreset(page, 'Edge');
    await clickPlacementPreset(page, 'Horizontal');

    // --- All 4 aim presets ---
    await clickAimPreset(page, 'Down');
    await clickAimPreset(page, 'Corner');
    await clickAimPreset(page, 'Edge');
    await clickAimPreset(page, 'Horizontal');

    // --- Tilt/Orientation mode ---
    await toggleTiltMode(page);
    // Verify tilt inputs appear
    const tiltLabel = page.locator('.inline-editor label, .inline-editor .section-label').filter({ hasText: 'Tilt / Orientation' });
    await expect(tiltLabel).toBeVisible();
    // Set tilt and orientation values
    const tiltInputs = page.locator('.inline-editor .form-row input[inputmode="decimal"]');
    await tiltInputs.first().click({ clickCount: 3 });
    await tiltInputs.first().fill('30');
    await tiltInputs.first().press('Tab');
    await tiltInputs.nth(1).click({ clickCount: 3 });
    await tiltInputs.nth(1).fill('45');
    await tiltInputs.nth(1).press('Tab');

    // Switch back to aim-point mode
    await toggleTiltMode(page);
    await expect(page.locator('.inline-editor .form-group').filter({
      has: page.locator('label:has-text("Aim Point")')
    }).first()).toBeVisible();

    // --- Toggles ---
    const showLabel = page.locator('.inline-editor label.toggle-row').filter({ hasText: 'Show Label' }).locator('input[type="checkbox"]');
    await showLabel.check();
    await expect(showLabel).toBeChecked();

    const showWeb = page.locator('.inline-editor label.toggle-row').filter({ hasText: 'Show Photometric Web' }).locator('input[type="checkbox"]');
    const webChecked = await showWeb.isChecked();
    if (webChecked) {
      await showWeb.uncheck();
      await expect(showWeb).not.toBeChecked();
      await showWeb.check();
    } else {
      await showWeb.check();
      await expect(showWeb).toBeChecked();
    }

    // Enable/disable toggle
    const lampItem = page.locator('.item-list-item[data-lamp-id]').first();
    const toggleBtn = lampItem.locator('button.icon-toggle[aria-label*="Exclude"], button.icon-toggle[aria-label*="Include"]');
    await toggleBtn.click();
    await expect(lampItem).toHaveClass(/calc-disabled/);
    await toggleBtn.click();
    await expect(lampItem).not.toHaveClass(/calc-disabled/);

    // --- Advanced settings modal ---
    await openAdvancedSettings(page);

    // Info tab should be visible by default
    await expect(page.locator('button[role="tab"]').filter({ hasText: 'Photometric and Spectral Info' })).toHaveAttribute('aria-selected', 'true');

    // Scaling tab
    await selectAdvancedTab(page, 'Scaling & Units');
    await page.locator('select#scaling-method').selectOption('max');
    const scalingValue = page.locator('#scaling-value');
    await scalingValue.click({ clickCount: 3 });
    await scalingValue.fill('100');
    await scalingValue.press('Tab');

    // Luminous Opening tab
    await selectAdvancedTab(page, 'Luminous Opening');
    const srcWidth = page.locator('#source-width');
    await srcWidth.click({ clickCount: 3 });
    await srcWidth.fill('0.05');
    await srcWidth.press('Tab');
    const srcLength = page.locator('#source-length');
    await srcLength.click({ clickCount: 3 });
    await srcLength.fill('0.1');
    await srcLength.press('Tab');

    // Lamp Fixture tab
    await selectAdvancedTab(page, 'Lamp Fixture');
    for (const id of ['#housing-width', '#housing-length', '#housing-height']) {
      const input = page.locator(id);
      await input.click({ clickCount: 3 });
      await input.fill('0.15');
      await input.press('Tab');
    }

    await closeAdvancedSettings(page);

    // Collapse lamp editor for next test
    await page.locator('.inline-editor .close-x').click();
  });

  test('custom lamp: file upload, wavelength, placement, advanced settings', async () => {
    test.setTimeout(60_000);

    await addLampWithType(page, 'other');
    expect(await lampCount(page)).toBe(2);

    // Upload IES file
    await uploadLampIes(page, IES_FIXTURE);

    // Set wavelength
    await setLampWavelength(page, 265);

    // Placement preset
    await clickPlacementPreset(page, 'Downlight');

    // Aim
    await clickAimPreset(page, 'Down');

    // Advanced settings
    await openAdvancedSettings(page);
    await selectAdvancedTab(page, 'Scaling & Units');
    await page.locator('select#scaling-method').selectOption('total');
    const scalingValue = page.locator('#scaling-value');
    await scalingValue.click({ clickCount: 3 });
    await scalingValue.fill('50');
    await scalingValue.press('Tab');

    await selectAdvancedTab(page, 'Luminous Opening');
    const srcWidth = page.locator('#source-width');
    await srcWidth.click({ clickCount: 3 });
    await srcWidth.fill('0.03');
    await srcWidth.press('Tab');

    await closeAdvancedSettings(page);

    // Collapse lamp editor
    await page.locator('.inline-editor .close-x').click();
  });

  test('plane zone: all calc modes, reference surfaces, grid, offset, bounds, dose', async () => {
    test.setTimeout(60_000);

    await addZone(page);
    expect(await zoneCount(page)).toBe(1);

    // Set height
    const heightInput = page.locator('#plane-height');
    await heightInput.click({ clickCount: 3 });
    await heightInput.fill('1.5');
    await heightInput.press('Tab');

    // --- All 7 calc modes ---
    await setCalcMode(page, 'Fluence Rate');
    await setCalcMode(page, 'Planar Normal');
    await setCalcMode(page, 'Planar Maximum');

    // Eye (Worst Case) — verify FOV inputs appear
    await setCalcMode(page, 'Eye (Worst Case)');
    await expect(page.locator('#fov-vert')).toBeVisible();
    await expect(page.locator('#fov-horiz')).toBeVisible();
    const fovVert = page.locator('#fov-vert');
    await fovVert.click({ clickCount: 3 });
    await fovVert.fill('80');
    await fovVert.press('Tab');
    const fovHoriz = page.locator('#fov-horiz');
    await fovHoriz.click({ clickCount: 3 });
    await fovHoriz.fill('120');
    await fovHoriz.press('Tab');

    // Eye (Directional) — verify view direction inputs appear
    await setCalcMode(page, 'Eye (Directional)');
    const dirInputs = page.locator('.inline-editor .vector-row').filter({
      has: page.locator('span.vector-label:text-is("X")')
    }).last().locator('input');
    // Set view direction
    await dirInputs.nth(0).click({ clickCount: 3 });
    await dirInputs.nth(0).fill('0');
    await dirInputs.nth(0).press('Tab');
    await dirInputs.nth(1).click({ clickCount: 3 });
    await dirInputs.nth(1).fill('1');
    await dirInputs.nth(1).press('Tab');
    await dirInputs.nth(2).click({ clickCount: 3 });
    await dirInputs.nth(2).fill('0');
    await dirInputs.nth(2).press('Tab');

    // Eye (Target) — verify target point inputs appear
    await setCalcMode(page, 'Eye (Target)');

    // Custom — verify custom flag checkboxes
    await setCalcMode(page, 'Custom');
    const customFlags = page.locator('.inline-editor label.toggle-row input[type="checkbox"]');
    const flagCount = await customFlags.count();
    // Toggle each custom flag
    for (let i = 0; i < flagCount; i++) {
      const cb = customFlags.nth(i);
      const checked = await cb.isChecked();
      if (checked) await cb.uncheck(); else await cb.check();
    }

    // Set back to Fluence Rate for later use
    await setCalcMode(page, 'Fluence Rate');

    // --- Reference surface ---
    await setRefSurface(page, 'XZ');
    // Verify bounds labels changed (should show "X Range" and "Z Range")
    await expect(page.locator('.inline-editor label:text-is("Z Range")')).toBeVisible();
    await setRefSurface(page, 'YZ');
    await expect(page.locator('.inline-editor label:text-is("Y Range")')).toBeVisible();
    await setRefSurface(page, 'XY');

    // --- Grid resolution ---
    // Toggle to spacing mode
    await toggleResolutionMode(page);
    // Set spacing values
    const gridInputs = page.locator('.inline-editor .grid-inputs .grid-input input');
    await gridInputs.first().click({ clickCount: 3 });
    await gridInputs.first().fill('0.5');
    await gridInputs.first().press('Tab');
    // Toggle back to num_points
    await toggleResolutionMode(page);
    await gridInputs.first().click({ clickCount: 3 });
    await gridInputs.first().fill('10');
    await gridInputs.first().press('Tab');

    // --- Offset ---
    await toggleOffset(page);

    // --- Bounds ---
    const rangeRows = page.locator('.inline-editor .range-row');
    const firstRange = rangeRows.first();
    const rangeInputs = firstRange.locator('input');
    await rangeInputs.first().click({ clickCount: 3 });
    await rangeInputs.first().fill('0.5');
    await rangeInputs.first().press('Tab');
    await rangeInputs.last().click({ clickCount: 3 });
    await rangeInputs.last().fill('3.5');
    await rangeInputs.last().press('Tab');

    // --- Display mode ---
    await setDisplayMode(page, 'Numeric');
    await setDisplayMode(page, 'Markers');
    await setDisplayMode(page, 'Heatmap');

    // --- Dose ---
    await setDose(page, 1, 30, 0);
    await disableDose(page);

    // Collapse editor
    await page.locator('.inline-editor .close-x').click();
  });

  test('volume zone: bounds, grid, offset, display', async () => {
    await addZone(page);
    await switchZoneType(page, 'volume');
    expect(await zoneCount(page)).toBe(2);

    // Edit bounds
    const rangeRows = page.locator('.inline-editor .range-row');
    for (let i = 0; i < 3; i++) {
      const inputs = rangeRows.nth(i).locator('input');
      await inputs.first().click({ clickCount: 3 });
      await inputs.first().fill('0.5');
      await inputs.first().press('Tab');
      await inputs.last().click({ clickCount: 3 });
      await inputs.last().fill(String(2 + i * 0.5));
      await inputs.last().press('Tab');
    }

    // Grid resolution
    await toggleResolutionMode(page);
    await toggleResolutionMode(page);

    // Offset
    await toggleOffset(page);

    // Display modes
    await setDisplayMode(page, 'Numeric');
    await setDisplayMode(page, 'Markers');
    await setDisplayMode(page, 'None');
    await setDisplayMode(page, 'Heatmap');

    // Dose
    await setDose(page, 0, 15, 0);
    await disableDose(page);

    // Collapse editor
    await page.locator('.inline-editor .close-x').click();
  });

  test('point zone: position, aim, advanced flags, FOV, label', async () => {
    await addZone(page);
    await switchZoneType(page, 'point');
    expect(await zoneCount(page)).toBe(3);

    // Set position
    const posInputs = page.locator('.inline-editor .vector-row').first().locator('input');
    for (const [i, val] of [[0, '2'], [1, '3'], [2, '1']] as [number, string][]) {
      await posInputs.nth(i).click({ clickCount: 3 });
      await posInputs.nth(i).fill(val);
      await posInputs.nth(i).press('Tab');
    }

    // Set aim point
    const aimInputs = page.locator('.inline-editor .vector-row').nth(1).locator('input');
    for (const [i, val] of [[0, '2'], [1, '3'], [2, '0']] as [number, string][]) {
      await aimInputs.nth(i).click({ clickCount: 3 });
      await aimInputs.nth(i).fill(val);
      await aimInputs.nth(i).press('Tab');
    }

    // Expand Advanced section
    const advancedToggle = page.locator('.inline-editor .iso-toggle').filter({ hasText: 'Advanced' });
    await advancedToggle.click();

    // Toggle custom flags
    const flags = page.locator('.inline-editor .toggle-row input[type="checkbox"]');
    const flagCount = await flags.count();
    for (let i = 0; i < flagCount; i++) {
      const cb = flags.nth(i);
      if (await cb.isVisible()) {
        const checked = await cb.isChecked();
        if (checked) await cb.uncheck(); else await cb.check();
      }
    }

    // Set FOV
    const fovVert = page.locator('#fov-vert');
    if (await fovVert.isVisible()) {
      await fovVert.click({ clickCount: 3 });
      await fovVert.fill('80');
      await fovVert.press('Tab');
    }
    const fovHoriz = page.locator('#fov-horiz');
    if (await fovHoriz.isVisible()) {
      await fovHoriz.click({ clickCount: 3 });
      await fovHoriz.fill('120');
      await fovHoriz.press('Tab');
    }

    // Show label
    const showLabel = page.locator('.inline-editor label.toggle-row').filter({ hasText: 'Show Label' }).locator('input[type="checkbox"]');
    if (await showLabel.isVisible()) {
      await showLabel.check();
      await expect(showLabel).toBeChecked();
    }

    // Collapse editor
    await page.locator('.inline-editor .close-x').click();
  });

  test('copy verification: all zone types', async () => {
    test.setTimeout(60_000);

    // Copy plane zone (index 0)
    await selectZone(page, 0);
    await copyZone(page);
    expect(await zoneCount(page)).toBe(4);

    // Copy volume zone (index 1)
    await selectZone(page, 1);
    await copyZone(page);
    expect(await zoneCount(page)).toBe(5);

    // Copy point zone (index 2)
    await selectZone(page, 2);
    await copyZone(page);
    expect(await zoneCount(page)).toBe(6);

    // Verify backend state
    const zones = await getZonesFromBackend(page);
    // Find pairs by matching " (Copy)" suffix in name
    for (const zone of zones) {
      if (zone.name && zone.name.endsWith(' (Copy)')) {
        const originalName = zone.name.replace(' (Copy)', '');
        const original = zones.find(z => z.name === originalName || z.id !== zone.id && z.type === zone.type && !z.name?.endsWith(' (Copy)'));
        if (original) {
          assertObjectsMatch(original, zone, ['id', 'name', 'isStandard']);
        }
      }
    }
  });

  test('copy verification: lamp', async () => {
    // Copy the preset lamp (first lamp, index 0)
    await selectLamp(page, 0);
    await copyLamp(page);
    expect(await lampCount(page)).toBe(3);

    // Verify frontend store state
    const lamps = await getLampsFromStore(page);
    expect(lamps.length).toBe(3);

    // The copy should be the last lamp in the array
    const copy = lamps[lamps.length - 1];
    const original = lamps[0];
    assertObjectsMatch(original, copy, ['id', 'name']);
  });

  test('cleanup, standard zones, calculation, display settings', async () => {
    test.setTimeout(60_000);

    // Delete copied zones (they're at the end: indices 5, 4, 3 — delete from end)
    for (let i = 0; i < 3; i++) {
      await removeZone(page, await zoneCount(page) - 1);
    }
    expect(await zoneCount(page)).toBe(3);

    // Delete copied lamp (last one)
    await removeLamp(page, await lampCount(page) - 1);
    expect(await lampCount(page)).toBe(2);

    // Toggle a standard zone
    const standardZone = page.locator('.item-list-item.standard-zone').first();
    if (await standardZone.isVisible()) {
      const stdToggle = standardZone.locator('button.icon-toggle').first();
      await stdToggle.click();
      await page.waitForTimeout(500);
      await stdToggle.click();
    }

    // Collapse any open editors
    const closeBtn = page.locator('.inline-editor .close-x');
    if (await closeBtn.isVisible()) await closeBtn.click();

    // Calculate
    await calculate(page);
    await waitForResults(page);

    // Verify results
    const statLabels = page.locator('.stat-label');
    expect(await statLabels.count()).toBeGreaterThan(0);
    await expect(page.locator('text=Last calculated:')).toBeVisible();

    // Toggle a display setting via View menu
    const viewMenu = page.locator('.menu-bar-item').filter({ hasText: 'View' }).locator('span[role="button"]');
    await viewMenu.click();
    const gridToggle = page.locator('div[role="menuitem"]').filter({ hasText: 'Grid' });
    if (await gridToggle.isVisible()) {
      await gridToggle.click();
      await page.waitForTimeout(300);
      // Re-open and toggle back
      await viewMenu.click();
      await gridToggle.click();
    } else {
      // Close menu if toggle not found
      await page.keyboard.press('Escape');
    }
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add e2e/tests/workflow.spec.ts
git commit -m "test: add comprehensive workflow e2e test"
```

---

### Task 10: Rewrite `e2e/tests/save-load.spec.ts` — comprehensive roundtrip

**Files:**
- Modify: `e2e/tests/save-load.spec.ts`

- [ ] **Step 1: Rewrite with comprehensive roundtrip**

Replace the entire contents of `e2e/tests/save-load.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { setRoomDimensions, getRoomDimension } from '../helpers/room';
import {
  addLampFromPreset, lampCount,
  addLampWithType, uploadLampIes, uploadLampSpectrum, setLampWavelength,
} from '../helpers/lamps';
import { addZone, switchZoneType, zoneCount } from '../helpers/zones';
import {
  enableReflections, isReflectionsEnabled,
  openReflectanceModal, closeReflectanceModal,
  setSurfaceReflectance, getSurfaceReflectance,
} from '../helpers/reflections';
import path from 'path';

const IES_FIXTURE = path.resolve(__dirname, '../fixtures/test-lamp.ies');
const SPECTRUM_FIXTURE = path.resolve(__dirname, '../fixtures/test-spectrum.csv');

test.describe('Save and load project', () => {
  test('comprehensive round-trip: multiple lamp types, zone types, reflections', async ({ page }) => {
    test.setTimeout(120_000);
    await waitForSession(page);

    // --- Room ---
    await setRoomDimensions(page, { x: 6, y: 4, z: 3 });
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'X'))).toBe(6);

    // --- Lamp 1: 222nm preset ---
    await addLampFromPreset(page);

    // Collapse editor before adding next lamp
    await page.locator('.inline-editor .close-x').click();

    // --- Lamp 2: 222nm custom (IES upload, no preset) ---
    await addLampWithType(page, 'krcl_222');
    // Don't select a preset — upload IES instead
    await uploadLampIes(page, IES_FIXTURE);
    await page.locator('.inline-editor .close-x').click();

    // --- Lamp 3: 254nm ---
    await addLampWithType(page, 'lp_254');
    await uploadLampIes(page, IES_FIXTURE);
    await page.locator('.inline-editor .close-x').click();

    // --- Lamp 4: Other with wavelength ---
    await addLampWithType(page, 'other');
    await uploadLampIes(page, IES_FIXTURE);
    await setLampWavelength(page, 265);
    await page.locator('.inline-editor .close-x').click();

    // --- Lamp 5: Other with spectrum ---
    await addLampWithType(page, 'other');
    await uploadLampIes(page, IES_FIXTURE);
    await uploadLampSpectrum(page, SPECTRUM_FIXTURE);
    await page.locator('.inline-editor .close-x').click();

    expect(await lampCount(page)).toBe(5);

    // --- Zone 1: Plane with height=1.5 ---
    await addZone(page);
    const heightInput = page.locator('#plane-height');
    await heightInput.click({ clickCount: 3 });
    await heightInput.fill('1.5');
    await heightInput.press('Tab');
    await page.locator('.inline-editor .close-x').click();

    // --- Zone 2: Volume ---
    await addZone(page);
    await switchZoneType(page, 'volume');
    await page.locator('.inline-editor .close-x').click();

    // --- Zone 3: Point with position ---
    await addZone(page);
    await switchZoneType(page, 'point');
    const posInputs = page.locator('.inline-editor .vector-row').first().locator('input');
    for (const [i, val] of [[0, '2'], [1, '3'], [2, '1']] as [number, string][]) {
      await posInputs.nth(i).click({ clickCount: 3 });
      await posInputs.nth(i).fill(val);
      await posInputs.nth(i).press('Tab');
    }
    await page.locator('.inline-editor .close-x').click();

    expect(await zoneCount(page)).toBeGreaterThanOrEqual(3);

    // --- Reflections ---
    await enableReflections(page);
    await openReflectanceModal(page);
    await setSurfaceReflectance(page, 'floor', 0.50);
    await setSurfaceReflectance(page, 'ceiling', 0.25);
    await closeReflectanceModal(page);

    // --- Save ---
    const fileMenu = page.locator('.menu-bar-item').filter({ hasText: 'File' }).locator('span[role="button"]');
    await fileMenu.click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('div[role="menuitem"]:has-text("Save")').click(),
    ]);
    const filePath = await download.path();
    expect(filePath).toBeTruthy();

    // --- Fresh page and load ---
    await page.goto('/');
    await expect(page.locator('span.status-indicator')).toBeVisible({ timeout: 15_000 });

    await page.locator('input#load-file').setInputFiles(filePath!);

    // --- Verification ---
    await expect.poll(() => lampCount(page), { timeout: 15_000 }).toBe(5);
    await expect.poll(() => zoneCount(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(3);

    // Room dimensions
    expect(parseFloat(await getRoomDimension(page, 'X'))).toBe(6);
    expect(parseFloat(await getRoomDimension(page, 'Y'))).toBe(4);
    expect(parseFloat(await getRoomDimension(page, 'Z'))).toBe(3);

    // Reflections enabled
    expect(await isReflectionsEnabled(page)).toBe(true);

    // Reflectance values
    await openReflectanceModal(page);
    expect(await getSurfaceReflectance(page, 'floor')).toBeCloseTo(0.50, 2);
    expect(await getSurfaceReflectance(page, 'ceiling')).toBeCloseTo(0.25, 2);
    await closeReflectanceModal(page);

    // No error toasts
    expect(await page.locator('.toast-container .toast').count()).toBe(0);
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add e2e/tests/save-load.spec.ts
git commit -m "test: rewrite save-load with comprehensive roundtrip (5 lamps, 3 zones, reflections)"
```

---

### Task 11: Delete obsolete test files

**Files:**
- Delete: `e2e/tests/calculate.spec.ts`
- Delete: `e2e/tests/lamps.spec.ts`
- Delete: `e2e/tests/zones.spec.ts`
- Delete: `e2e/tests/value-labels.spec.ts`
- Delete: `e2e/tests/error-states.spec.ts`

- [ ] **Step 1: Remove the files**

```bash
git rm e2e/tests/calculate.spec.ts e2e/tests/lamps.spec.ts e2e/tests/zones.spec.ts e2e/tests/value-labels.spec.ts e2e/tests/error-states.spec.ts
```

- [ ] **Step 2: Commit**

```bash
git commit -m "test: remove obsolete e2e test files subsumed by workflow and room"
```

---

### Task 12: Run tests, fix issues, final commit

- [ ] **Step 1: Start the dev servers if not running**

```bash
cd /home/jvbelenky/illuminate-v2/api && uv run uvicorn app.main:app --port 8000 &
cd /home/jvbelenky/illuminate-v2/ui && pnpm dev &
```

Wait for both to be available.

- [ ] **Step 2: Run all e2e tests**

```bash
cd /home/jvbelenky/illuminate-v2/e2e && npx playwright test --reporter=list
```

Expected: 6 test files, all passing. If any fail, diagnose from the error message and fix.

Common issues to watch for:
- **Selector not found**: The DOM may differ from what the spec documents say. Use `page.pause()` or screenshot-on-failure to inspect.
- **Timing**: Some interactions need longer waits (e.g., file uploads). Add explicit `waitForTimeout` or `expect.poll`.
- **Store not exposed**: If `window.__illuminate_store__` is not available, the copy verification tests will fail. Fix in Task 2 Step 2.
- **Modal close races**: If closing a modal races with the next interaction, add a wait for the backdrop to disappear.

- [ ] **Step 3: Fix any failures and re-run until green**

Iterate: fix the issue, re-run the specific failing test with `npx playwright test tests/FILENAME --reporter=list`, then run the full suite again.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "test: fix e2e test issues found during initial run"
```
