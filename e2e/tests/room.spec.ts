import { test, expect } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { setRoomDimensions, getRoomDimension } from '../helpers/room';

test.describe('Room editor', () => {
  test.beforeEach(async ({ page }) => {
    await waitForSession(page);
  });

  test('can edit room X dimension', async ({ page }) => {
    await setRoomDimensions(page, { x: 7 });
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
    await unitsSelect.selectOption('meters');
    await expect(unitsSelect).toHaveValue('meters');
  });
});
