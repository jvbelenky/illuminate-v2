import { test, expect, type Page } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import {
  addLampFromPreset, lampCount, removeLamp, selectLamp, copyLamp,
  clickPlacementPreset, openLampFold,
  openAdvancedSettings, selectAdvancedTab, closeAdvancedSettings,
  addLampWithType, createCustomLamp, openFixtureAdvanced, lampEditor,
} from '../helpers/lamps';
import {
  addZone, setCalcMode, zoneCount, selectZone, zoneEditor, closeZone, openZoneFold, gridInputs,
  copyZone, removeZone, toggleResolutionMode,
  toggleOffset, setDisplayMode, setDose, disableDose, openStandardZones,
} from '../helpers/zones';
import { calculate, waitForResults } from '../helpers/calculations';
import { getZonesFromBackend, getLampsFromStore, assertObjectsMatch } from '../helpers/api';
import { waitForApiIdle } from '../helpers/network';
import { openStep } from '../helpers/workspace';
import { attachErrorGuard, type ErrorGuard } from '../helpers/errors';
import path from 'path';

const IES_FIXTURE = path.resolve(__dirname, '../fixtures/test-lamp.ies');
const WALL_IES_FIXTURE = path.resolve(__dirname, '../fixtures/wall-lamp.ies');
// 181 x 73 angle grid (13k web vertices), shaped like a UV-Flow four-way sheet
const DENSE_IES_FIXTURE = path.resolve(__dirname, '../fixtures/dense-grid-4way.ies');

/** The user's zones from the store, in order. */
async function userZones(page: Page): Promise<Record<string, any>[]> {
  return page.evaluate(() => JSON.parse(JSON.stringify((window as any).__illuminate_store__.zones)).filter((z: any) => !z.isStandard));
}

