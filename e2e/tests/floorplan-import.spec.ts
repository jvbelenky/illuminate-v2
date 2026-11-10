import path from 'path';
import { type Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { waitForSession } from '../helpers/session';
import { expandRoomPanel } from '../helpers/room';
import { planSvg } from '../helpers/workspace';
import { getObjectsFromStore } from '../helpers/objects';

// The fixture: a 5 x 3 m room (500 x 300 px inside, 100 px/m) whose inner faces
// span (150, 150)-(650, 450) on an 800 x 600 page, then turned 4° clockwise.
// One interior partition: 8 px (0.08 m) thick at x 500..508, from the top
// wall's inner face down to y 300 (1.5 m).
const FIXTURE = path.resolve(__dirname, '../fixtures/floorplan-tilted.png');
// The user's bedroom plan: 956 x 581, grey walls 13 px thick with a vertex
// circle on each corner; 152" from the bottom-left circle (72, 543) to the
// stub's (710, 543), about 165 px/m.
const BEDROOM = path.resolve(__dirname, '../fixtures/user-bedroom-plan.png');
const C: [number, number] = [400, 300];
/** A point of the drawing before the tilt -> its image pixel (turned 4° clockwise on screen). */
function tilted([x, y]: [number, number]): [number, number] {
  const r = (4 * Math.PI) / 180;
  const dx = x - C[0], dy = y - C[1];
  return [C[0] + dx * Math.cos(r) - dy * Math.sin(r), C[1] + dx * Math.sin(r) + dy * Math.cos(r)];
}

function dialog(page: Page) {
  return page.getByRole('dialog', { name: 'Floor plan from file' });
}

/** The open step card. */
function card(page: Page) {
  return dialog(page).locator('.fi-card.open');
}

/** Image pixel -> screen point, wherever the view (or the outline canvas) puts it, rotation included. */
async function screenOf(page: Page, p: [number, number]): Promise<[number, number]> {
  return page.locator('.fi-image').evaluate((el, [px, py]) => {
    const q = new DOMPoint(px, py).matrixTransform((el as SVGGraphicsElement).getScreenCTM()!);
    return [q.x, q.y] as [number, number];
  }, p);
}

/** Click an image pixel of the window's image. */
async function clickImage(page: Page, p: [number, number]) {
  const [x, y] = await screenOf(page, p);
  await page.mouse.click(x, y);
}

/** Upload floor plan file: the window opens on step 1; the picker waits for Choose file…. */
async function openWindow(page: Page) {
  await waitForSession(page);
  await expandRoomPanel(page);
  await page.locator('.floorplan-part').getByRole('button', { name: /Upload floor plan file/ }).click();
  await expect(dialog(page)).toBeVisible();
}

async function upload(page: Page, file = FIXTURE) {
  await openWindow(page);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), card(page).getByRole('button', { name: 'Choose file…' }).click()]);
  await chooser.setFiles(file);
  await expect(card(page)).toContainText('Align axes');
}

/** The One room prompt over the image. */
function pickPrompt(page: Page) {
  return dialog(page).getByRole('status', { name: 'Pick a room' });
}

/** Set scale: two clicks, the distance typed into the popup beside the cursor, Enter. */
async function scaleBy(page: Page, a: [number, number], b: [number, number], text: string) {
  await clickImage(page, a);
  await clickImage(page, b);
  const pop = dialog(page).getByLabel('Distance between the points');
  await expect(pop).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(pop).toHaveCount(0);
}

/** Looks good, the origin on the bottom-left inner corner and a 5 m scale along the bottom wall (the plan stays tilted). */
async function quickSetup(page: Page) {
  await dialog(page).getByRole('button', { name: 'Looks good' }).click();
  await clickImage(page, tilted([150, 450]));
  await card(page).getByRole('button', { name: 'Next', exact: true }).click();
  await scaleBy(page, tilted([150, 450]), tilted([650, 450]), '5');
  await card(page).getByRole('button', { name: 'Next', exact: true }).click();
  await expect(card(page)).toContainText('Trace outline');
}

/**
 * The user's bedroom plan as a person sets it up: Looks good, the origin on the
 * bottom-left vertex circle, the scale on the 152" bottom wall's two vertex
 * circles. With 'meters' the unit is left at its default (a wrong unit).
 */
