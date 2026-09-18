import { test, expect } from '../fixtures';
import { waitForSession } from '../helpers/session';
import { setRoomDimensions, getRoomDimension } from '../helpers/room';

test.describe('Room configuration', () => {
  test('edit dimensions, reject invalid values, switch units', async ({ page }) => {
    await waitForSession(page);

    // Edit all three dimensions
    await setRoomDimensions(page, { x: 7, y: 5.5, z: 2.8 });
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'X'))).toBe(7);
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'Y'))).toBe(5.5);
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'Z'))).toBe(2.8);

    // Reject zero dimension
    const originalX = await getRoomDimension(page, 'X');
    await setRoomDimensions(page, { x: 0 });
    await expect.poll(() => getRoomDimension(page, 'X')).toBe(originalX);

    // Reject negative dimension — value should stay positive (may not revert to exact original)
    await setRoomDimensions(page, { y: -3 });
    await expect.poll(async () => {
      const val = parseFloat(await getRoomDimension(page, 'Y'));
      return val > 0;
    }).toBe(true);

    // Switch units
    const unitsSelect = page.locator('.room-editor select.units-select');
    await unitsSelect.selectOption('feet');
    await expect(unitsSelect).toHaveValue('feet');
    await unitsSelect.selectOption('meters');
    await expect(unitsSelect).toHaveValue('meters');
  });
});

test.describe('Polygon rooms', () => {
  test('draw an outline, edit it by the table, and back to a rectangle', async ({ page }) => {
    await waitForSession(page);
    const editor = page.locator('.room-editor');

    // Rectangle by default: X/Y/Z inputs and a rectangle summary
    await expect(editor.locator('.input-label')).toHaveText(['X', 'Y', 'Z']);
    await expect(editor.locator('.plan-summary')).toHaveText(/^Rectangle/);

    // Open the floor-plan modal and draw a triangle by clicking on the canvas
    await editor.getByRole('button', { name: 'Edit floor plan' }).click();
    const modal = page.locator('.floor-plan-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.vertex-row')).toHaveCount(4);
    await modal.getByRole('button', { name: 'Draw outline' }).click();
    await expect(modal.getByRole('button', { name: 'Finish outline' })).toBeDisabled();
    const plan = modal.locator('svg.plan');
    const box = await plan.boundingBox();
    if (!box) throw new Error('plan canvas not visible');
    await plan.click({ position: { x: box.width * 0.2, y: box.height * 0.8 } });
    await plan.click({ position: { x: box.width * 0.8, y: box.height * 0.8 } });
    // Hover before the third click: the angle readout is shown for the wall being drawn
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.3);
    await expect(modal.locator('.angle-label')).toHaveText(/°$/);
    await plan.click({ position: { x: box.width * 0.8, y: box.height * 0.3 } });
    await expect(modal.getByRole('button', { name: 'Finish outline' })).toBeEnabled();
    await page.keyboard.press('Enter');
    await expect(modal.locator('.vertex-row')).toHaveCount(3);
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(modal).toHaveCount(0);
    await expect(editor.locator('.plan-summary')).toHaveText(/Polygon · 3 walls/);
    await expect(editor.locator('.input-label')).toHaveText(['X', 'Y', 'Z']);

    // The reflectance settings list the polygon's walls
    await editor.getByRole('button', { name: 'Set Reflectance' }).click();
    await expect(page.getByText('Wall 3')).toBeVisible();
    await page.keyboard.press('Escape');

    // Back to a rectangle via the vertex table: a 4-corner outline at the origin
    await editor.getByRole('button', { name: 'Edit floor plan' }).click();
    await modal.getByRole('button', { name: 'Add corner' }).click();
    await expect(modal.locator('.vertex-row')).toHaveCount(4);
    const corners = [[0, 0], [5, 0], [5, 4], [0, 4]];
    for (let i = 0; i < corners.length; i++) {
      const inputs = modal.locator('.vertex-row').nth(i).locator('input');
      for (let axis = 0; axis < 2; axis++) {
        const input = inputs.nth(axis);
        await input.click({ clickCount: 3 });
        await input.fill(String(corners[i][axis]));
        await input.press('Tab');
        // Wait for the commit to land before touching the next field
        await expect(input).toHaveValue(new RegExp(`^${corners[i][axis]}(\\.0+)?$`));
      }
    }
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(editor.locator('.input-label')).toHaveText(['X', 'Y', 'Z']);
    await expect(editor.locator('.plan-summary')).toHaveText(/^Rectangle/);
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'X'))).toBe(5);
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'Y'))).toBe(4);
  });
});
