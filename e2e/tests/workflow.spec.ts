import { test, expect, type Page } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import {
  addLampFromPreset, lampCount, removeLamp, selectLamp, copyLamp,
  clickPlacementPreset, clickAimPreset, toggleTiltMode,
  openAdvancedSettings, selectAdvancedTab, closeAdvancedSettings,
  addLampWithType, createCustomLamp, openFixtureAdvanced,
} from '../helpers/lamps';
import {
  addZone, switchZoneType, setCalcMode, zoneCount, selectZone,
  copyZone, removeZone, setRefSurface, toggleResolutionMode,
  toggleOffset, setDisplayMode, setDose, disableDose,
} from '../helpers/zones';
import { calculate, waitForResults } from '../helpers/calculations';
import { getZonesFromBackend, getLampsFromStore, assertObjectsMatch } from '../helpers/api';
import { waitForApiIdle } from '../helpers/network';
import { openStep } from '../helpers/workspace';
import { attachErrorGuard, ZONE_TYPE_SWITCH_BUG, LAMP_TYPE_SWITCH_NO_IES, type ErrorGuard } from '../helpers/errors';
import path from 'path';

const IES_FIXTURE = path.resolve(__dirname, '../fixtures/test-lamp.ies');
const WALL_IES_FIXTURE = path.resolve(__dirname, '../fixtures/wall-lamp.ies');
// 181 x 73 angle grid (13k web vertices), shaped like a UV-Flow four-way sheet
const DENSE_IES_FIXTURE = path.resolve(__dirname, '../fixtures/dense-grid-4way.ies');

