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
  test('switch to polygon, add a corner, switch back', async ({ page }) => {
    await waitForSession(page);

    const polygonRadio = page.getByRole('radio', { name: 'Polygon' });
    const rectangleRadio = page.getByRole('radio', { name: 'Rectangle' });

    // Rectangle by default: X/Y/Z inputs, no floor plan
    await expect(rectangleRadio).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.floor-plan-editor')).toHaveCount(0);

    // Switch to polygon: seeded with the rectangle's four corners
    await polygonRadio.click();
    await expect(polygonRadio).toHaveAttribute('aria-checked', 'true');
    const plan = page.locator('.floor-plan-editor');
    await expect(plan).toBeVisible();
    await expect(plan.locator('.vertex-row')).toHaveCount(4);
    await expect(plan.getByText(/4 walls/)).toBeVisible();
    await expect(page.locator('.room-editor .input-label')).toHaveText(['Z']);

    // Add a corner via the table; the backend accepts the new outline
    await plan.getByRole('button', { name: 'Add corner' }).click();
    await expect(plan.locator('.vertex-row')).toHaveCount(5);
    await expect(plan.getByText(/5 walls/)).toBeVisible();

    // The reflectance settings list the polygon's walls
    await page.locator('.room-editor').getByRole('button', { name: 'Set Reflectance' }).click();
    await expect(page.getByText('Wall 5')).toBeVisible();
    await page.keyboard.press('Escape');

    // Back to a rectangle: X/Y inputs return
    await rectangleRadio.click();
    await expect(page.locator('.floor-plan-editor')).toHaveCount(0);
    await expect(page.locator('.room-editor .input-label')).toHaveText(['X', 'Y', 'Z']);
  });
});
