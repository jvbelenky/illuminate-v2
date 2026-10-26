import path from 'path';
import { test, expect } from '../fixtures';
import { waitForSession } from '../helpers/session';
import { setRoomDimensions, getRoomDimension, expandRoomPanel, closePlan, unitsSelect, openGeometry } from '../helpers/room';
import { openReflectanceModal } from '../helpers/reflections';
import { openStep, planSvg, planTool } from '../helpers/workspace';

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

    // Switch units: X was set to 7 m above; every unit converts it and relabels the floor area
    await expandRoomPanel(page);
    const units = unitsSelect(page);
    const area = page.locator('.floorplan-part .ep-kv').filter({ hasText: 'Floor area' });
    const expectations: Array<[string, number, RegExp]> = [
      ['feet', 23, /ft²/],        // 22.97 ft, compared rounded to a whole number
      ['inches', 276, /in²/],     // 275.59 in, compared rounded to a whole number
      ['centimeters', 700, /cm²/],
      ['millimeters', 7000, /mm²/],
      ['meters', 7, /m²/],
    ];
    for (const [unit, x, label] of expectations) {
      await units.selectOption(unit);
      await expect(units).toHaveValue(unit);
      await expect.poll(async () => Math.round(parseFloat(await getRoomDimension(page, 'X')))).toBe(x);
      await expect(area).toHaveText(label);
    }
  });

  test('the Ceiling part sets the room height', async ({ page }) => {
    await waitForSession(page);
    await openStep(page, 'room', 'ceiling');
    const height = page.locator('.ceiling-part').getByLabel('Height', { exact: true });
    await height.click({ clickCount: 3 });
    await height.fill('3.4');
    await height.press('Tab');
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'Z'))).toBe(3.4);
  });
});