test.describe.serial('Comprehensive workflow', () => {
  let page: Page;
  let errorGuard: ErrorGuard;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    errorGuard = attachErrorGuard(page);
    // See LAMP_TYPE_SWITCH_NO_IES — addLampWithType switches a preset lamp's type.
    errorGuard.allow(...LAMP_TYPE_SWITCH_NO_IES);
    await waitForSession(page);
  });

  // The page is shared across this serial block, so assert per-test to pin an
  // error on the test that caused it rather than on whichever ran last.
  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) errorGuard.assertClean();
    else errorGuard.drain();
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('preset lamp: position, aim, placement and aim presets', async () => {
    // Add preset lamp
    await addLampFromPreset(page);
    await expect.poll(() => lampCount(page)).toBe(1);
    await expect(page.locator('.lamps-part .editor-row.open .row-body').first()).toBeVisible();

    // --- Position editing ---
    const positionGroup = page.locator('.editor-row.open .row-body .form-group').filter({
      hasText: 'Position'
    }).first();
    const posInputs = positionGroup.locator('.vector-row input');
    for (const [i, val] of [[0, '2'], [1, '3'], [2, '2.5']] as [number, string][]) {
      await posInputs.nth(i).click({ clickCount: 3 });
      await posInputs.nth(i).fill(val);
      await posInputs.nth(i).press('Tab');
    }

    // --- Aim point editing ---
    const aimGroup = page.locator('.editor-row.open .row-body .form-group').filter({
      hasText: 'Aim Point'
    }).first();
    const aimInputs = aimGroup.locator('.vector-row input');
    for (const [i, val] of [[0, '2'], [1, '3'], [2, '0']] as [number, string][]) {
      await aimInputs.nth(i).click({ clickCount: 3 });
      await aimInputs.nth(i).fill(val);
      await aimInputs.nth(i).press('Tab');
    }

    // --- Placement presets ---
    await clickPlacementPreset(page, 'Downlight');
    await clickPlacementPreset(page, 'Corner');

    // --- Aim presets ---
    await clickAimPreset(page, 'Down');
    await clickAimPreset(page, 'Corner');

    // --- Tilt/Orientation mode ---
    await toggleTiltMode(page);
    // Verify tilt inputs appear
    const tiltLabel = page.locator('.editor-row.open .row-body label, .editor-row.open .row-body .section-label').filter({ hasText: 'Tilt / Orientation' });
    await expect(tiltLabel).toBeVisible();
    // Set tilt and orientation values
    const tiltInputs = page.locator('.editor-row.open .row-body .form-row input[inputmode="decimal"]');
    await tiltInputs.first().click({ clickCount: 3 });
    await tiltInputs.first().fill('30');
    await tiltInputs.first().press('Tab');
    await tiltInputs.nth(1).click({ clickCount: 3 });
    await tiltInputs.nth(1).fill('45');
    await tiltInputs.nth(1).press('Tab');

    // Switch back to aim-point mode
    await toggleTiltMode(page);
    await expect(page.locator('.editor-row.open .row-body .form-group').filter({
      hasText: 'Aim Point'
    }).first()).toBeVisible();

    // Close the editor
    await page.locator('.editor-row.open .close-x').click();
  });

  test('preset lamp: toggles and advanced settings', async () => {
    // Re-open the lamp editor
    await selectLamp(page, 0);

    // --- Toggles ---
    const showLabel = page.locator('.editor-row.open .row-body label.toggle-row').filter({ hasText: 'Show Label' }).locator('input[type="checkbox"]');
    await showLabel.check();
    await expect(showLabel).toBeChecked();

    const showWeb = page.locator('.editor-row.open .row-body label.toggle-row').filter({ hasText: 'Show Photometric Web' }).locator('input[type="checkbox"]');
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
    const lampItem = page.locator('.lamps-part .editor-row').first();
    const toggleBtn = lampItem.locator('button.icon-toggle[aria-label*="Exclude"], button.icon-toggle[aria-label*="Include"]');
    await toggleBtn.click();
    await expect(lampItem).toHaveClass(/\boff\b/);
    await toggleBtn.click();
    await expect(lampItem).not.toHaveClass(/\boff\b/);

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
    await page.locator('.editor-row.open .close-x').click();
  });

  test('custom lamp: file upload, wavelength, placement, advanced settings', async () => {
    await addLampWithType(page, 'other');
    await expect.poll(() => lampCount(page)).toBe(2);

    // Build a custom lamp definition (IES + wavelength) and apply it
    await createCustomLamp(page, { ies: IES_FIXTURE, wavelength: 265 });

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
    await page.locator('.editor-row.open .close-x').click();
  });

  test('plane zone: calc modes and reference surfaces', async () => {
    await addZone(page);
    await expect.poll(() => zoneCount(page)).toBe(1);

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

    // Eye (Directional) — just verify the mode sets successfully
    await setCalcMode(page, 'Eye (Directional)');

    // Eye (Target)
    await setCalcMode(page, 'Eye (Target)');

    // Custom
    await setCalcMode(page, 'Custom');

    // Set back to Fluence Rate for later use
    await setCalcMode(page, 'Fluence Rate');

    // --- Reference surface ---
    await setRefSurface(page, 'XZ');
    await expect(page.locator('.editor-row.open .row-body label:text-is("Z Range")')).toBeVisible();
    await setRefSurface(page, 'YZ');
    await expect(page.locator('.editor-row.open .row-body label:text-is("Y Range")')).toBeVisible();
    await setRefSurface(page, 'XY');
  });

  test('plane zone: grid, offset, bounds, display, dose', async () => {
    // --- Grid resolution ---
    await toggleResolutionMode(page);
    const gridInputs = page.locator('.editor-row.open .row-body .grid-inputs .grid-input input');
    await gridInputs.first().click({ clickCount: 3 });
    await gridInputs.first().fill('0.5');
    await gridInputs.first().press('Tab');
    await toggleResolutionMode(page);
    await gridInputs.first().click({ clickCount: 3 });
    await gridInputs.first().fill('10');
    await gridInputs.first().press('Tab');

    // --- Offset ---
    await toggleOffset(page);

    // --- Bounds --- (a new zone covers the whole room; set its own extent instead)
    await page.locator('.editor-row.open .row-body').getByLabel('Whole room').uncheck();
    const rangeRows = page.locator('.editor-row.open .row-body .range-row');
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
    await page.locator('.editor-row.open .close-x').click();
  });

  test('volume zone: bounds, grid, offset, display', async () => {
    // See ZONE_TYPE_SWITCH_BUG — pre-existing 404/400 when a zone changes type.
    errorGuard.allow(...ZONE_TYPE_SWITCH_BUG);

    await addZone(page);
    await switchZoneType(page, 'volume');
    await expect.poll(() => zoneCount(page)).toBe(2);

    // Edit bounds (a new zone covers the whole room, floor to ceiling)
    await page.locator('.editor-row.open .row-body').getByLabel('Whole room').uncheck();
    await page.locator('.editor-row.open .row-body').getByLabel('Floor to ceiling').uncheck();
    const rangeRows = page.locator('.editor-row.open .row-body .range-row');
    await expect(rangeRows).toHaveCount(3);
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

    // Display modes (skip Numeric — disabled for volumes with >1000 grid points)
    // Volume zones use "Iso" instead of "Heatmap" for the isosurface display
    await setDisplayMode(page, 'Markers');
    await setDisplayMode(page, 'None');
    await setDisplayMode(page, 'Iso');

    // Dose
    await setDose(page, 0, 15, 0);
    await disableDose(page);

    // Collapse editor
    await page.locator('.editor-row.open .close-x').click();
  });

  test('point zone: position, aim, advanced flags, FOV, label', async () => {
    await addZone(page);
    await switchZoneType(page, 'point');
    await expect.poll(() => zoneCount(page)).toBe(3);

    // Set position
    const posInputs = page.locator('.editor-row.open .row-body .vector-row').first().locator('input');
    for (const [i, val] of [[0, '2'], [1, '3'], [2, '1']] as [number, string][]) {
      await posInputs.nth(i).click({ clickCount: 3 });
      await posInputs.nth(i).fill(val);
      await posInputs.nth(i).press('Tab');
    }

    // Set aim point
    const aimInputs = page.locator('.editor-row.open .row-body .vector-row').nth(1).locator('input');
    for (const [i, val] of [[0, '2'], [1, '3'], [2, '0']] as [number, string][]) {
      await aimInputs.nth(i).click({ clickCount: 3 });
      await aimInputs.nth(i).fill(val);
      await aimInputs.nth(i).press('Tab');
    }

    // Expand Advanced section
    const advancedToggle = page.locator('.editor-row.open .row-body .iso-toggle').filter({ hasText: 'Advanced' });
    await advancedToggle.click();

    // Toggle custom flags
    const flags = page.locator('.editor-row.open .row-body .toggle-row input[type="checkbox"]');
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
    const showLabel = page.locator('.editor-row.open .row-body label.toggle-row').filter({ hasText: 'Show Label' }).locator('input[type="checkbox"]');
    if (await showLabel.isVisible()) {
      await showLabel.check();
      await expect(showLabel).toBeChecked();
    }

    // Collapse editor
    await page.locator('.editor-row.open .close-x').click();
  });

  test('copy verification: all zone types', async () => {
    // Copy plane zone (index 0)
    await selectZone(page, 0);
    await copyZone(page);
    await expect.poll(() => zoneCount(page)).toBe(4);

    // Copy volume zone (index 1)
    await selectZone(page, 1);
    await copyZone(page);
    await expect.poll(() => zoneCount(page)).toBe(5);

    // Copy point zone (index 2)
    await selectZone(page, 2);
    await copyZone(page);
    await expect.poll(() => zoneCount(page)).toBe(6);

    // Verify backend state
    const zones = await getZonesFromBackend(page);
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
    await expect.poll(() => lampCount(page)).toBe(3);

    // Verify frontend store state
    const lamps = await getLampsFromStore(page);
    expect(lamps.length).toBe(3);

    const copy = lamps[lamps.length - 1];
    const original = lamps[0];
    assertObjectsMatch(original, copy, ['id', 'name']);
  });

  test('cleanup, standard zones, calculation, display settings', async () => {
    // Delete copied zones (from end)
    for (let i = 0; i < 3; i++) {
      await removeZone(page, await zoneCount(page) - 1);
    }
    await expect.poll(() => zoneCount(page)).toBe(3);

    // Delete copied lamp (last one)
    await removeLamp(page, await lampCount(page) - 1);
    await expect.poll(() => lampCount(page)).toBe(2);

    // Toggle a standard zone. Standard zones are always present, so assert the
    // toggle's effect rather than guarding on isVisible() — the old guard let
    // this block silently do nothing.
    await openStep(page, 'zones');
    const standardZone = page.locator('.zones-part .editor-row[data-id="WholeRoomFluence"]');
    await expect(standardZone).toBeVisible();
    // Select the enable/disable toggle by aria-label. `.icon-toggle` first() is
    // the eye (show/hide) button, which does not affect calc-disabled — the old
    // no-op assertion was clicking the wrong control entirely.
    const stdToggle = standardZone.locator(
      'button.icon-toggle[aria-label*="Exclude"], button.icon-toggle[aria-label*="Include"]'
    );
    await stdToggle.click();
    await expect(standardZone).toHaveClass(/\boff\b/);
    await stdToggle.click();
    await expect(standardZone).not.toHaveClass(/\boff\b/);

    // Collapse any open editors
    const closeBtn = page.locator('.editor-row.open .close-x');
    if (await closeBtn.isVisible()) await closeBtn.click();

    // Calculate
    await calculate(page);
    await waitForResults(page);

    // Verify results
    const statLabels = page.locator('.stat-label');
    expect(await statLabels.count()).toBeGreaterThan(0);
    await expect(page.locator('text=Last calculated:')).toBeVisible();

    // Verify View menu opens and has items
    const viewMenu = page.locator('.menu-bar-item').filter({ hasText: 'View' }).locator('span[role="button"]');
    await viewMenu.click();
    await expect(page.locator('div[role="menuitem"]').first()).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
  });
  test('wall-mounted custom lamp: picker detects Sideways toward 0°, lamp is placed aiming horizontally', async () => {
    await addLampWithType(page, 'lp_254');

    await page.locator('select#preset').selectOption('__add_custom__');
    const form = page.locator('.lamp-form');
    await expect(form).toBeVisible({ timeout: 15_000 });
    await form.locator('#ies-file-input').setInputFiles(WALL_IES_FIXTURE);
    await form.locator('[data-facet-open="fixture"]').click({ timeout: 15_000 });
    const suggested = form.locator('.mount-btn[data-group="wall"]');
    await expect(suggested).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
    await expect(suggested).toContainText('Detected from file');
    // the file's 0 deg horizontal angle points into the room
    await openFixtureAdvanced(form);
    await expect(form.locator('#room-direction')).toHaveValue('horizontal_0');
    await form.getByRole('button', { name: '‹ Back' }).click();
    await form.locator('.form-actions button.primary').click();
    await expect(form).not.toBeVisible({ timeout: 15_000 });
    await waitForApiIdle(page);

    await expect.poll(async () => {
      const lamps = await getLampsFromStore(page);
      const wall = lamps[lamps.length - 1];
      return wall.photometric_axis === 'horizontal_0' && Math.abs(wall.aimz - wall.z) < 1e-6 ? 'placed' : JSON.stringify(wall);
    }, { timeout: 15_000 }).toBe('placed');
    const lamps = await getLampsFromStore(page);
    const wall = lamps[lamps.length - 1];
    expect(Math.hypot(wall.aimx - wall.x, wall.aimy - wall.y)).toBeGreaterThan(0.5);
  });

  test('dense-grid IES: orientation picker resolves without freezing the page', async () => {
    await addLampWithType(page, 'lp_254');

    await page.locator('select#preset').selectOption('__add_custom__');
    const form = page.locator('.lamp-form');
    await expect(form).toBeVisible({ timeout: 15_000 });
    await form.locator('#ies-file-input').setInputFiles(DENSE_IES_FIXTURE);
    await form.locator('[data-facet-open="fixture"]').click({ timeout: 15_000 });
    // A deep-$state analysis made the scene's vertex loop quadratic and hung
    // the main thread for minutes on grids this size.
    const down = form.locator('.mount-btn[data-group="ceiling"]');
    await expect(down).toContainText('Detected from file', { timeout: 15_000 });
    await expect(down).toHaveAttribute('aria-pressed', 'true');
    await form.getByRole('button', { name: '‹ Back' }).click();
    await form.locator('.form-actions button.primary').click();
    await expect(form).not.toBeVisible({ timeout: 15_000 });
    await waitForApiIdle(page);
  });
});
