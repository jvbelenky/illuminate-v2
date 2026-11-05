import path from 'path';
import { test, expect } from '../fixtures';
import { waitForSession } from '../helpers/session';
import { setRoomDimensions, getRoomDimension, expandRoomPanel, closePlan, unitsSelect, openGeometry } from '../helpers/room';
import { openReflectanceModal } from '../helpers/reflections';
import { openStep, planSvg, planTool, openCeilingDesigner } from '../helpers/workspace';

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
    const area = page.locator('.floorplan-part .plan-summary');
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

  test('the ceiling designer sets the room height', async ({ page }) => {
    await waitForSession(page);
    const designer = await openCeilingDesigner(page);
    const height = designer.locator('.ceiling-part').getByLabel('Height', { exact: true });
    await height.click({ clickCount: 3 });
    await height.fill('3.4');
    await height.press('Tab');
    await designer.locator('.cd-footer').getByRole('button', { name: 'Close' }).click();
    await expect(designer).toBeHidden();
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'Z'))).toBe(3.4);
  });
});

test.describe('Editor fold-outs', () => {
  test('hovering the Geometry fold-out keeps it transparent', async ({ page }) => {
    await waitForSession(page);
    await expandRoomPanel(page);
    const toggle = page.locator('.floorplan-part button.ep-disc');
    await toggle.hover();
    await expect(toggle).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
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
    await expect(part.locator('.plan-summary')).toHaveText(/m²/);
    const rows = part.locator('.vertex-row');
    await openGeometry(page);
    await expect(rows).toHaveCount(4);

    // Draw a triangle by clicking on the canvas
    await planTool(page, 'Draw new outline').click();
    await expect(planTool(page, 'Draw new outline')).toHaveAttribute('aria-pressed', 'true');
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
    // A polygon room keeps Width and Length (its bounding box)
    await expect(width).toBeEnabled();
    await expect(length).toBeEnabled();
    await closePlan(page);
    await expect(page.locator('.summary-panel')).toContainText('3-vertex outline');

    // The reflectance settings list the polygon's walls
    await openReflectanceModal(page);
    await expect(page.locator('.col-name', { hasText: 'Wall 3' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Back to a rectangle via the corner table: a 4-corner outline at the origin
    await expandRoomPanel(page);
    await openGeometry(page);
    await part.getByRole('button', { name: 'Add vertex' }).click();
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
    await expect(part.locator('.plan-summary')).toHaveText(/m²/);
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'X'))).toBe(5);
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'Y'))).toBe(4);
  });

  test('the outline sits in a box: a corner handle widens the room (undo restores it), the rotate handle turns it a quarter, a double-click edits its vertices', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await waitForSession(page);
    await expandRoomPanel(page);
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'X'))).toBe(6);
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'Y'))).toBe(4);
    const plan = planSvg(page);
    await expect(plan.getByRole('button', { name: 'Rotate' })).toBeVisible();
    await expect(plan.getByRole('button', { name: 'Vertex 1', exact: true })).toHaveCount(0);
    for (const name of ['Edit vertices', 'Rotate 90°', 'Draw new outline']) await expect(planTool(page, name)).toBeVisible();
    await expect(page.locator('.main-view-controls .plan-toolbar')).not.toHaveClass(/compact/);
    await expect(planTool(page, 'Copy')).toHaveCount(0);
    await expect(planTool(page, 'Delete')).toHaveCount(0);

    // The top-right corner handle dragged right: wider, as one undo step; the height stays
    const handle = (await plan.getByRole('button', { name: 'Resize top-right' }).boundingBox())!;
    const hx = handle.x + handle.width / 2, hy = handle.y + handle.height / 2;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx + 20, hy, { steps: 4 });
    await page.mouse.move(hx + 40, hy, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'X'))).toBeGreaterThan(6.1);
    expect(parseFloat(await getRoomDimension(page, 'Y'))).toBe(4);
    expect(parseFloat(await getRoomDimension(page, 'Z'))).toBe(2.7);
    await page.locator('.app-status-bar').click();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'X'))).toBe(6);

    // The rotate handle, a quarter turn about the centre: 6 x 4 becomes 4 x 6 (moved up to stay at y >= 0)
    const room = (await plan.locator('polygon.outline').boundingBox())!;
    const cx = room.x + room.width / 2, cy = room.y + room.height / 2;
    const knob = (await plan.getByRole('button', { name: 'Rotate' }).boundingBox())!;
    const kx = knob.x + knob.width / 2, ky = knob.y + knob.height / 2;
    const r = Math.hypot(kx - cx, ky - cy);
    await page.mouse.move(kx, ky);
    await page.mouse.down();
    for (const deg of [20, 45, 70, 90]) {
      const a = -Math.PI / 2 - (deg * Math.PI) / 180;
      await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a), { steps: 3 });
    }
    await expect(plan.locator('text.tb-angle')).toHaveText('90°');
    await page.mouse.up();
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'Y'))).toBe(6);
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'X'))).toBe(5);
    await expect(page.locator('.floorplan-part .plan-summary')).toHaveText(/^24\.0 m²/);
    await expect.poll(async () => (await plan.locator('text.edge-label').allTextContents()).sort()).toEqual(['4.0', '4.0', '6.0', '6.0']);

    // A double-click inside: the vertex handles, Done in the strip; Esc goes back to the box
    const turned = (await plan.locator('polygon.outline').boundingBox())!;
    await page.mouse.dblclick(turned.x + turned.width / 2, turned.y + turned.height * 0.4);
    await expect(plan.getByRole('button', { name: 'Vertex 1', exact: true })).toBeVisible();
    await expect(plan.getByRole('button', { name: 'Rotate' })).toHaveCount(0);
    await expect(planTool(page, 'Done')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.floorplan-part .plan-actions').getByRole('button', { name: 'Edit vertices' })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(plan.getByRole('button', { name: 'Rotate' })).toBeVisible();
    await expect(plan.getByRole('button', { name: 'Vertex 1', exact: true })).toHaveCount(0);
  });

  test('double-click a wall to type its length; undo restores it', async ({ page }) => {
    await waitForSession(page);
    await expandRoomPanel(page);
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'X'))).toBe(6);
    const plan = planSvg(page);
    // Walls and vertices are edited in Edit vertices (the outline otherwise sits in its box)
    await planTool(page, 'Edit vertices').click();
    // Off the wall's centre, where the "+" handle sits
    const wall = await plan.getByRole('button', { name: 'Wall 1', exact: true }).boundingBox();
    if (!wall) throw new Error('bottom wall not visible');
    await page.mouse.dblclick(wall.x + wall.width * 0.25, wall.y + wall.height / 2);
    const input = page.getByRole('textbox', { name: 'Wall 1 length' });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(/^6(\.0+)?$/);
    await page.keyboard.type('8');
    await page.keyboard.press('Enter');
    await expect(input).toHaveCount(0);
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'X'))).toBe(8);
    await expect(plan.locator('circle.vertex')).toHaveCount(4);
    await page.locator('.app-status-bar').click();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => parseFloat(await getRoomDimension(page, 'X'))).toBe(6);
  });

  test('draw an outline by typing wall lengths, then type a corner position', async ({ page }) => {
    await waitForSession(page);
    await expandRoomPanel(page);
    await planTool(page, 'Draw new outline').click();
    const plan = planSvg(page);
    const box = (await plan.boundingBox())!;
    await plan.click({ position: { x: box.width * 0.2, y: box.height * 0.8 } });
    const length = page.getByRole('textbox', { name: 'Wall length' });
    const lastCorner = async () => {
      const b = (await plan.locator('circle.vertex').last().boundingBox())!;
      return [b.x + b.width / 2, b.y + b.height / 2];
    };
    // Each wall: point the rubber band, type its length, Enter
    for (const [dx, dy, len] of [[150, 0, '5'], [0, -150, '4'], [-150, 0, '5']] as const) {
      const [cx, cy] = await lastCorner();
      await page.mouse.move(cx + dx, cy + dy, { steps: 3 });
      await page.keyboard.type(len);
      await expect(length).toBeFocused();
      await expect(length).toHaveValue(len);
      await page.keyboard.press('Enter');
      await expect(length).toHaveCount(0);
    }
    await expect(plan.locator('circle.vertex')).toHaveCount(4);
    // Enter closes the outline
    await page.keyboard.press('Enter');
    await expect(page.locator('.plan-pane svg.plan.drawing')).toHaveCount(0);
    // A 5 x 4 outline wherever it started: 20 m², walls of 5, 4, 5 and 4
    await expect(page.locator('.floorplan-part .plan-summary')).toHaveText(/^20\.0 m²/);
    await expect(plan.locator('text.edge-label')).toHaveText(['5.0', '4.0', '5.0', '4.0']);

    // Double-click a vertex: X and Y, in place (in Edit vertices)
    await openGeometry(page);
    await planTool(page, 'Edit vertices').click();
    const row = page.locator('.floorplan-part .vertex-row').nth(1).locator('input');
    const x0 = parseFloat(await row.nth(0).inputValue());
    await plan.getByRole('button', { name: 'Vertex 2', exact: true }).dblclick();
    const cx = page.getByRole('textbox', { name: 'Vertex 2 X' });
    await expect(cx).toBeFocused();
    await page.keyboard.type(String(x0 + 0.5));
    await page.keyboard.press('Enter');
    await expect(cx).toHaveCount(0);
    await expect.poll(async () => parseFloat(await row.nth(0).inputValue())).toBeCloseTo(x0 + 0.5, 6);
  });

  test('upload a floor plan through the import window, save and reload the project', async ({ page }) => {
    await waitForSession(page);
    await expandRoomPanel(page);
    const part = page.locator('.floorplan-part');
    await openGeometry(page);

    // Upload: the import window opens on the image
    await part.locator('input[type="file"]').setInputFiles(path.resolve(__dirname, '../fixtures/floorplan.png'));
    const win = page.getByRole('dialog', { name: 'Floor plan from image' });
    await expect(win).toBeVisible();
    const clickImage = async (p: [number, number]) => {
      const [x, y] = await page.locator('.fi-image').evaluate((el, [px, py]) => {
        const q = new DOMPoint(px, py).matrixTransform((el as SVGGraphicsElement).getScreenCTM()!);
        return [q.x, q.y];
      }, p);
      await page.mouse.click(x, y);
    };
    // Already aligned; origin; a 3 m scale; trace four corners and close on the first
    await win.getByRole('button', { name: 'Already aligned' }).click();
    await clickImage([10, 50]);
    await win.getByRole('button', { name: 'Next →' }).click();
    await clickImage([10, 50]);
    await clickImage([110, 50]);
    await page.locator('#fi-distance').fill('3');
    await win.getByRole('button', { name: 'Next →' }).click();
    await win.getByRole('button', { name: 'Trace', exact: true }).click();
    for (const p of [[10, 50], [110, 50], [110, 10], [10, 10], [10, 50]] as [number, number][]) await clickImage(p);
    await expect(win.locator('.vertex-row')).toHaveCount(4);
    await win.getByRole('button', { name: 'Create room' }).click();
    await expect(win).toHaveCount(0);
    await expect(planSvg(page).locator('image.plan-image')).toBeVisible();
    await openGeometry(page);
    await expect(part.locator('.vertex-row')).toHaveCount(4);
    // 100 px at 3 m: the room is 3 m wide
    await expect.poll(async () => Number(await part.getByLabel('Width', { exact: true }).inputValue())).toBeCloseTo(3, 1);
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
