import { test, expect } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { setRoomDimensions, getRoomDimension } from '../helpers/room';
import { addLampFromPreset, lampCount } from '../helpers/lamps';
import { addZone, zoneCount, setCalcMode } from '../helpers/zones';

test.describe('Save and load project', () => {
  test('round-trip: save project, reload, load file, verify state', async ({ page }, testInfo) => {
    testInfo.setTimeout(90_000);
    await waitForSession(page);

    // Configure project
    await setRoomDimensions(page, { x: 6, y: 4, z: 3 });
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'X'))).toBe(6);
    await addLampFromPreset(page);
    await addZone(page);

    // Collapse zone editor
    await page.locator('h3:has-text("Room")').click();

    // Save via File menu
    const fileMenu = page.locator('.menu-bar-item').filter({ hasText: 'File' }).locator('span[role="button"]');
    await fileMenu.click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('div[role="menuitem"]:has-text("Save")').click(),
    ]);

    const filePath = await download.path();
    expect(filePath).toBeTruthy();

    // Navigate to fresh page (new session)
    await page.goto('/');
    await expect(page.locator('span.status-indicator')).toBeVisible({ timeout: 15_000 });

    // Load the saved file
    await page.locator('input#load-file').setInputFiles(filePath!);

    // Wait for state to be restored
    await expect.poll(() => lampCount(page), { timeout: 10_000 }).toBe(1);
    await expect.poll(() => zoneCount(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);

    // Verify dimensions
    expect(parseFloat(await getRoomDimension(page, 'X'))).toBe(6);
    expect(parseFloat(await getRoomDimension(page, 'Y'))).toBe(4);
    expect(parseFloat(await getRoomDimension(page, 'Z'))).toBe(3);
  });

  test('round-trip: eye_directional zone survives save and load', async ({ page }, testInfo) => {
    testInfo.setTimeout(90_000);
    await waitForSession(page);

    await addLampFromPreset(page);
    await addZone(page);
    await setCalcMode(page, 'Eye (Directional)');

    // Collapse zone editor
    await page.locator('h3:has-text("Room")').click();

    // Save via File menu
    const fileMenu = page.locator('.menu-bar-item').filter({ hasText: 'File' }).locator('span[role="button"]');
    await fileMenu.click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('div[role="menuitem"]:has-text("Save")').click(),
    ]);

    const filePath = await download.path();
    expect(filePath).toBeTruthy();

    // Navigate to fresh page (new session)
    await page.goto('/');
    await expect(page.locator('span.status-indicator')).toBeVisible({ timeout: 15_000 });

    // Load the saved file
    await page.locator('input#load-file').setInputFiles(filePath!);

    // Wait for state to be restored, then verify no errors
    await expect.poll(() => lampCount(page), { timeout: 10_000 }).toBe(1);
    await expect.poll(() => zoneCount(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);

    const errorToasts = await page.locator('.toast-container .toast').count();
    expect(errorToasts).toBe(0);
  });
});
