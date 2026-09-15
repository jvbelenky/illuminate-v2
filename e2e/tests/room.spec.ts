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
  test('presets, drawing an outline, and back to a rectangle', async ({ page }) => {
    await waitForSession(page);
    const editor = page.locator('.room-editor');

    // Rectangle by default: X/Y/Z inputs and a rectangle summary
    await expect(editor.locator('.input-label')).toHaveText(['X', 'Y', 'Z']);
    await expect(editor.locator('.plan-summary')).toHaveText(/^Rectangle/);

    // Open the floor-plan modal, apply the L preset
    await editor.getByRole('button', { name: 'Edit floor plan…' }).click();
    const modal = page.locator('.floor-plan-modal');
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: 'L-shape' }).click();
    await expect(modal.locator('.vertex-row')).toHaveCount(6);
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(modal).toHaveCount(0);
    await expect(editor.locator('.plan-summary')).toHaveText(/Polygon · 6 walls/);
    await expect(editor.locator('.input-label')).toHaveText(['Z']);

    // The reflectance settings list the polygon's walls
    await editor.getByRole('button', { name: 'Set Reflectance' }).click();
    await expect(page.getByText('Wall 6')).toBeVisible();
    await page.keyboard.press('Escape');

    // Draw a triangle by clicking on the canvas, close with Enter
    await editor.getByRole('button', { name: 'Edit floor plan…' }).click();
    await modal.getByRole('button', { name: 'Draw outline' }).click();
    const plan = modal.locator('svg.plan');
    const box = await plan.boundingBox();
    if (!box) throw new Error('plan canvas not visible');
    const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
    await plan.click({ position: { x: box.width * 0.2, y: box.height * 0.8 } });
    await plan.click({ position: { x: box.width * 0.8, y: box.height * 0.8 } });
    await plan.click({ position: { x: box.width * 0.5, y: box.height * 0.2 } });
    void at;
    await page.keyboard.press('Enter');
    await expect(modal.locator('.vertex-row')).toHaveCount(3);
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(editor.locator('.plan-summary')).toHaveText(/Polygon · 3 walls/);

    // Rectangle preset restores rectangle mode
    await editor.getByRole('button', { name: 'Edit floor plan…' }).click();
    await modal.getByRole('button', { name: 'Rectangle' }).click();
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(editor.locator('.input-label')).toHaveText(['X', 'Y', 'Z']);
    await expect(editor.locator('.plan-summary')).toHaveText(/^Rectangle/);
  });
});
