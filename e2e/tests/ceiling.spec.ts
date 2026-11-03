import { test, expect } from '../fixtures';
import type { Locator, Page } from '@playwright/test';
import { reloadSession, waitForSession } from '../helpers/session';
import { ceilingDesigner, designerPlan, openCeilingDesigner, openStep, planSvg, shapeBodyPoint, showMain } from '../helpers/workspace';

/** The open ceiling item's X and Y (detectors, vents and sensors). */
async function itemXY(page: Page): Promise<[number, number]> {
  const row = ceilingDesigner(page).locator('.ceiling-part .editor-row.open');
  return [Number(await row.getByLabel('X', { exact: true }).inputValue()), Number(await row.getByLabel('Y', { exact: true }).inputValue())];
}

/** Press on `target` (its centre) and drag by (dx, dy) screen pixels. */
async function dragBy(page: Page, target: Locator, dx: number, dy: number) {
  const box = (await target.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx * 0.6, cy + dy * 0.6, { steps: 6 });
  await page.mouse.move(cx + dx, cy + dy, { steps: 6 });
  await page.mouse.up();
}

async function closeDesigner(page: Page) {
  await ceilingDesigner(page).locator('.cd-footer').getByRole('button', { name: 'Close' }).click();
  await expect(ceilingDesigner(page)).toBeHidden();
}