test.describe('Polygon rooms', () => {
  test('draw an outline, edit it by the table, and back to a rectangle', async ({ page }) => {
    await waitForSession(page);
    await expandRoomPanel(page);
    const part = page.locator('.floorplan-part');
    const width = part.getByLabel('Width', { exact: true });
    const length = part.getByLabel('Length', { exact: true });

    // Rectangle by default: Width and Length are editable, and the corner table has four rows
    await expect(width).toBeEnabled();
    await expect(length).toBeEnabled();
    await expect(part.locator('.ep-kv').filter({ hasText: 'Floor area' })).toHaveText(/m²/);
    const rows = part.locator('.vertex-row');
    await openGeometry(page);
    await expect(rows).toHaveCount(4);

    // Draw a triangle by clicking on the canvas
    await planTool(page, 'Draw').click();
    // Corners are present, so Draw asks before clearing them
    await page.getByRole('button', { name: 'Clear and draw' }).click();
    await expect(planTool(page, 'Draw')).toBeDisabled();
    const plan = planSvg(page);
    const box = await plan.boundingBox();
    if (!box) throw new Error('plan canvas not visible');
    await plan.click({ position: { x: box.width * 0.2, y: box.height * 0.8 } });
    await plan.click({ position: { x: box.width * 0.8, y: box.height * 0.8 } });
    // Hover before the third click: the angle readout is shown for the wall being drawn
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.3);
    await expect(page.locator('.plan-pane .angle-label')).toHaveText(/°$/);
    await plan.click({ position: { x: box.width * 0.8, y: box.height * 0.3 } });
    await expect(page.locator('.plan-pane svg.plan.drawing')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(rows).toHaveCount(3);
    // A polygon room's size comes from its corners
    await expect(width).toHaveCount(0);
    await expect(length).toHaveCount(0);
    await closePlan(page);
    await expect(page.locator('.summary-panel')).toContainText('3-corner outline');

    // The reflectance settings list the polygon's walls
    await openReflectanceModal(page);
    await expect(page.getByText('Wall 3')).toBeVisible();
    await page.keyboard.press('Escape');

    // Back to a rectangle via the corner table: a 4-corner outline at the origin
    await expandRoomPanel(page);
    await openGeometry(page);
    await part.getByRole('button', { name: 'Add corner' }).click();
    await expect(rows).toHaveCount(4);
    const corners = [[0, 0], [5, 0], [5, 4], [0, 4]];
    for (let i = 0; i < corners.length; i++) {
      const inputs = rows.nth(i).locator('input');
      for (let axis = 0; axis < 2; axis++) {
        const input = inputs.nth(axis);
        await input.click({ clickCount: 3 });
        await input.fill(String(corners[i][axis]));
        await input.press('Tab');
        // Wait for the commit to land before touching the next field
        await expect(input).toHaveValue(new RegExp(`^${corners[i][axis]}(\\.0+)?$`));
      }
    }
    await closePlan(page);
    await expect(page.locator('.summary-panel')).toContainText('5 × 4');
    await expandRoomPanel(page);
    await expect(width).toBeEnabled();
    await expect(length).toBeEnabled();
    await expect(part.locator('.ep-kv').filter({ hasText: 'Floor area' })).toHaveText(/m²/);
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'X'))).toBe(5);
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'Y'))).toBe(4);
  });

  test('upload a floor plan, calibrate it, save and reload the project', async ({ page }) => {
    await waitForSession(page);
    await expandRoomPanel(page);
    const part = page.locator('.floorplan-part');
    await openGeometry(page);

    // Upload: the image layer appears on the plan
    await part.locator('input[type="file"]').setInputFiles(path.resolve(__dirname, '../fixtures/floorplan.png'));
    const img = planSvg(page).locator('image.plan-image');
    await expect(img).toBeVisible();
    // The default rectangle is still there, so the upload asks whether to clear it
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(part.locator('.vertex-row')).toHaveCount(0);
    await page.getByRole('button', { name: 'Set scale now' }).click();

    // Calibrate: two clicks on the canvas, then a distance
    const plan = planSvg(page);
    const box = await plan.boundingBox();
    if (!box) throw new Error('plan canvas not visible');
    await plan.click({ position: { x: box.width * 0.3, y: box.height * 0.5 } });
    await plan.click({ position: { x: box.width * 0.6, y: box.height * 0.5 } });
    const distance = page.locator('#measured-distance');
    await expect(distance).toBeVisible();
    await distance.fill('3');
    await distance.press('Enter');
    // Scale confirmed with no outline: the editor offers to start tracing
    await expect(part.locator('.reference-panel')).toBeVisible();
    await page.getByRole('button', { name: 'Start tracing' }).click();
    await plan.click({ position: { x: box.width * 0.3, y: box.height * 0.7 } });
    await plan.click({ position: { x: box.width * 0.7, y: box.height * 0.7 } });
    await plan.click({ position: { x: box.width * 0.7, y: box.height * 0.3 } });
    await plan.click({ position: { x: box.width * 0.3, y: box.height * 0.3 } });
    await page.keyboard.press('Enter');
    await expect(part.locator('.vertex-row')).toHaveCount(4);
    await closePlan(page);

    // The summary's plan still shows the image
    await expect(planSvg(page).locator('image.plan-image')).toHaveCount(1);

    // Save, then remove the image and load the file: the image is back
    const fileMenu = page.locator('.menu-bar-item').filter({ hasText: 'File' }).locator('span[role="button"]');
    await fileMenu.click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'Save', exact: true }).click(),
    ]);
    const filePath = await download.path();

    // Remove the image through the UI so the "gone before load" precondition
    // is explicit rather than relying on a reload to reset client state.
    await expandRoomPanel(page);
    await part.getByRole('button', { name: 'Remove', exact: true }).click();
    await closePlan(page);
    await expect(planSvg(page).locator('image.plan-image')).toHaveCount(0);

    await page.locator('input#load-file').setInputFiles(filePath!);
    await expect(planSvg(page).locator('image.plan-image')).toHaveCount(1, { timeout: 15_000 });
    await expandRoomPanel(page);
    await expect(planSvg(page).locator('image.plan-image')).toBeVisible();
    await expect(part.locator('.reference-panel')).toBeVisible();
  });
});
