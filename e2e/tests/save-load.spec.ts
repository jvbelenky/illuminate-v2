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

    const filePath = await download.path();
    expect(filePath).toBeTruthy();

    // Navigate to fresh page (new session)
    await page.goto('/');
    await expect(page.locator('span.status-indicator')).toBeVisible({ timeout: 15_000 });

    // Load the saved file by setting it directly on the hidden input
    // (programmatic clicks on hidden inputs don't always trigger filechooser events)
    await page.locator('input#load-file').setInputFiles(filePath!);

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