async function bedroomSetup(page: Page, unit: 'inches' | 'meters' = 'inches') {
  await upload(page, BEDROOM);
  await dialog(page).getByRole('button', { name: 'Looks good' }).click();
  await clickImage(page, [72, 543]);
  await card(page).getByRole('button', { name: 'Next', exact: true }).click();
  await clickImage(page, [72, 543]);
  await clickImage(page, [710, 543]);
  await page.keyboard.type('152');
  if (unit === 'inches') {
    const pop = dialog(page).getByRole('group', { name: 'Scale distance' });
    await pop.getByLabel('Distance units').selectOption('inches');
    await pop.getByLabel('Distance between the points').focus();
  }
  await page.keyboard.press('Enter');
  await card(page).getByRole('button', { name: 'Next', exact: true }).click();
  await expect(card(page)).toContainText('Trace outline');
}

/** Steps 1-3: straighten, origin by drag, scale by the popup. */
async function alignedSetup(page: Page) {
  // 1. Align axes: Straighten, then two clicks along the top wall's inner face
  await expect(card(page).getByRole('status')).toHaveText('Do the walls line up with the grid?');
  await card(page).getByRole('button', { name: 'Straighten' }).click();
  await expect(card(page).getByRole('status')).toHaveText('Click two points along a wall to align it to an axis.');
  await clickImage(page, tilted([170, 150]));
  await clickImage(page, tilted([630, 150]));
  await expect.poll(async () => Number(await page.locator('svg.fi-svg').getAttribute('data-rotation'))).toBeCloseTo(-4, 3);
  await expect(card(page).getByRole('button', { name: 'Redo' })).toBeVisible();
  await card(page).getByRole('button', { name: 'Done' }).click();
  await expect(dialog(page).locator('.fi-card').nth(1)).toHaveClass(/done/);
  await card(page).getByRole('button', { name: 'Next', exact: true }).click();

  // 2. The origin: press beside the bottom-left inner corner and drag it there
  const [ox, oy] = await screenOf(page, tilted([150, 450]));
  await page.mouse.move(ox + 30, oy - 20);
  await page.mouse.down();
  await page.mouse.move(ox + 10, oy - 5, { steps: 3 });
  await page.mouse.move(ox, oy, { steps: 3 });
  await page.mouse.up();
  await expect(card(page).getByRole('status')).toHaveText('Click to place the origin (0, 0).');
  await card(page).getByRole('button', { name: 'Next', exact: true }).click();

  // 3. Scale: the bottom wall, 5 m
  await scaleBy(page, tilted([150, 450]), tilted([650, 450]), '5');
  await expect(card(page).getByLabel('Distance', { exact: true })).toHaveValue('5');
  await page.getByRole('button', { name: 'Next →' }).click();
  await expect(dialog(page).getByRole('button', { name: /Set scale\s*5 m/ })).toBeVisible();
}

/** Steps 1-3, then Auto-detect on one room; ends with the four vertex rows shown. */
async function detectRoom(page: Page) {
  await alignedSetup(page);

  // 4. Auto-detect: One room, then click inside it
  await card(page).getByRole('button', { name: 'Auto-detect' }).click();
  await dialog(page).getByRole('alertdialog', { name: 'Detect the outline of…' }).getByRole('button', { name: 'One room' }).click();
  await expect(pickPrompt(page)).toContainText('Click inside a room to detect it');
  await clickImage(page, tilted([450, 220]));
  await expect(dialog(page).locator('.vertex-row')).toHaveCount(4);
}

