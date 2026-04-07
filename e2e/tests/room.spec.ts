import { test, expect, type Page } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { setRoomDimensions, getRoomDimension } from '../helpers/room';

test.describe.serial('Room editor', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await waitForSession(page);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('can edit room X dimension', async () => {
    await setRoomDimensions(page, { x: 7 });
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'X'))).toBe(7);
  });

  test('can edit room Y dimension', async () => {
    await setRoomDimensions(page, { y: 5.5 });
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'Y'))).toBe(5.5);
  });

  test('can edit room Z dimension', async () => {
    await setRoomDimensions(page, { z: 2.8 });
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'Z'))).toBe(2.8);
  });

  test('can switch units', async () => {
    const unitsSelect = page.locator('.room-editor select.units-select');
    await unitsSelect.selectOption('feet');
    await expect(unitsSelect).toHaveValue('feet');
    await unitsSelect.selectOption('meters');
    await expect(unitsSelect).toHaveValue('meters');
  });
});
