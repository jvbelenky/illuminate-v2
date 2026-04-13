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

  test('preset lamp: position, aim, placement and aim presets', async () => {
    test.setTimeout(120_000);

    // Add preset lamp
    await addLampFromPreset(page);
    expect(await lampCount(page)).toBe(1);
    await expect(page.locator('.item-list-item[data-lamp-id] .inline-editor').first()).toBeVisible();

    // --- Position editing ---
    const positionGroup = page.locator('.inline-editor .form-group').filter({
      hasText: 'Position'
    }).first();
    const posInputs = positionGroup.locator('.vector-row input');
    for (const [i, val] of [[0, '2'], [1, '3'], [2, '2.5']] as [number, string][]) {
      await posInputs.nth(i).click({ clickCount: 3 });
      await posInputs.nth(i).fill(val);
      await posInputs.nth(i).press('Tab');
    }

    // --- Aim point editing ---
    const aimGroup = page.locator('.inline-editor .form-group').filter({
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
      hasText: 'Aim Point'
    }).first()).toBeVisible();

    // Close the editor
    await page.locator('.inline-editor .close-x').click();
  });

  test('preset lamp: toggles and advanced settings', async () => {
    test.setTimeout(120_000);

    // Re-open the lamp editor
    await selectLamp(page, 0);

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
    await dirInputs.nth(0).click({ clickCount: 3 });
    await dirInputs.nth(0).fill('0');
    await dirInputs.nth(0).press('Tab');
    await dirInputs.nth(1).click({ clickCount: 3 });
    await dirInputs.nth(1).fill('1');
    await dirInputs.nth(1).press('Tab');
    await dirInputs.nth(2).click({ clickCount: 3 });
    await dirInputs.nth(2).fill('0');
    await dirInputs.nth(2).press('Tab');

    // Eye (Target)
    await setCalcMode(page, 'Eye (Target)');

    // Custom — verify custom flag checkboxes
    await setCalcMode(page, 'Custom');
    const customFlags = page.locator('.inline-editor label.toggle-row input[type="checkbox"]');
    const flagCount = await customFlags.count();
    for (let i = 0; i < flagCount; i++) {
      const cb = customFlags.nth(i);
      const checked = await cb.isChecked();
      if (checked) await cb.uncheck(); else await cb.check();
    }

    // Set back to Fluence Rate for later use
    await setCalcMode(page, 'Fluence Rate');

    // --- Reference surface ---
    await setRefSurface(page, 'XZ');
    await expect(page.locator('.inline-editor label:text-is("Z Range")')).toBeVisible();
    await setRefSurface(page, 'YZ');
    await expect(page.locator('.inline-editor label:text-is("Y Range")')).toBeVisible();
    await setRefSurface(page, 'XY');

    // --- Grid resolution ---
    await toggleResolutionMode(page);
    const gridInputs = page.locator('.inline-editor .grid-inputs .grid-input input');
    await gridInputs.first().click({ clickCount: 3 });
    await gridInputs.first().fill('0.5');
    await gridInputs.first().press('Tab');
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

    const copy = lamps[lamps.length - 1];
    const original = lamps[0];
    assertObjectsMatch(original, copy, ['id', 'name']);
  });

  test('cleanup, standard zones, calculation, display settings', async () => {
    test.setTimeout(60_000);

    // Delete copied zones (from end)
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
      await viewMenu.click();
      await gridToggle.click();
    } else {
      await page.keyboard.press('Escape');
    }
  });
});
