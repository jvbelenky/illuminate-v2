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
const C: [number, number] = [400, 300];
/** A point of the drawing before the tilt -> its image pixel (turned 4° clockwise on screen). */
function tilted([x, y]: [number, number]): [number, number] {
  const r = (4 * Math.PI) / 180;
  const dx = x - C[0], dy = y - C[1];
  return [C[0] + dx * Math.cos(r) - dy * Math.sin(r), C[1] + dx * Math.sin(r) + dy * Math.cos(r)];
}

function dialog(page: Page) {
  return page.getByRole('dialog', { name: 'Floor plan from image' });
}

/** Click an image pixel of the window's image, wherever the view puts it (rotation included). */
async function clickImage(page: Page, p: [number, number]) {
  const [x, y] = await page.locator('.fi-image').evaluate((el, [px, py]) => {
    const m = (el as SVGGraphicsElement).getScreenCTM()!;
    const q = new DOMPoint(px, py).matrixTransform(m);
    return [q.x, q.y];
  }, p);
  await page.mouse.click(x, y);
}

async function upload(page: Page) {
  await waitForSession(page);
  await expandRoomPanel(page);
  await page.locator('.floorplan-part input[type="file"]').setInputFiles(FIXTURE);
  await expect(dialog(page)).toBeVisible();
}

/** Steps 1-3 (straighten, origin, scale), then Auto-detect on the room; ends with the four vertex rows shown. */
async function detectRoom(page: Page) {
  // 1. Straighten: two clicks along the top wall's inner face
  await clickImage(page, tilted([170, 150]));
  await clickImage(page, tilted([630, 150]));
  await expect.poll(async () => Number(await page.locator('svg.fi-svg').getAttribute('data-rotation'))).toBeCloseTo(-4, 3);
  await page.getByRole('button', { name: 'Next →' }).click();

  // 2. The origin on the bottom-left inner corner
  await clickImage(page, tilted([150, 450]));
  await expect(dialog(page).getByRole('status')).toHaveText('Origin placed. Drag it to adjust, or press Next.');
  await page.getByRole('button', { name: 'Next →' }).click();

  // 3. Scale: the bottom wall, 5 m
  await clickImage(page, tilted([150, 450]));
  await clickImage(page, tilted([650, 450]));
  await page.locator('#fi-distance').fill('5');
  await expect(dialog(page).getByRole('button', { name: /Set scale\s*100 px\/m/ })).toBeVisible();
  await page.getByRole('button', { name: 'Next →' }).click();

  // 4. Auto-detect: click inside the room
  await dialog(page).getByRole('button', { name: 'Auto-detect', exact: true }).click();
  await expect(dialog(page).getByRole('status')).toHaveText('Click inside the room to detect it.');
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
    await expect(dialog(page).locator('svg.fi-svg polygon.fi-iwall')).toHaveCount(1);
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
    await dialog(page).locator('svg.fi-svg polygon.fi-iwall').click();
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
    await expect(dialog(page).getByRole('status')).toHaveText('Click or drag to place the origin (0, 0).');
    await page.getByRole('button', { name: 'Next →' }).click();
    const prompt = page.getByRole('alertdialog', { name: 'Set the origin first' });
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: 'OK' }).click();
    await expect(prompt).toHaveCount(0);
    await expect(dialog(page).locator('.fi-step.on')).toContainText('Set origin');
    // A later step card asks the same
    await dialog(page).getByRole('button', { name: /Trace outline/ }).click();
    await expect(page.getByRole('alertdialog', { name: 'Set the origin first' })).toBeVisible();
  });
});
