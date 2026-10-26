import { test, expect } from '../fixtures';
import { waitForSession } from '../helpers/session';
import { waitForApiIdle } from '../helpers/network';
import { finishEditing, planTool } from '../helpers/workspace';
import { addLampFromPreset } from '../helpers/lamps';
import { calculate } from '../helpers/calculations';
import {
  addObject, closeObjectEditor, drawObject, objectEditor, objectCount, objectField, openObjectFold, selectObject, setObjectField, removeObject, expandObjectsPanel,
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
    // "+ Add structure" drops a box
    expect(backend[0].shape).toBe('box');

    // Edit size, position and rotation through the inline editor
    await setObjectField(page, 'width', 2);
    await setObjectField(page, 'x', 1.5);
    await setObjectField(page, 'yaw', 45);
    backend = await getObjectsFromBackend(page);
    expect(backend[0].width).toBeCloseTo(2, 6);
    expect(backend[0].x).toBeCloseTo(1.5, 6);
    expect(backend[0].yaw).toBeCloseTo(45, 6);

    // Pitch and roll sit beside Rotation in Geometry
    await setObjectField(page, 'pitch', 10);
    await setObjectField(page, 'roll', -5);
    backend = await getObjectsFromBackend(page);
    expect(backend[0].pitch).toBeCloseTo(10, 6);
    expect(backend[0].roll).toBeCloseTo(-5, 6);

    // Exclude from calculation via the row toggle
    const row = page.locator('.structures-part .editor-row').first();
    await row.locator('button[aria-label*="Exclude"]').click();
    await expect.poll(async () => (await getObjectsFromBackend(page))[0].enabled).toBe(false);

    const store = await getObjectsFromStore(page);
    expect(store[0].enabled).toBe(false);
    expect(store[0].width).toBeCloseTo(2, 6);

    // Delete (the 2D toolbar)
    await removeObject(page);
    expect(await objectCount(page)).toBe(0);
    expect(await getObjectsFromBackend(page)).toHaveLength(0);
  });

  test('copy makes a second object with the same geometry under a new id; the Delete key removes one', async ({ page }) => {
    await addObject(page);
    await setObjectField(page, 'top', 1.8);
    await planTool(page, 'Copy').click();
    await expect.poll(() => objectCount(page)).toBe(2);
    await waitForApiIdle(page);
    const backend = await getObjectsFromBackend(page);
    expect(backend.map((o) => o.id).sort()).toEqual(['object-1', 'object-2']);
    expect(backend[1].height).toBeCloseTo(1.8, 6);
    expect(backend[1].name).not.toBe(backend[0].name);

    // The copy is selected; the Delete key over the plan removes it
    await page.locator('.plan-pane svg.plan').hover();
    await page.keyboard.press('Delete');
    await expect.poll(() => objectCount(page)).toBe(1);
    await waitForApiIdle(page);
    expect((await getObjectsFromBackend(page)).map((o) => o.id)).toEqual(['object-1']);
  });

  test('Show label puts the name on the plan; undo turns it off', async ({ page }) => {
    await addObject(page);
    const name = (await getObjectsFromStore(page))[0].name;
    await expect(page.locator('.plan-pane text.shape-label')).toHaveCount(0);
    await openObjectFold(page, 'Display');
    await objectEditor(page).getByLabel('Show label').check();
    await expect(page.locator('.plan-pane text.shape-label')).toHaveText([name]);
    // Undo turns it off again (keys aimed at the page, not at the checkbox)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Control+z');
    await expect(page.locator('.plan-pane text.shape-label')).toHaveCount(0);
    await page.keyboard.press('Control+Shift+z');
    await expect(page.locator('.plan-pane text.shape-label')).toHaveText([name]);
  });

  test('renders in the 3D view and a click selects it', async ({ page }, testInfo) => {
    await addObject(page);
    await setObjectField(page, 'width', 1.5);
    // Put it at the room centre, where the default view looks
    await setObjectField(page, 'x', 2);
    await setObjectField(page, 'y', 3);
    // Close the editor so the click-to-select can be observed
    await closeObjectEditor(page);
    await expect(page.locator('.structures-part .editor-row.open')).toHaveCount(0);

    const canvas = page.locator('.viewer-container canvas').first();
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    // The default view looks at the room centre, where the object stands
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2 + 20);
    await expect(page.locator('.structures-part .editor-row.open')).toHaveCount(1, { timeout: 5_000 });

    await page.screenshot({ path: testInfo.outputPath('object-3d.png') });
  });

  test('an object shadows the floor: the mean result drops while it is enabled', async ({ page }) => {
    await addLampFromPreset(page);
    await page.locator('.editor-row.open .close-x').click();

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
    await closeObjectEditor(page);

    // Adding the object marks the results stale
    await expect(page.locator('button.calculate-btn')).not.toHaveClass(/up-to-date/);

    await calculate(page);
    const withObject = await meanResult();
    expect(withObject!).toBeLessThan(before!);

    // Disabling the object restores the unobstructed result
    await page.locator('.structures-part .editor-row button[aria-label*="Exclude"]').first().click();
    await expect(page.locator('button.calculate-btn')).not.toHaveClass(/up-to-date/);
    await calculate(page);
    const disabled = await meanResult();
    expect(disabled!).toBeCloseTo(before!, 6);
  });
  test('save and load keeps objects, including an edited one', async ({ page }) => {
    await addObject(page);
    await setObjectField(page, 'width', 2.5);
    await setObjectField(page, 'yaw', 15);
    await openObjectFold(page, 'Display');
    await objectEditor(page).getByLabel('Show label').check();
    await closeObjectEditor(page);
    await addObject(page);
    await closeObjectEditor(page);
    expect(await objectCount(page)).toBe(2);

    // --- Save ---
    const fileMenu = page.locator('.menu-bar-item').filter({ hasText: 'File' }).locator('span[role="button"]');
    await fileMenu.click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'Save', exact: true }).click(),
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
    const store = await getObjectsFromStore(page);
    // The label came back with the file
    await expect(page.locator('.plan-pane text.shape-label')).toHaveCount(1);
    expect(store.map((o) => o.id).sort()).toEqual(['object-1', 'object-2']);
    expect(store.find((o) => o.id === 'object-1')!.width).toBeCloseTo(2.5, 6);

    // The loaded objects render and are editable: a new object gets the next free id
    await addObject(page);
    expect((await getObjectsFromBackend(page)).map((o) => o.id).sort()).toEqual(['object-1', 'object-2', 'object-3']);
  });
  test('draw an L-shaped object on the plan canvas', async ({ page }) => {
    // Six corners of an L, well apart so snapping cannot merge them
    await drawObject(page, [[0.2, 0.8], [0.6, 0.8], [0.6, 0.55], [0.4, 0.55], [0.4, 0.3], [0.2, 0.3]]);
    const row = page.locator('.structures-part .editor-row');
    await expect(row).toHaveCount(1);

    // Rename it from the row's pencil
    if (!(await row.evaluate((el) => el.classList.contains('open')))) await row.locator('.row-main').click();
    await row.getByRole('button', { name: /^Rename / }).click();
    const nameInput = row.getByLabel('Name', { exact: true });
    await nameInput.fill('Counter');
    await nameInput.press('Enter');
    await expect(row.locator('.name')).toHaveText('Counter');

    await expect.poll(() => objectCount(page)).toBe(1);
    await expect.poll(async () => (await getObjectsFromBackend(page))[0]?.name).toBe('Counter');
    const backend = await getObjectsFromBackend(page);
    expect(backend[0].shape).toBe('extrusion');
    expect(backend[0].vertices).toHaveLength(6);
    expect(backend[0].yaw).toBe(0);
    // The footprint sits where it was drawn: inside the room, not at the origin
    expect(backend[0].x).toBeGreaterThan(0);
    expect(backend[0].y).toBeGreaterThan(0);
    expect(backend[0].width).toBeGreaterThan(0.5);
  });

  test('leaving the editor and coming back keeps the object, its size and its place', async ({ page }) => {
    await addObject(page);
    await setObjectField(page, 'width', 2);
    await setObjectField(page, 'length', 1);
    const before = (await getObjectsFromBackend(page))[0];

    // Done to the summary, then back into the structure
    await finishEditing(page);
    await selectObject(page, 0);
    await expect(await objectField(page, 'width')).toHaveValue(/^2(\.0+)?$/);

    // Looking is not editing: nothing was applied
    await waitForApiIdle(page);
    const after = (await getObjectsFromBackend(page))[0];
    expect(after.id).toBe(before.id);
    expect(after.shape).toBe(before.shape);
    expect(after.width).toBeCloseTo(before.width, 6);
    expect(after.length).toBeCloseTo(before.length, 6);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});