test.describe('Ceiling designer', () => {
  test('the Room step has no Ceiling part; Tools › Ceiling designer… opens the window', async ({ page }) => {
    await waitForSession(page);
    await openStep(page, 'room');
    await expect(page.locator('button.editor-part')).toHaveText(['Floorplan', 'Structures', 'Reflectance']);
    const designer = await openCeilingDesigner(page);
    await expect(designer.locator('.modal-title')).toHaveText('Ceiling designer');
    await expect(designerPlan(page)).toBeVisible();
  });

  test('a detector and a keep-out area are added, the detector dragged, the grid moved, and all come back from the saved file', async ({ page }) => {
    await waitForSession(page);
    const designer = await openCeilingDesigner(page);
    const part = designer.locator('.ceiling-part');

    await part.getByRole('button', { name: 'Detector', exact: true }).click();
    await expect(part.locator('.editor-row[data-id="ceiling-1"]')).toHaveClass(/open/);
    const before = await itemXY(page);

    // Drag the detector across the window's plan: it lands in the middle of another tile
    await dragBy(page, designerPlan(page).getByRole('button', { name: 'Smoke detector 1' }), 90, -70);
    await expect.poll(async () => (await itemXY(page))[0]).toBeGreaterThan(before[0]);
    const moved = await itemXY(page);
    expect(moved[1]).toBeGreaterThan(before[1]);

    await part.getByRole('button', { name: 'Keep-out', exact: true }).click();
    await expect(part.locator('.editor-row[data-id="ceiling-2"]')).toHaveClass(/open/);
    await expect(part.getByLabel('Width', { exact: true })).toHaveValue('1.2');
    // Selected: its box, with resize and rotate handles
    await expect(designerPlan(page).getByRole('button', { name: 'Rotate' })).toBeVisible();

    // Move grid (nothing selected): a drag on empty ceiling shifts the tile lines
    await part.locator('.editor-row[data-id="ceiling-2"] .row-main').click();
    await expect(part.locator('.editor-row.open')).toHaveCount(0);
    await part.getByRole('button', { name: '2×2' }).click();
    const firstLine = designerPlan(page).locator('line.tile-line').first();
    const lineBefore = await firstLine.getAttribute('x1');
    const moveGrid = designer.locator('.cd-tools').getByRole('button', { name: 'Move grid' });
    await moveGrid.click();
    await expect(moveGrid).toHaveAttribute('aria-pressed', 'true');
    const plan = (await designerPlan(page).boundingBox())!;
    await page.mouse.move(plan.x + plan.width * 0.2, plan.y + plan.height * 0.75);
    await page.mouse.down();
    await page.mouse.move(plan.x + plan.width * 0.2 + 25, plan.y + plan.height * 0.75, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => firstLine.getAttribute('x1')).not.toBe(lineBefore);

    await closeDesigner(page);
    const fileMenu = page.locator('.menu-bar-item').filter({ hasText: 'File' }).locator('span[role="button"]');
    await fileMenu.click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'Save', exact: true }).click(),
    ]);
    const filePath = await download.path();

    // A fresh page starts with an empty ceiling; only the file brings the items back
    await reloadSession(page);
    await openCeilingDesigner(page);
    await expect(part.locator('.editor-row')).toHaveCount(0);

    await page.locator('input#load-file').setInputFiles(filePath!);
    await expect(part.locator('.editor-row')).toHaveCount(2, { timeout: 15_000 });
    await expect(part.locator('.editor-row[data-id="ceiling-1"]')).toContainText('Smoke detector 1');
    await expect(part.locator('.editor-row[data-id="ceiling-2"]')).toContainText('Keep-out area 1');
    await part.locator('.editor-row[data-id="ceiling-1"] .row-main').click();
    expect(await itemXY(page)).toEqual(moved);
    await expect(designerPlan(page).getByRole('button', { name: 'Keep-out area 1' })).toBeVisible();
  });

  test('a keep-out area turns a quarter with its rotate handle, shows its corners on a double-click, and Rectangle adds another', async ({ page }) => {
    await waitForSession(page);
    const designer = await openCeilingDesigner(page);
    const part = designer.locator('.ceiling-part');
    const plan = designerPlan(page);
    await part.getByRole('button', { name: 'Keep-out', exact: true }).click();
    const row = part.locator('.editor-row[data-id="ceiling-1"]');
    await expect(row).toHaveClass(/open/);
    const rotation = row.getByLabel('Rotation', { exact: true });
    await expect(rotation).toHaveValue('0');

    // The rotate handle, a quarter turn round the area's centre
    const area = (await plan.locator('polygon.outline').boundingBox())!;
    const cx = area.x + area.width / 2, cy = area.y + area.height / 2;
    const knob = (await plan.getByRole('button', { name: 'Rotate' }).boundingBox())!;
    const kx = knob.x + knob.width / 2, ky = knob.y + knob.height / 2;
    const r = Math.hypot(kx - cx, ky - cy);
    await page.mouse.move(kx, ky);
    await page.mouse.down();
    for (const deg of [20, 45, 70, 90]) {
      const a = -Math.PI / 2 - (deg * Math.PI) / 180;
      await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a), { steps: 3 });
    }
    await page.mouse.up();
    await expect(rotation).toHaveValue('90');
    await expect(row.getByLabel('Width', { exact: true })).toHaveValue('1.2');

    // Double-click: its corners; Esc goes back to the box, the area still selected and the window open
    await page.mouse.dblclick(...(await shapeBodyPoint(page, plan)));
    await expect(plan.getByRole('button', { name: 'Corner 1', exact: true })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Edit corners' })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(plan.getByRole('button', { name: 'Rotate' })).toBeVisible();
    await expect(plan.getByRole('button', { name: 'Corner 1', exact: true })).toHaveCount(0);
    await expect(row).toHaveClass(/open/);
    await expect(designer).toBeVisible();

    // Nothing selected: Rectangle drags out a new keep-out area
    await page.keyboard.press('Escape');
    await expect(part.locator('.editor-row.open')).toHaveCount(0);
    const rect = designer.locator('.cd-tools').getByRole('button', { name: 'Rectangle' });
    await rect.click();
    await expect(rect).toHaveAttribute('aria-pressed', 'true');
    const box = (await plan.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.42, { steps: 4 });
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5, { steps: 4 });
    await page.mouse.up();
    await expect(part.locator('.editor-row')).toHaveCount(2);
    await expect(part.locator('.editor-row[data-id="ceiling-2"]')).toHaveClass(/open/);
    await expect(plan.getByRole('button', { name: 'Rotate' })).toBeVisible();
  });

  test("the item editor's Copy opens the copy and Delete removes it; Ctrl+Z in the window brings it back", async ({ page }) => {
    await waitForSession(page);
    const designer = await openCeilingDesigner(page);
    const part = designer.locator('.ceiling-part');
    await part.getByRole('button', { name: 'Detector', exact: true }).click();
    const open = part.locator('.editor-row.open');
    await expect(open).toHaveAttribute('data-id', 'ceiling-1');
    await open.getByRole('button', { name: 'Copy (Ctrl+D)' }).click();
    await expect(part.locator('.editor-row')).toHaveCount(2);
    await expect(open).not.toHaveAttribute('data-id', 'ceiling-1');
    await open.getByRole('button', { name: 'Delete (Del)' }).click();
    await expect(part.locator('.editor-row')).toHaveCount(1);
    await designer.locator('.modal-title').click();
    await page.keyboard.press('Control+z');
    await expect(part.locator('.editor-row')).toHaveCount(2);
  });

  test('minimised to the dock, the main 2D view still works; a ceiling item clicked there brings the window back on it', async ({ page }) => {
    await waitForSession(page);
    const designer = await openCeilingDesigner(page);
    await designer.locator('.ceiling-part').getByRole('button', { name: 'Vent', exact: true }).click();
    await designer.locator('.ceiling-part').getByRole('button', { name: 'Sensor', exact: true }).click();
    await designer.getByTitle('Minimize').click();
    await expect(designer).toBeHidden();
    const tab = page.locator('.dock-tab').filter({ hasText: 'Ceiling designer' });
    await expect(tab).toBeVisible();

    // The main view edits its own step meanwhile, and shows the ceiling on its Ceiling surface
    await openStep(page, 'room', 'structures');
    await page.locator('.main-view-controls').getByRole('button', { name: 'Ceiling', exact: true }).click();
    await expect(planSvg(page).locator('line.tile-line')).not.toHaveCount(0);
    await expect(page.locator('.main-view-controls .plan-toolbar').getByRole('button', { name: 'Move grid' })).toHaveCount(0);
    // The sensor, added last, lies over the vent (both start in the middle of the room)
    await planSvg(page).getByRole('button', { name: 'Sensor 1' }).click();
    await expect(designer).toBeVisible();
    await expect(tab).toHaveCount(0);
    await expect(designer.locator('.ceiling-part .editor-row.open')).toHaveAttribute('data-id', 'ceiling-2');
  });

  test('a ceiling item clicked in the 3D view opens the window on it', async ({ page }) => {
    await waitForSession(page);
    const designer = await openCeilingDesigner(page);
    // A keep-out area starts in the middle of the room
    await designer.locator('.ceiling-part').getByRole('button', { name: 'Keep-out', exact: true }).click();
    await closeDesigner(page);
    await showMain(page, '3d');
    await page.getByTitle('Top (plan view)').first().click();
    const canvas = page.locator('.view-slot[data-view="3d"]:not(.mini) canvas').first();
    const box = (await canvas.boundingBox())!;
    // The camera settles into the top view before the click lands on the room's middle
    await expect.poll(async () => {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      return designer.isVisible();
    }, { timeout: 10_000 }).toBe(true);
    await expect(designer.locator('.ceiling-part .editor-row.open')).toHaveAttribute('data-id', 'ceiling-1');
  });
});

test.describe('Main view corners', () => {
  for (const width of [1280, 1024]) {
    test(`the edit strip and the view tools never overlap at ${width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 800 });
      await waitForSession(page);
      const strip = page.locator('.main-view-controls .plan-toolbar');
      const tools = page.locator('.view-slot[data-view="2d"]:not(.mini) .view-controls');
      for (const [stage, part] of [['room', 'floorplan'], ['room', 'structures'], ['lamps', undefined]] as const) {
        await openStep(page, stage, part);
        await expect(strip).toBeVisible();
        await expect(tools).toBeVisible();
        // Measured once the strip has settled (beside the tools, or on its own row above them)
        await expect.poll(async () => {
          const a = (await strip.boundingBox())!;
          const b = (await tools.boundingBox())!;
          return a.x + a.width <= b.x || a.y + a.height <= b.y;
        }, { message: `${part ?? stage}: the strip clears the view tools` }).toBe(true);
        // Labels at desktop widths; glyphs only on a narrow view
        if (width >= 1280) await expect(strip).not.toHaveClass(/compact/);
        await page.screenshot({ path: testInfo.outputPath(`corners-${width}-${part ?? stage}.png`) });
      }
    });
  }
});