test.describe('Floor plan import window', () => {
  test('straighten, origin, scale, auto-detect, edit a vertex, create the room and its interior wall; one undo takes it all back', async ({ page }) => {
    await upload(page);
    const width = page.locator('.floorplan-part').getByLabel('Width', { exact: true });
    const before = await width.inputValue();
    const objectsBefore = (await getObjectsFromStore(page)).length;
    await detectRoom(page);
    const rows = dialog(page).locator('.vertex-row');

    // The partition is found, outlined on the image and listed, ticked
    await expect(dialog(page).getByRole('button', { name: 'Interior walls (1)' })).toBeVisible();
    await expect(dialog(page).locator('polygon.fi-iwall')).toHaveCount(1);
    await expect(dialog(page).getByRole('checkbox', { name: 'Wall 1' })).toBeChecked();
    await expect(dialog(page).getByRole('checkbox', { name: 'Include interior walls' })).toBeChecked();

    // Edit one vertex: the far corner's X to exactly 5
    const xs = await rows.evaluateAll((els) => els.map((r) => Number((r.querySelector('input') as HTMLInputElement).value)));
    const far = xs.indexOf(Math.max(...xs));
    expect(xs[far]).toBeCloseTo(5, 1);
    const fx = rows.nth(far).locator('input').first();
    await fx.fill('5');
    await fx.press('Enter');
    await expect.poll(async () => Number(await fx.inputValue())).toBe(5);

    await page.getByRole('button', { name: 'Create room' }).click();
    await expect(dialog(page)).toHaveCount(0);

    // A 5 x 3 m room, the image under it turned back 4°
    await expect.poll(async () => Number(await width.inputValue())).toBeCloseTo(5, 1);
    const length = page.locator('.floorplan-part').getByLabel('Length', { exact: true });
    await expect.poll(async () => Number(await length.inputValue())).toBeGreaterThan(2.9);
    expect(Number(await length.inputValue())).toBeLessThan(3.1);
    const img = planSvg(page).locator('image.plan-image');
    await expect(img).toHaveAttribute('transform', /^rotate\(-(3\.99|4)/);

    // One structure for the partition: 1.5 m along y, 0.08 m thick, floor to ceiling
    await expect.poll(async () => (await getObjectsFromStore(page)).length).toBe(objectsBefore + 1);
    const wall = (await getObjectsFromStore(page)).at(-1)!;
    expect(wall.name).toMatch(/^Wall \d+$/);
    expect(wall.length).toBeGreaterThan(1.4);
    expect(wall.length).toBeLessThan(1.6);
    expect(wall.width).toBeGreaterThan(0.06);
    expect(wall.width).toBeLessThan(0.1);
    expect(wall.z).toBe(0);
    expect(wall.x).toBeCloseTo(3.54, 1);
    expect(wall.y).toBeCloseTo(2.25, 1);

    // One undo restores the previous room, takes the image away and the wall with it
    await page.locator('.app-status-bar').click();
    await page.keyboard.press('Control+z');
    await expect.poll(() => width.inputValue()).toBe(before);
    await expect(planSvg(page).locator('image.plan-image')).toHaveCount(0);
    await expect.poll(async () => (await getObjectsFromStore(page)).length).toBe(objectsBefore);
  });

  test('an unticked interior wall is not built', async ({ page }) => {
    await upload(page);
    const objectsBefore = (await getObjectsFromStore(page)).length;
    await detectRoom(page);
    // Clicking the wall on the image unticks it
    await dialog(page).locator('polygon.fi-iwall').click();
    await expect(dialog(page).getByRole('checkbox', { name: 'Wall 1' })).not.toBeChecked();
    await expect(dialog(page).getByRole('checkbox', { name: 'Include interior walls' })).not.toBeChecked();
    await page.getByRole('button', { name: 'Create room' }).click();
    await expect(dialog(page)).toHaveCount(0);
    const width = page.locator('.floorplan-part').getByLabel('Width', { exact: true });
    await expect.poll(async () => Number(await width.inputValue())).toBeCloseTo(5, 1);
    expect((await getObjectsFromStore(page)).length).toBe(objectsBefore);
  });

  test('Next without an origin asks for it, and OK stays on Set origin', async ({ page }) => {
    await upload(page);
    await page.getByRole('button', { name: 'Next →' }).click();
    await expect(card(page).getByRole('status')).toHaveText('Click to place the origin (0, 0).');
    await page.getByRole('button', { name: 'Next →' }).click();
    const prompt = page.getByRole('alertdialog', { name: 'Set the origin first' });
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: 'OK' }).click();
    await expect(prompt).toHaveCount(0);
    await expect(card(page)).toContainText('Set origin');
    // A later step card asks the same
    await dialog(page).getByRole('button', { name: /Trace outline/ }).click();
    await expect(page.getByRole('alertdialog', { name: 'Set the origin first' })).toBeVisible();
  });

  test('the scale: the popup, edited on the card, its line hidden, Redo sets it again; the popup closes on Esc or a click away', async ({ page }) => {
    await upload(page);
    await dialog(page).getByRole('button', { name: 'Looks good' }).click();
    await clickImage(page, tilted([150, 450]));
    await card(page).getByRole('button', { name: 'Next', exact: true }).click();
    await scaleBy(page, tilted([150, 450]), tilted([650, 450]), '5');
    const label = dialog(page).locator('.fi-scale-label');
    await expect(label).toHaveText('5 m');
    // Edited on the card
    const field = card(page).getByLabel('Distance', { exact: true });
    await field.fill('10');
    await expect(label).toHaveText('10 m');
    // The line hides and shows again
    await card(page).getByRole('button', { name: 'Hide the scale line' }).click();
    await expect(dialog(page).locator('line.fi-scale')).toHaveCount(0);
    await card(page).getByRole('button', { name: 'Show the scale line' }).click();
    await expect(dialog(page).locator('line.fi-scale')).toHaveCount(1);
    // Redo: the next two clicks set it again; Esc closes the popup and keeps the value
    await card(page).getByRole('button', { name: 'Redo' }).click();
    await expect(card(page).getByRole('status')).toHaveText('Click two points a known distance apart.');
    await clickImage(page, tilted([150, 150]));
    await clickImage(page, tilted([150, 450]));
    const pop = dialog(page).getByLabel('Distance between the points');
    await expect(pop).toBeFocused();
    await expect(pop).toHaveValue('10');
    await page.keyboard.type('3');
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await expect(dialog(page)).toBeVisible();
    await expect(card(page).getByLabel('Distance', { exact: true })).toHaveValue('3');
    // A click away (here on the card) confirms what is typed and closes it
    await card(page).getByRole('button', { name: 'Redo' }).click();
    await clickImage(page, tilted([150, 150]));
    await clickImage(page, tilted([150, 450]));
    await expect(pop).toBeFocused();
    await page.keyboard.type('2.5');
    await card(page).locator('.fi-ch').click();
    await expect(pop).toHaveCount(0);
    await expect(card(page).getByLabel('Distance', { exact: true })).toHaveValue('2.5');
  });

  test('tracing snaps like the 2D view: near-square clicks make an exact rectangle', async ({ page }) => {
    await upload(page);
    await quickSetup(page);
    await card(page).getByRole('button', { name: 'Manual trace' }).click();
    await expect(card(page).getByRole('status')).toHaveText('Click on the image to place the first vertex.');
    const canvas = dialog(page).getByRole('application', { name: 'Outline canvas' });
    const box = (await canvas.boundingBox())!;
    const x0 = box.x + box.width * 0.3, y0 = box.y + box.height * 0.7;
    const rows = dialog(page).locator('.vertex-row');
    // Short walls, each a few pixels off square (past a 3° angle snap): every
    // corner lines up with the previous one, the last with the first too.
    // The table grows with each vertex, Redo | Finish under it
    let n = 0;
    for (const [dx, dy] of [[0, 0], [90, 6], [95, -70], [-5, -66]] as [number, number][]) {
      await page.mouse.move(x0 + dx, y0 + dy, { steps: 2 });
      await page.mouse.click(x0 + dx, y0 + dy);
      await expect(rows).toHaveCount(++n);
    }
    await expect(card(page).locator('.fi-pair button')).toHaveText(['Redo', 'Finish']);
    await page.keyboard.press('Enter');
    await expect(rows).toHaveCount(4);
    await expect(card(page).locator('.fi-pair button')).toHaveText(['Redo']);
    const pts = await rows.evaluateAll((els) => els.map((r) => Array.from(r.querySelectorAll('input')).slice(0, 2).map((i) => Number((i as HTMLInputElement).value))));
    expect(new Set(pts.map((p) => p[0])).size).toBe(2);
    expect(new Set(pts.map((p) => p[1])).size).toBe(2);
    // Exactly, not just as shown in the table
    const exact = await canvas.locator('circle.vertex').evaluateAll((els) => els.map((c) => [c.getAttribute('cx'), c.getAttribute('cy')]));
    expect(new Set(exact.map((p) => p[0])).size).toBe(2);
    expect(new Set(exact.map((p) => p[1])).size).toBe(2);
    // Redo clears it back to the switch's choice: Manual trace, drawing again
    await card(page).getByRole('button', { name: 'Redo' }).click();
    await expect(rows).toHaveCount(0);
    await expect(card(page).getByRole('status')).toHaveText('Click on the image to place the first vertex.');
  });

  test('tracing: Finish closes the outline; Undo and Redo step through the traced vertices', async ({ page }) => {
    await upload(page);
    await quickSetup(page);
    await card(page).getByRole('button', { name: 'Manual trace' }).click();
    const canvas = dialog(page).getByRole('application', { name: 'Outline canvas' });
    const box = (await canvas.boundingBox())!;
    const x0 = box.x + box.width * 0.3, y0 = box.y + box.height * 0.7;
    const rows = dialog(page).locator('.vertex-row');
    const finish = card(page).getByRole('button', { name: 'Finish' });
    for (const [dx, dy] of [[0, 0], [120, 0], [120, -90]] as [number, number][]) await page.mouse.click(x0 + dx, y0 + dy);
    await expect(rows).toHaveCount(3);
    // Undo twice: one vertex left; Redo brings one back (Ctrl+Y and the button alike)
    const undo = dialog(page).getByRole('button', { name: 'Undo', exact: true });
    const redo = dialog(page).locator('.fi-tools').getByRole('button', { name: 'Redo', exact: true });
    await undo.click();
    await expect(rows).toHaveCount(2);
    await page.keyboard.press('Control+z');
    await expect(rows).toHaveCount(1);
    await expect(finish).toBeDisabled();
    await page.keyboard.press('Control+y');
    await expect(rows).toHaveCount(2);
    await redo.click();
    await expect(rows).toHaveCount(3);
    await expect(redo).toBeDisabled();
    // Still drawing: a fourth vertex, then Finish closes it back to the first
    await page.mouse.click(x0, y0 - 90);
    await expect(rows).toHaveCount(4);
    await finish.click();
    await expect(card(page).locator('.fi-pair button')).toHaveText(['Redo']);
    await expect(canvas.locator('polygon.outline')).toHaveCount(1);
    await expect(dialog(page).locator('.fi-card').nth(4)).toHaveClass(/done/);
    // The wall lengths sit on chips, the only labels on the outline (no vertex numbers)
    await expect(canvas.locator('rect.label-chip')).toHaveCount(4);
    await expect(canvas.locator('text.edge-label')).toHaveCount(4);
    await expect(canvas.locator('text.vertex-label')).toHaveCount(0);
    // Undo the Finish: drawing again with the same four
    await undo.click();
    await expect(card(page).locator('.fi-pair button')).toHaveText(['Redo', 'Finish']);
    await expect(rows).toHaveCount(4);
  });

  test('the scale line snaps level, and its units become the project\'s', async ({ page }) => {
    await upload(page);
    await dialog(page).getByRole('button', { name: 'Looks good' }).click();
    await clickImage(page, tilted([150, 450]));
    await card(page).getByRole('button', { name: 'Next', exact: true }).click();
    // The second point 10 px off level over 400 px (1.4°): it lines up with the first
    await clickImage(page, [200, 400]);
    await clickImage(page, [600, 410]);
    const line = dialog(page).locator('.fi-stage line.fi-scale');
    const at = async () => line.evaluate((el) => ['x1', 'y1', 'x2', 'y2'].map((k) => Number(el.getAttribute(k))));
    const [x1, y1, x2, y2] = await at();
    expect(x1).toBeCloseTo(200, 0);
    expect(x2).toBeCloseTo(600, 0);
    expect(y1).toBeCloseTo(400, 0);
    expect(y2).toBe(y1);
    // The distance's units become the project's
    const pop = dialog(page).getByRole('group', { name: 'Scale distance' });
    await page.keyboard.type('400');
    await pop.getByLabel('Distance units').selectOption('centimeters');
    await expect(dialog(page).locator('.fi-units select')).toHaveValue('centimeters');
    await pop.getByRole('button', { name: 'OK' }).click();
    await expect(card(page).locator('#fi-distance')).toHaveValue('400');
    await expect(card(page).getByLabel('Distance units')).toHaveValue('centimeters');
    // Well off level it stays where it was clicked
    await card(page).getByRole('button', { name: 'Redo' }).click();
    await clickImage(page, [200, 400]);
    await clickImage(page, [600, 300]);
    const free = await at();
    expect(free[3]).toBeCloseTo(300, 0);
  });

  test('the image stays where it is between Set scale and Trace outline', async ({ page }) => {
    await upload(page);
    await dialog(page).getByRole('button', { name: 'Looks good' }).click();
    await clickImage(page, tilted([150, 450]));
    await card(page).getByRole('button', { name: 'Next', exact: true }).click();
    await scaleBy(page, tilted([150, 450]), tilted([650, 450]), '5');
    const corners: [number, number][] = [[0, 0], [800, 600]];
    const where = async () => (await Promise.all(corners.map((c) => screenOf(page, c)))).flat();
    const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(1.5));
    const before = await where();
    await card(page).getByRole('button', { name: 'Next', exact: true }).click();
    await expect(card(page)).toContainText('Trace outline');
    await expect(dialog(page).getByRole('application', { name: 'Outline canvas' })).toBeVisible();
    close(await where(), before);
    // Zoomed on the canvas, then back a step: the stage shows the same
    await page.mouse.move(before[0] + 200, before[1] + 200);
    await page.mouse.wheel(0, -400);
    const zoomed = await where();
    expect(Math.abs(zoomed[2] - zoomed[0])).toBeGreaterThan(Math.abs(before[2] - before[0]) * 1.2);
    await page.getByRole('button', { name: '← Back' }).click();
    await expect(card(page)).toContainText('Set scale');
    close(await where(), zoomed);
  });

  test('Auto-detect is over the image from the first step: the outline found before the origin and scale, then carried to Trace outline', async ({ page }) => {
    await upload(page, BEDROOM);
    await dialog(page).locator('.fi-tools').getByRole('button', { name: 'Auto-detect' }).click();
    await page.getByRole('alertdialog', { name: 'Detect the outline of…' }).getByRole('button', { name: 'Whole space' }).click();
    const found = dialog(page).locator('.fi-stage polygon.fi-outline');
    await expect(found).toBeVisible();
    expect((await found.getAttribute('points'))!.trim().split(/\s+/)).toHaveLength(8);
    // Still on Align axes; the outline step waits for the origin and scale
    await expect(card(page)).toContainText('Align axes');
    await expect(dialog(page).locator('.fi-card').nth(4)).not.toHaveClass(/done/);
    await dialog(page).getByRole('button', { name: 'Looks good' }).click();
    await clickImage(page, [72, 543]);
    await card(page).getByRole('button', { name: 'Next', exact: true }).click();
    await clickImage(page, [72, 543]);
    await clickImage(page, [710, 543]);
    await page.keyboard.type('152');
    const pop = dialog(page).getByRole('group', { name: 'Scale distance' });
    await pop.getByLabel('Distance units').selectOption('inches');
    await pop.getByRole('button', { name: 'OK' }).click();
    await expect(dialog(page).locator('.fi-card').nth(4)).toHaveClass(/done/);
    await card(page).getByRole('button', { name: 'Next', exact: true }).click();
    await expect(card(page)).toContainText('Trace outline');
    await expect(dialog(page).locator('.vertex-row')).toHaveCount(8);
    await expect(card(page).getByRole('button', { name: 'Auto-detect' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('opening the window waits on step 1 for Choose file…; chosen, Align axes; Change file… starts over', async ({ page }) => {
    await openWindow(page);
    // No picker yet: all five steps not done, step 1 open
    const cards = dialog(page).locator('.fi-card');
    await expect(cards).toHaveCount(5);
    await expect(dialog(page).locator('.fi-card.done')).toHaveCount(0);
    await expect(card(page)).toContainText('Select floor plan file');
    await expect(card(page).getByRole('status')).toHaveText('Choose a floor plan file (PNG, JPEG, SVG or PDF).');
    await expect(dialog(page).getByText('No file chosen')).toBeVisible();
    await expect(dialog(page).getByRole('button', { name: /Change image/ })).toHaveCount(0);
    // Next asks for the file first
    await page.getByRole('button', { name: 'Next →' }).click();
    const need = page.getByRole('alertdialog', { name: 'Choose a floor plan file first' });
    await expect(need).toBeVisible();
    await need.getByRole('button', { name: 'OK' }).click();
    // Choose file…
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), card(page).getByRole('button', { name: 'Choose file…' }).click()]);
    await chooser.setFiles(FIXTURE);
    await expect(card(page)).toContainText('Align axes');
    await expect(cards.nth(0)).toHaveClass(/done/);
    await expect(cards.nth(0)).toContainText('floorplan-tilted.png');
    // Some work, then Change file… on step 1: no warning. The picker cancelled, the work stays;
    // a file chosen, the window starts over on Align axes
    await dialog(page).getByRole('button', { name: 'Looks good' }).click();
    await clickImage(page, tilted([150, 450]));
    await expect(cards.nth(2)).toHaveClass(/done/);
    await cards.nth(0).locator('.fi-ch').click();
    await expect(card(page).getByRole('button', { name: 'Next', exact: true })).toBeVisible();
    const change = card(page).getByRole('button', { name: 'Change file…' });
    const [cancelled] = await Promise.all([page.waitForEvent('filechooser'), change.click()]);
    await cancelled.setFiles([]);
    await expect(page.getByRole('dialog', { name: 'Start over with a new file?' })).toHaveCount(0);
    await expect(cards.nth(2)).toHaveClass(/done/);
    await expect(cards.nth(0)).toContainText('floorplan-tilted.png');
    const [chooser2] = await Promise.all([page.waitForEvent('filechooser'), change.click()]);
    await chooser2.setFiles(path.resolve(__dirname, '../fixtures/floorplan.png'));
    await expect(card(page)).toContainText('Align axes');
    await expect(dialog(page).locator('.fi-card.done')).toHaveCount(1);
    await expect(cards.nth(0)).toContainText('floorplan.png');
    await expect(card(page).getByRole('status')).toHaveText('Do the walls line up with the grid?');
  });

  test('Undo and Redo across steps: the origin placed, undone, redone; the opacity slider sets the plan\'s opacity', async ({ page }) => {
    await upload(page);
    const undo = dialog(page).getByRole('button', { name: 'Undo', exact: true });
    const redo = dialog(page).locator('.fi-tools').getByRole('button', { name: 'Redo', exact: true });
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();
    await dialog(page).getByRole('button', { name: 'Looks good' }).click();
    await clickImage(page, tilted([150, 450]));
    const originCard = dialog(page).locator('.fi-card').nth(2);
    await expect(originCard).toHaveClass(/done/);
    await expect(dialog(page).locator('svg.fi-svg .fi-origin')).toHaveCount(1);
    await undo.click();
    await expect(originCard).not.toHaveClass(/done/);
    await expect(dialog(page).locator('svg.fi-svg .fi-origin')).toHaveCount(0);
    await page.keyboard.press('Control+Shift+z');
    await expect(originCard).toHaveClass(/done/);
    await expect(dialog(page).locator('svg.fi-svg .fi-origin')).toHaveCount(1);

    // The opacity slider: the image shows at it, and the plan view uses it afterwards
    const slider = dialog(page).getByLabel('Floor plan opacity');
    await expect(slider).toHaveValue('1');
    await slider.fill('0.4');
    await expect(dialog(page).locator('svg.fi-svg g[opacity]').first()).toHaveAttribute('opacity', '0.4');
    await card(page).getByRole('button', { name: 'Next', exact: true }).click();
    await scaleBy(page, tilted([150, 450]), tilted([650, 450]), '5');
    await card(page).getByRole('button', { name: 'Next', exact: true }).click();
    await card(page).getByRole('button', { name: 'Auto-detect' }).click();
    await dialog(page).getByRole('alertdialog', { name: 'Detect the outline of…' }).getByRole('button', { name: 'Whole space' }).click();
    // The tilted plan's whole space may or may not close; Keep tracing instead if not
    const ask = dialog(page).getByRole('alertdialog', { name: 'Detect the outline of…' });
    const rows = dialog(page).locator('.vertex-row');
    await expect(rows.or(ask.getByRole('alert'))).not.toHaveCount(0);
    if (await ask.isVisible()) {
      await ask.getByRole('button', { name: 'Trace instead' }).click();
      const canvas = dialog(page).getByRole('application', { name: 'Outline canvas' });
      const box = (await canvas.boundingBox())!;
      const x0 = box.x + box.width * 0.3, y0 = box.y + box.height * 0.7;
      for (const [dx, dy] of [[0, 0], [120, 0], [120, -90], [0, -90]] as [number, number][]) await page.mouse.click(x0 + dx, y0 + dy);
      await card(page).getByRole('button', { name: 'Finish' }).click();
    }
    await expect(dialog(page).locator('g.fi-plan-image')).toHaveAttribute('opacity', '0.4');
    await page.getByRole('button', { name: 'Create room' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(planSvg(page).locator('image.plan-image')).toHaveAttribute('opacity', '0.4');
  });

  test('the main editor shows the floor plan file as the lamp files are: its name, Edit and Remove', async ({ page }) => {
    await upload(page);
    await quickSetup(page);
    await card(page).getByRole('button', { name: 'Auto-detect' }).click();
    await dialog(page).getByRole('alertdialog', { name: 'Detect the outline of…' }).getByRole('button', { name: 'One room' }).click();
    await expect(pickPrompt(page)).toBeVisible();
    // Not in the left column
    await expect(card(page).getByText('Click inside a room')).toHaveCount(0);
    // Cancel on the prompt: no pick
    await pickPrompt(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(pickPrompt(page)).toHaveCount(0);
    await card(page).getByRole('button', { name: 'Manual trace' }).click();
    const canvas = dialog(page).getByRole('application', { name: 'Outline canvas' });
    const box = (await canvas.boundingBox())!;
    const x0 = box.x + box.width * 0.3, y0 = box.y + box.height * 0.7;
    for (const [dx, dy] of [[0, 0], [120, 0], [120, -90], [0, -90]] as [number, number][]) await page.mouse.click(x0 + dx, y0 + dy);
    await card(page).getByRole('button', { name: 'Finish' }).click();
    await page.getByRole('button', { name: 'Create room' }).click();
    await expect(dialog(page)).toHaveCount(0);

    const box2 = page.locator('.floorplan-part').getByRole('group', { name: 'Floor plan file' });
    await expect(box2.locator('.file-box')).toBeVisible();
    await expect(box2).toContainText('floorplan-tilted.png');
    await expect(box2.getByRole('button', { name: /Upload/ })).toHaveCount(0);
    await expect(page.locator('.floorplan-part').getByRole('slider')).toHaveCount(0);
    // Edit reopens the window on it
    await box2.getByRole('button', { name: 'Edit' }).click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).locator('.fi-card').nth(0)).toHaveClass(/done/);
    await expect(card(page)).toContainText('Align axes');
    await dialog(page).getByTitle('Close').click();
    await expect(dialog(page)).toHaveCount(0);
    // Remove asks first
    await box2.getByRole('button', { name: 'Remove' }).click();
    const confirm = page.getByRole('dialog', { name: 'Remove the floor plan file?' });
    await confirm.getByRole('button', { name: 'Remove' }).click();
    await expect(planSvg(page).locator('image.plan-image')).toHaveCount(0);
    await expect(box2.getByRole('button', { name: /Upload floor plan file/ })).toBeVisible();
  });

  test('a failed detection says so in the Auto-detect dialog: another spot, the other mode, trace instead, or cancel', async ({ page }) => {
    await upload(page);
    // Looks good on the 4° tilted plan: its door gap runs off the axes, so nothing closes the room
    await quickSetup(page);
    const ask = dialog(page).getByRole('alertdialog', { name: 'Detect the outline of…' });
    const miss = async (spot: [number, number]) => {
      // The dialog is out of the way while a spot is picked
      await expect(ask).toHaveCount(0);
      await expect(pickPrompt(page)).toContainText('Click inside a room to detect it');
      await clickImage(page, tilted(spot));
      await expect(ask.getByRole('alert')).toHaveText('No room found there.');
    };
    await card(page).getByRole('button', { name: 'Auto-detect' }).click();
    await ask.getByRole('button', { name: 'One room' }).click();
    await miss([450, 220]);
    await expect(ask.getByRole('button', { name: 'Whole space' })).toBeVisible();
    await expect(ask.getByRole('button', { name: 'Trace instead' })).toBeVisible();
    await expect(ask.getByRole('button', { name: 'Cancel' })).toBeVisible();
    // No notice at the bottom of the window
    await expect(dialog(page).locator('.fi-notice')).toHaveCount(0);
    // Another spot: the dialog closes for the click and reopens on a miss
    await ask.getByRole('button', { name: 'Another spot' }).click();
    await miss([40, 40]);
    // The other mode
    await ask.getByRole('button', { name: 'Whole space' }).click();
    await expect(ask.getByRole('alert')).toHaveText('No outline found.');
    await expect(ask.getByRole('button', { name: 'Whole space' })).toHaveCount(0);
    await expect(ask.getByRole('button', { name: 'One room' })).toBeVisible();

    // Trace instead: drawing starts
    await ask.getByRole('button', { name: 'Trace instead' }).click();
    await expect(ask).toHaveCount(0);
    await expect(card(page).getByRole('status')).toHaveText('Click on the image to place the first vertex.');
    await expect(card(page).getByRole('button', { name: 'Manual trace' })).toHaveAttribute('aria-pressed', 'true');

    // Cancel after a miss: back to the choice
    await page.keyboard.press('Escape');
    await card(page).getByRole('button', { name: 'Auto-detect' }).click();
    await ask.getByRole('button', { name: 'One room' }).click();
    await miss([450, 220]);
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(ask).toHaveCount(0);
    await expect(card(page).getByRole('button', { name: 'Auto-detect' })).toHaveAttribute('aria-pressed', 'false');
    await expect(card(page).getByRole('button', { name: 'Manual trace' })).toHaveAttribute('aria-pressed', 'false');
  });

  // The user's bedroom plan (a consumer floor-plan export, dimensions in inches): user report "auto-detect still fails"
  for (const unit of ['inches', 'meters'] as const) {
    test(`the user's bedroom plan, scale typed in ${unit}: One room from anywhere in it, and Whole space, find its 8 corners`, async ({ page }) => {
      await bedroomSetup(page, unit);
      const rows = dialog(page).locator('.vertex-row');
      const ask = dialog(page).getByRole('alertdialog', { name: 'Detect the outline of…' });
      // The bed, the desk area, open floor, by the door, by the stub wall
      for (const spot of [[190, 360], [470, 420], [600, 330], [800, 250], [650, 500]] as [number, number][]) {
        await card(page).getByRole('button', { name: 'Auto-detect' }).click();
        await ask.getByRole('button', { name: 'One room' }).click();
        await clickImage(page, spot);
        await expect(rows, `clicked at ${spot}`).toHaveCount(8);
        await card(page).getByRole('button', { name: 'Redo' }).click();
        await expect(rows).toHaveCount(0);
      }
      await card(page).getByRole('button', { name: 'Auto-detect' }).click();
      await ask.getByRole('button', { name: 'Whole space' }).click();
      await expect(rows).toHaveCount(8);
      await expect(ask).toHaveCount(0);
    });
  }

  test('the units select changes the vertex table', async ({ page }) => {
    await upload(page);
    await detectRoom(page);
    const xs = () => dialog(page).locator('.vertex-row').evaluateAll((els) => els.map((r) => Number((r.querySelector('input') as HTMLInputElement).value)));
    expect(Math.max(...(await xs()))).toBeCloseTo(5, 1);
    await dialog(page).getByTitle('Units').selectOption('centimeters');
    await expect.poll(async () => Math.max(...(await xs()))).toBeGreaterThan(490);
    expect(Math.max(...(await xs()))).toBeLessThan(510);
  });
});
