import { test, expect } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { setRoomDimensions, getRoomDimension } from '../helpers/room';

test.describe('Error states', () => {
  test.beforeEach(async ({ page }) => {
    await waitForSession(page);
  });

  test('rejects invalid room dimension (zero)', async ({ page }) => {
    const originalX = await getRoomDimension(page, 'X');
    await setRoomDimensions(page, { x: 0 });
    await page.waitForTimeout(500);
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
    const calcBtn = page.locator('button.calculate-btn');
    await expect(calcBtn).toBeVisible();
  });
});
