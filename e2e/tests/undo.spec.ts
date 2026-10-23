import { test, expect } from '@playwright/test';
import { waitForApiIdle } from '../helpers/network';
import { waitForSession } from '../helpers/session';
import { attachErrorGuard } from '../helpers/errors';
import { addObject, objectCount, getObjectsFromBackend } from '../helpers/objects';
import { setRoomDimensions, getRoomDimension } from '../helpers/room';

test.describe('Undo / redo', () => {
  test('Ctrl+Z takes back a new obstacle and Ctrl+Shift+Z brings it back under the same id', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await waitForSession(page);
    await addObject(page);
    const [added] = await getObjectsFromBackend(page);
    // Keyboard focus off any field, so the shortcut means "undo the scene"
    await page.locator('.app-status-bar').click();

    await page.keyboard.press('Control+z');
    await expect.poll(() => objectCount(page)).toBe(0);
    await waitForApiIdle(page);
    await expect.poll(async () => (await getObjectsFromBackend(page)).length).toBe(0);

    await page.keyboard.press('Control+Shift+z');
    await expect.poll(() => objectCount(page)).toBe(1);
    await waitForApiIdle(page);
    const back = await getObjectsFromBackend(page);
    expect(back).toHaveLength(1);
    expect(back[0].id).toBe(added.id);
    expect(back[0].x).toBeCloseTo(added.x, 6);
    guard.assertClean();
  });

  test('the Edit menu names the step and undoes a room height change', async ({ page }) => {
    await waitForSession(page);
    const before = parseFloat(await getRoomDimension(page, 'Z'));
    await setRoomDimensions(page, { z: before + 1 });
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'Z'))).toBe(before + 1);
    await waitForApiIdle(page);

    const editMenu = page.locator('.menu-bar-item').filter({ hasText: 'Edit' }).locator('span[role="button"]');
    await editMenu.click();
    const undo = page.locator('div[role="menuitem"]').filter({ hasText: 'Undo edit room' });
    await expect(undo).toBeVisible();
    await undo.click();
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'Z'))).toBe(before);
  });

  test('typing Ctrl+Z in a text field leaves the scene alone', async ({ page }) => {
    await waitForSession(page);
    await addObject(page);
    // Rename the structure from its row's pencil: a text field in the editor
    const row = page.locator('.structures-part .editor-row.open');
    await row.getByRole('button', { name: /^Rename / }).click();
    const name = row.getByLabel('Name', { exact: true });
    await name.click();
    await page.keyboard.press('Control+z');
    await waitForApiIdle(page);
    expect(await objectCount(page)).toBe(1);
  });
});
