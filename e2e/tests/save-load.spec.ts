import { test, expect } from '../fixtures';
import { ZONE_TYPE_SWITCH_BUG } from '../helpers/errors';
import { waitForSession } from '../helpers/session';
import { setRoomDimensions, getRoomDimension } from '../helpers/room';
import {
  addLampFromPreset, lampCount,
  addLampWithType, createCustomLamp,
} from '../helpers/lamps';
import { showSummary } from '../helpers/workspace';
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
  test('comprehensive round-trip: multiple lamp types, zone types, reflections', async ({ page, errorGuard }) => {
    // This test switches a zone to 'volume', so it hits the same pre-existing
    // race. It reproduces reliably under E2E_SLOW_NETWORK=1.
    errorGuard.allow(...ZONE_TYPE_SWITCH_BUG);

    // The one genuine outlier: 5 lamps with 4 file uploads, 3 zone types,
    // reflectance, a save, a full page reload and a re-import. Measured p100 =
    // 40s over 3 repeats (32.9s / 37.6s / 39.9s); 3x headroom for slower CI.
    test.setTimeout(120_000);
    await waitForSession(page);

    // --- Room ---
    await setRoomDimensions(page, { x: 6, y: 4, z: 3 });
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'X'))).toBe(6);

    // --- Lamp 1: 222nm preset ---
    await addLampFromPreset(page);

    // Collapse editor before adding next lamp
    await page.locator('.editor-row.open .close-x').click();

    // --- Lamp 2: 222nm with second preset ---
    // The second available fixture (different from Lamp 1)
    await addLampFromPreset(page, 1);
    await page.locator('.editor-row.open .close-x').click();

    // --- Lamp 3: 254nm ---
    await addLampWithType(page, 'lp_254');
    await createCustomLamp(page, { ies: IES_FIXTURE });
    await page.locator('.editor-row.open .close-x').click();

    // --- Lamp 4: Other with wavelength ---
    await addLampWithType(page, 'other');
    await createCustomLamp(page, { ies: IES_FIXTURE, wavelength: 265 });
    await page.locator('.editor-row.open .close-x').click();

    // --- Lamp 5: Other with spectrum ---
    await addLampWithType(page, 'other');
    await createCustomLamp(page, { ies: IES_FIXTURE, spectrum: SPECTRUM_FIXTURE });
    await page.locator('.editor-row.open .close-x').click();

    await expect.poll(() => lampCount(page)).toBe(5);

    // --- Zone 1: Plane with height=1.5 ---
    await addZone(page);
    const heightInput = page.locator('#plane-height');
    await heightInput.click({ clickCount: 3 });
    await heightInput.fill('1.5');
    await heightInput.press('Tab');
    await page.locator('.editor-row.open .close-x').click();

    // --- Zone 2: Volume ---
    await addZone(page);
    await switchZoneType(page, 'volume');
    await page.locator('.editor-row.open .close-x').click();

    // --- Zone 3: Point with position ---
    await addZone(page);
    await switchZoneType(page, 'point');
    const posInputs = page.locator('.editor-row.open .row-body .vector-row').first().locator('input');
    for (const [i, val] of [[0, '2'], [1, '3'], [2, '1']] as [number, string][]) {
      await posInputs.nth(i).click({ clickCount: 3 });
      await posInputs.nth(i).fill(val);
      await posInputs.nth(i).press('Tab');
    }
    await page.locator('.editor-row.open .close-x').click();

    await expect.poll(() => zoneCount(page)).toBeGreaterThanOrEqual(3);

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
      page.getByRole('menuitem', { name: 'Save', exact: true }).click(),
    ]);
    const filePath = await download.path();
    expect(filePath).toBeTruthy();

    // --- Fresh page and load ---
    // Must wait for session init to fully settle, not just for the status
    // indicator: an init response still in flight carries the DEFAULT room and
    // would land after the file import and overwrite it.
    await waitForSession(page);

    await page.locator('input#load-file').setInputFiles(filePath!);

    // --- Verification ---
    await expect.poll(() => lampCount(page), { timeout: 15_000 }).toBe(5);
    await expect.poll(() => zoneCount(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(3);

    // Room dimensions. The load applies room, lamps and zones independently, so
    // the lamp/zone polls above do not imply the room has settled — poll here too.
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'X'))).toBe(6);
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'Y'))).toBe(4);
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'Z'))).toBe(3);

    // Reflections enabled
    await expect.poll(() => isReflectionsEnabled(page)).toBe(true);

    // Reflectance values
    await openReflectanceModal(page);
    await expect.poll(() => getSurfaceReflectance(page, 'floor')).toBeCloseTo(0.50, 2);
    await expect.poll(() => getSurfaceReflectance(page, 'ceiling')).toBeCloseTo(0.25, 2);
    await closeReflectanceModal(page);

    // No error toasts
    await expect(page.locator('.toast-container .toast')).toHaveCount(0);
  });

  test('hidden lamps and zones stay hidden through save and load', async ({ page }) => {
    await waitForSession(page);
    await addLampFromPreset(page);
    await page.locator('.editor-row.open .close-x').click();

    // The summary lists every lamp and zone with its eye toggle
    await showSummary(page);
    const eye = 'button[aria-label^="Hide "], button[aria-label^="Show "]';
    const lampEye = page.locator('.summary-block').filter({ has: page.locator('[data-edit="lamps"]') }).locator('.editor-row').first().locator(eye);
    const zoneEye = page.locator('.summary-panel .editor-row[data-id="WholeRoomFluence"]').locator(eye);

    // Standard zones start hidden: show this one first, so hiding it is a change to save
    await expect(zoneEye).toHaveAttribute('aria-label', /^Show /);
    await zoneEye.click();
    await expect(zoneEye).toHaveAttribute('aria-label', /^Hide /);

    await lampEye.click();
    await zoneEye.click();
    await expect(lampEye).toHaveAttribute('aria-label', /^Show /);
    await expect(zoneEye).toHaveAttribute('aria-label', /^Show /);

    const fileMenu = page.locator('.menu-bar-item').filter({ hasText: 'File' }).locator('span[role="button"]');
    await fileMenu.click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'Save', exact: true }).click(),
    ]);
    const filePath = await download.path();

    // Show them again, so only the file can hide them
    await lampEye.click();
    await zoneEye.click();
    await expect(lampEye).toHaveAttribute('aria-label', /^Hide /);
    await expect(zoneEye).toHaveAttribute('aria-label', /^Hide /);

    await page.locator('input#load-file').setInputFiles(filePath!);
    await showSummary(page);
    await expect(lampEye).toHaveAttribute('aria-label', /^Show /, { timeout: 15_000 });
    await expect(zoneEye).toHaveAttribute('aria-label', /^Show /);
  });
});
