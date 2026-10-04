import { test, expect } from '../fixtures';
import { waitForSession } from '../helpers/session';
import { waitForApiIdle } from '../helpers/network';
import { addLampFromPreset } from '../helpers/lamps';
import { calculate } from '../helpers/calculations';
import {
  addObject, objectCount, selectObject, setObjectField, removeObject, expandObjectsPanel,
  getObjectsFromBackend, getObjectsFromStore,
} from '../helpers/objects';

test.describe('Objects (obstacles)', () => {
  test.beforeEach(async ({ page }) => {
    await waitForSession(page);
  });

  test('add, edit, toggle and delete an object; backend mirrors the store', async ({ page }) => {
    await addObject(page);
    expect(await objectCount(page)).toBe(1);

    let backend = await getObjectsFromBackend(page);
    expect(backend).toHaveLength(1);
    expect(backend[0].id).toMatch(/^object-\d+$/);
    // Objects are drawn, so they are extruded polygons
    expect(backend[0].shape).toBe('extrusion');

    // Edit size, position and rotation through the inline editor
    await setObjectField(page, 'width', 2);
    await setObjectField(page, 'x', 1.5);
    await setObjectField(page, 'yaw', 45);
    backend = await getObjectsFromBackend(page);
    expect(backend[0].width).toBeCloseTo(2, 6);
    expect(backend[0].x).toBeCloseTo(1.5, 6);
    expect(backend[0].yaw).toBeCloseTo(45, 6);

    // Reflectance and transmittance travel together
    await setObjectField(page, 'reflectance', 0.3);
    await setObjectField(page, 'transmittance', 0.5);
    backend = await getObjectsFromBackend(page);
    expect(backend[0].reflectance).toBeCloseTo(0.3, 6);
    expect(backend[0].transmittance).toBeCloseTo(0.5, 6);

    // Exclude from calculation via the row toggle
    const row = page.locator('.item-list-item[data-object-id]').first();
    await row.locator('button[aria-label*="Exclude"]').click();
    await expect.poll(async () => (await getObjectsFromBackend(page))[0].enabled).toBe(false);

    const store = await getObjectsFromStore(page);
    expect(store[0].enabled).toBe(false);
    expect(store[0].width).toBeCloseTo(2, 6);

    // Delete
    await removeObject(page);
    expect(await objectCount(page)).toBe(0);
    expect(await getObjectsFromBackend(page)).toHaveLength(0);
  });

  test('copy makes a second object with the same geometry under a new id', async ({ page }) => {
    await addObject(page);
    await setObjectField(page, 'top', 1.8);
    await page.locator('.inline-editor .editor-actions button').filter({ hasText: 'Copy' }).click();
    await expect.poll(() => objectCount(page)).toBe(2);
    const backend = await getObjectsFromBackend(page);
    expect(backend.map((o) => o.id).sort()).toEqual(['object-1', 'object-2']);
    expect(backend[1].height).toBeCloseTo(1.8, 6);
    expect(backend[1].name).toMatch(/Copy/);
  });

  test('renders in the 3D view and a click selects it', async ({ page }, testInfo) => {
    await addObject(page);
    await setObjectField(page, 'width', 1.5);
    // Put it at the room centre, where the default view looks
    await setObjectField(page, 'x', 2);
    await setObjectField(page, 'y', 3);
    // Close the editor so the click-to-select can be observed
    await page.locator('.inline-editor .close-x').click();
    await expect(page.locator('.item-list-item[data-object-id] .inline-editor')).toHaveCount(0);

    const canvas = page.locator('.viewer-container canvas').first();
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    // The default view looks at the room centre, where the object stands
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2 + 20);
    await expect(page.locator('.item-list-item[data-object-id] .inline-editor')).toHaveCount(1, { timeout: 5_000 });

    await page.screenshot({ path: testInfo.outputPath('object-3d.png') });
  });

  test('an object shadows the floor: the mean result drops while it is enabled', async ({ page }) => {
    test.setTimeout(120_000);
    await addLampFromPreset(page);
    await page.locator('.inline-editor .close-x').click();

    // Mean of every finite value across all calculated zones, from the dev store
    const meanResult = () => page.evaluate(() => {
      const results = (window as any).__illuminate_store__?.results;
      if (!results?.zones) return null;
      let sum = 0, n = 0;
      const walk = (v: unknown) => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (typeof v === 'number' && Number.isFinite(v)) { sum += v; n++; }
      };
      for (const z of Object.values(results.zones as Record<string, { values?: unknown }>)) walk(z.values);
      return n ? sum / n : null;
    });

    await calculate(page);
    const before = await meanResult();
    expect(before).not.toBeNull();
    expect(before!).toBeGreaterThan(0);

    await addObject(page);
    // A wide slab just under the ceiling casts a large shadow over the room
    await setObjectField(page, 'width', 3);
    await setObjectField(page, 'length', 3);
    // A thin slab near the ceiling: top first so the bottom move keeps a 0.2 thickness
    await setObjectField(page, 'top', 2.2);
    await setObjectField(page, 'bottom', 2.0);
    await page.locator('.inline-editor .close-x').click();

    // Adding the object marks the results stale
    await expect(page.locator('button.calculate-btn')).not.toHaveClass(/up-to-date/);

    await calculate(page);
    const withObject = await meanResult();
    expect(withObject!).toBeLessThan(before!);

    // Disabling the object restores the unobstructed result
    await page.locator('.item-list-item[data-object-id] button[aria-label*="Exclude"]').first().click();
    await expect(page.locator('button.calculate-btn')).not.toHaveClass(/up-to-date/);
    await calculate(page);
    const disabled = await meanResult();
    expect(disabled!).toBeCloseTo(before!, 6);
  });
  test('save and load keeps objects, including an edited one', async ({ page }) => {
    test.setTimeout(90_000);
    await addObject(page);
    await setObjectField(page, 'width', 2.5);
    await setObjectField(page, 'yaw', 15);
    await setObjectField(page, 'reflectance', 0.4);
    await page.locator('.inline-editor .close-x').click();
    await addObject(page);
    await page.locator('.inline-editor .close-x').click();
    expect(await objectCount(page)).toBe(2);

    // --- Save ---
    const fileMenu = page.locator('.menu-bar-item').filter({ hasText: 'File' }).locator('span[role="button"]');
    await fileMenu.click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('div[role="menuitem"]:has-text("Save")').click(),
    ]);
    const filePath = await download.path();
    expect(filePath).toBeTruthy();

    // --- Change the live state, then load the file over it ---
    // (navigating keeps the tab's sessionStorage, so the project is not reset;
    // deleting one object makes the load observable)
    await removeObject(page, 1);
    expect(await objectCount(page)).toBe(1);
    await page.locator('input#load-file').setInputFiles(filePath!);
    await expect.poll(() => objectCount(page), { timeout: 15_000 }).toBe(2);

    const backend = await getObjectsFromBackend(page);
    const first = backend.find((o) => o.id === 'object-1')!;
    expect(first.width).toBeCloseTo(2.5, 6);
    expect(first.yaw).toBeCloseTo(15, 6);
    expect(first.reflectance).toBeCloseTo(0.4, 6);
    const store = await getObjectsFromStore(page);
    expect(store.map((o) => o.id).sort()).toEqual(['object-1', 'object-2']);
    expect(store.find((o) => o.id === 'object-1')!.width).toBeCloseTo(2.5, 6);

    // The loaded objects render and are editable: a new object gets the next free id
    await addObject(page);
    expect((await getObjectsFromBackend(page)).map((o) => o.id).sort()).toEqual(['object-1', 'object-2', 'object-3']);
  });
  test('draw an L-shaped object on the plan canvas', async ({ page }) => {
    await expandObjectsPanel(page);
    const drawBtn = page.locator('button:has-text("Add object")');
    if (!(await drawBtn.isVisible().catch(() => false))) {
      await expandObjectsPanel(page);
    }
    await drawBtn.click();
    const modal = page.locator('.footprint-modal');
    await expect(modal).toBeVisible();
    const plan = modal.locator('svg.plan');
    await expect(modal.locator('svg.plan.drawing')).toHaveCount(1);
    const box = await plan.boundingBox();
    if (!box) throw new Error('plan canvas not visible');
    // Six corners of an L, well apart so snapping cannot merge them
    const corners: [number, number][] = [[0.2, 0.8], [0.6, 0.8], [0.6, 0.55], [0.4, 0.55], [0.4, 0.3], [0.2, 0.3]];
    for (const [fx, fy] of corners) {
      await plan.click({ position: { x: box.width * fx, y: box.height * fy } });
    }
    await page.keyboard.press('Enter');
    await expect(modal.locator('.vertex-row')).toHaveCount(6);
    const nameInput = modal.locator('#footprint-name');
    await nameInput.fill('Counter');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(modal).toHaveCount(0);

    await expect.poll(() => objectCount(page)).toBe(1);
    const backend = await getObjectsFromBackend(page);
    expect(backend[0].shape).toBe('extrusion');
    expect(backend[0].vertices).toHaveLength(6);
    expect(backend[0].name).toBe('Counter');
    expect(backend[0].yaw).toBe(0);
    // The footprint sits where it was drawn: inside the room, not at the origin
    expect(backend[0].x).toBeGreaterThan(0);
    expect(backend[0].y).toBeGreaterThan(0);
    expect(backend[0].width).toBeGreaterThan(0.5);
  });

  test('edit footprint keeps the object, its size and its place', async ({ page }) => {
    await addObject(page);
    await setObjectField(page, 'width', 2);
    await setObjectField(page, 'length', 1);
    const before = (await getObjectsFromBackend(page))[0];
    await page.locator('.inline-editor button:has-text("Edit footprint")').click();
    const modal = page.locator('.footprint-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.vertex-row')).toHaveCount(4);
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(modal).toHaveCount(0);

    await waitForApiIdle(page);
    const after = (await getObjectsFromBackend(page))[0];
    expect(after.id).toBe(before.id);
    expect(after.shape).toBe('extrusion');
    expect(after.vertices).toHaveLength(4);
    expect(after.width).toBeCloseTo(before.width, 6);
    expect(after.length).toBeCloseTo(before.length, 6);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});