test.describe.serial('Comprehensive workflow', () => {
  let page: Page;
  let errorGuard: ErrorGuard;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    errorGuard = attachErrorGuard(page);
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

  test('preset lamp: dimmer, placements, position, aim, tilt and orientation', async () => {
    // Add preset lamp
    await addLampFromPreset(page);
    await expect.poll(() => lampCount(page)).toBe(1);
    await expect(page.locator('.lamps-part .editor-row.open .row-body').first()).toBeVisible();
    const editor = lampEditor(page);

    // --- Dimmer ---
    const dimmerBox = editor.getByLabel('Dimmer percent');
    await dimmerBox.fill('60');
    await dimmerBox.press('Tab');
    await expect.poll(async () => (await getLampsFromStore(page))[0].scaling_factor).toBe(0.6);

    // --- Placements ---
    await clickPlacementPreset(page, 'Downlight');
    await clickPlacementPreset(page, 'Corner');
    await clickPlacementPreset(page, 'Upper-room');

    // --- Geometry: position and aim point ---
    await openLampFold(page, 'Geometry');
    const rows = editor.locator('.vector-row');
    const posInputs = rows.nth(0).locator('input');
    for (const [i, val] of [[0, '2'], [1, '3'], [2, '2.5']] as [number, string][]) {
      await posInputs.nth(i).click({ clickCount: 3 });
      await posInputs.nth(i).fill(val);
      await posInputs.nth(i).press('Tab');
    }
    // Typed X, Y, Z: at Y the aim sits on the lamp, which is held back until Z completes it
    const aimInputs = rows.nth(1).locator('input');
    for (const [i, val] of [[0, '2'], [1, '3'], [2, '0']] as [number, string][]) {
      await aimInputs.nth(i).click({ clickCount: 3 });
      await aimInputs.nth(i).fill(val);
      await aimInputs.nth(i).press('Tab');
    }
    await expect.poll(async () => {
      const l = (await getLampsFromStore(page))[0];
      return [l.x, l.y, l.z, l.aimx, l.aimy, l.aimz];
    }).toEqual([2, 3, 2.5, 2, 3, 0]);

    // --- Tilt and orientation, always shown beside the aim point ---
    const tilt = editor.getByLabel(/^Tilt/);
    await tilt.click({ clickCount: 3 });
    await tilt.fill('30');
    await tilt.press('Tab');
    const orientation = editor.getByLabel(/^Orientation/);
    await orientation.click({ clickCount: 3 });
    await orientation.fill('45');
    await orientation.press('Tab');
    // Tilted 30° towards 45°, the aim moves off the point under the lamp
    await expect.poll(async () => {
      const l = (await getLampsFromStore(page))[0];
      return [l.aimx > 2, l.aimy > 3, l.aimz];
    }).toEqual([true, true, 0]);

    // Close the editor
    await page.locator('.editor-row.open .close-x').click();
  });

  test('preset lamp: toggles and advanced settings', async () => {
    // Re-open the lamp editor
    await selectLamp(page, 0);

    // --- Toggles ---
    await openLampFold(page, 'Display');
    const showLabel = lampEditor(page).getByLabel('Show label');
    await showLabel.check();
    await expect(showLabel).toBeChecked();

    const showWeb = lampEditor(page).getByLabel('Show photometric web in 3D');
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

  test('plane zone: calc modes, height and flip', async () => {
    await addZone(page);
    await expect.poll(() => zoneCount(page)).toBe(1);

    // Height above the floor
    const heightInput = zoneEditor(page).getByLabel(/^Height/);
    await heightInput.click({ clickCount: 3 });
    await heightInput.fill('1.5');
    await heightInput.press('Tab');
    await expect.poll(async () => (await userZones(page))[0].height).toBe(1.5);

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

    // Eye (Directional) shows its view direction; Eye (Target) its target
    await setCalcMode(page, 'Eye (Directional)');
    await expect(zoneEditor(page).getByRole('group', { name: 'View direction' })).toBeVisible();
    await setCalcMode(page, 'Eye (Target)');
    await expect(zoneEditor(page).getByRole('group', { name: 'Target' })).toBeVisible();

    // Custom
    await setCalcMode(page, 'Custom');

    // Set back to Fluence Rate for later use
    await setCalcMode(page, 'Fluence Rate');

    // --- Flip turns the normal round ---
    const before = (await userZones(page))[0].direction ?? 1;
    await zoneEditor(page).getByRole('button', { name: 'Flip' }).click();
    await expect.poll(async () => (await userZones(page))[0].direction).toBe(-before);
    await waitForApiIdle(page);
  });

  test('plane zone: grid, offset, bounds, display, dose', async () => {
    // --- Grid resolution ---
    await toggleResolutionMode(page);
    await gridInputs(page).first().click({ clickCount: 3 });
    await gridInputs(page).first().fill('0.5');
    await gridInputs(page).first().press('Tab');
    await toggleResolutionMode(page);
    await gridInputs(page).first().click({ clickCount: 3 });
    await gridInputs(page).first().fill('10');
    await gridInputs(page).first().press('Tab');
    await expect(zoneEditor(page).locator('button.ep-disc').filter({ hasText: /^\s*Grid points/ })).toContainText('10 ×');

    // --- Offset ---
    await toggleOffset(page);

    // --- Bounds --- (a new zone covers the whole room; give it its own extent instead)
    await openZoneFold(page, 'Geometry');
    const x2 = zoneEditor(page).getByLabel('x2', { exact: true });
    await x2.click({ clickCount: 3 });
    await x2.fill('3');
    await x2.press('Tab');
    await expect.poll(async () => (await userZones(page))[0].fit_room).toBe(false);
    await expect.poll(async () => (await userZones(page))[0].x2).toBe(3);
    const fit = zoneEditor(page).getByRole('switch', { name: 'Fit to room' });
    await expect(fit).not.toBeChecked();

    // --- Fit to room puts it back ---
    await fit.click();
    await expect.poll(async () => (await userZones(page))[0].fit_room).toBe(true);
    await expect(fit).toBeChecked();

    // --- Display mode ---
    await setDisplayMode(page, 'Numeric');
    await setDisplayMode(page, 'Markers');
    await setDisplayMode(page, 'Heatmap');

    // --- Dose ---
    await setDose(page, 1, 30, 0);
    await disableDose(page);

    await closeZone(page);
  });

  test('volume zone: bounds, grid, offset, display', async () => {
    await addZone(page, 'volume');
    await expect.poll(() => zoneCount(page)).toBe(2);

    // Bottom and top (a new volume fills the room, floor to ceiling)
    for (const [label, value] of [[/^Bottom/, '0.5'], [/^Top/, '2']] as [RegExp, string][]) {
      const input = zoneEditor(page).getByLabel(label);
      await input.click({ clickCount: 3 });
      await input.fill(value);
      await input.press('Tab');
    }
    await expect.poll(async () => {
      const v = (await userZones(page))[1];
      return [v.z_min, v.z_max];
    }).toEqual([0.5, 2]);

    // Footprint
    await openZoneFold(page, 'Geometry');
    const x2 = zoneEditor(page).getByLabel('x2', { exact: true });
    await x2.click({ clickCount: 3 });
    await x2.fill('3');
    await x2.press('Tab');
    await expect.poll(async () => (await userZones(page))[1].x_max).toBe(3);

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

    await closeZone(page);
  });

  test('point zone: position, aim, advanced flags, FOV, label', async () => {
    await addZone(page, 'point');
    await expect.poll(() => zoneCount(page)).toBe(3);

    // Set position
    const posInputs = zoneEditor(page).getByRole('group', { name: /^Position/ }).locator('input');
    for (const [i, val] of [[0, '2'], [1, '3'], [2, '1']] as [number, string][]) {
      await posInputs.nth(i).click({ clickCount: 3 });
      await posInputs.nth(i).fill(val);
      await posInputs.nth(i).press('Tab');
    }

    // Set aim point
    const aimInputs = zoneEditor(page).getByRole('group', { name: /^Aim at/ }).locator('input');
    for (const [i, val] of [[0, '2'], [1, '3'], [2, '0']] as [number, string][]) {
      await aimInputs.nth(i).click({ clickCount: 3 });
      await aimInputs.nth(i).fill(val);
      await aimInputs.nth(i).press('Tab');
    }
    await expect.poll(async () => {
      const p = (await userZones(page))[2];
      return [p.x, p.y, p.z, p.aim_x, p.aim_y, p.aim_z];
    }).toEqual([2, 3, 1, 2, 3, 0]);

    // Advanced: toggle the custom flags, set the FOV
    await openZoneFold(page, 'Advanced');
    const flags = zoneEditor(page).locator('.fold-body .ep-check input[type="checkbox"]');
    const flagCount = await flags.count();
    expect(flagCount).toBe(3);
    for (let i = 0; i < flagCount; i++) {
      const cb = flags.nth(i);
      if (await cb.isChecked()) await cb.uncheck(); else await cb.check();
    }
    for (const [id, val] of [['point-fov-vert', '80'], ['point-fov-horiz', '120']]) {
      const input = page.locator(`#${id}`);
      await input.click({ clickCount: 3 });
      await input.fill(val);
      await input.press('Tab');
    }

    // Show label
    await openZoneFold(page, 'Display');
    const showLabel = zoneEditor(page).getByLabel('Show label');
    await showLabel.check();
    await expect(showLabel).toBeChecked();

    await closeZone(page);
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
    // The ribbon's Copy offsets the copy, and its aim with it, by one step in x and y
    // (tilt and orientation are recomputed for the moved copy, whose position is rounded to 6 places)
    assertObjectsMatch(original, copy, ['id', 'name', 'x', 'y', 'aimx', 'aimy', 'tilt', 'orientation']);
    expect(copy.tilt).toBeCloseTo(original.tilt, 3);
    expect(copy.orientation).toBeCloseTo(original.orientation, 3);
    const dx = copy.x - original.x;
    expect(dx).toBeGreaterThan(0);
    expect(copy.y - original.y).toBeCloseTo(dx, 6);
    expect(copy.aimx - original.aimx).toBeCloseTo(dx, 6);
    expect(copy.aimy - original.aimy).toBeCloseTo(dx, 6);
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
    await openStandardZones(page);
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
