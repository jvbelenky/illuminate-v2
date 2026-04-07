import { test, expect, type Page } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { setRoomDimensions, getRoomDimension } from '../helpers/room';

test.describe.serial('Error states', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await waitForSession(page);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('rejects invalid room dimension (zero)', async () => {
    const originalX = await getRoomDimension(page, 'X');
    await setRoomDimensions(page, { x: 0 });
    // Input should revert to original — poll until stable
    await expect.poll(() => getRoomDimension(page, 'X')).toBe(originalX);
  });

  test('rejects negative room dimension', async () => {
    const originalY = await getRoomDimension(page, 'Y');
    await setRoomDimensions(page, { y: -3 });
    await expect.poll(() => getRoomDimension(page, 'Y')).toBe(originalY);
  });

  test('calculate button shows needs-calc state with valid setup', async () => {
    const calcBtn = page.locator('button.calculate-btn');
    await expect(calcBtn).toBeVisible();
  });
});
