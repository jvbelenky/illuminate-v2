import { type Page, expect } from '@playwright/test';
import { waitForApiIdle } from './network';
import { clickPlan, openStep, planTool } from './workspace';

// Override to point the backend checks at a server on another port (e.g. a worktree).
const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1';

/** Open Room > Structures, where the obstacles are listed. */
export async function expandObjectsPanel(page: Page): Promise<void> {
  await openStep(page, 'room', 'structures');
  await expect(page.getByRole('button', { name: '+ Add structure' })).toBeVisible();
}

/** The structure rows in Room > Structures. */
function objectRows(page: Page) {
  return page.locator('.structures-part .editor-row');
}

/** The open structure's editor. */
export function objectEditor(page: Page) {
  return page.locator('.structures-part .editor-row.open .object-editor');
}

/**
 * Add an obstacle with "+ Add structure" (a default box in the room), which
 * opens its editor.
 */
export async function addObject(page: Page): Promise<void> {
  await expandObjectsPanel(page);
  const before = await objectCount(page);
  await page.getByRole('button', { name: '+ Add structure' }).click();
  await expect.poll(() => objectCount(page)).toBe(before + 1);
  await waitForApiIdle(page);
  await expect(objectEditor(page)).toBeVisible({ timeout: 5_000 });
}

/**
 * Draw an obstacle footprint on the 2D plan with the toolbar's Draw. The corners
 * (fractions of the canvas) default to a square over the middle of the plan.
 */
export async function drawObject(
  page: Page,
  corners: [number, number][] = [[0.4, 0.6], [0.6, 0.6], [0.6, 0.4], [0.4, 0.4]]
): Promise<void> {
  await expandObjectsPanel(page);
  const before = await objectCount(page);
  await planTool(page, 'Draw').click();
  await expect(page.locator('.plan-pane svg.plan.drawing')).toHaveCount(1);
  await clickPlan(page, corners, { close: true });
  await expect.poll(() => objectCount(page)).toBe(before + 1);
  await waitForApiIdle(page);
  // The drawn obstacle is selected; open its editor if the row is not open yet
  if ((await page.locator('.structures-part .editor-row.open').count()) === 0) {
    await objectRows(page).last().locator('.row-main').click();
  }
  await expect(objectEditor(page)).toBeVisible({ timeout: 5_000 });
}

/** Count objects in the project (read from the store, so any step can ask). */
export async function objectCount(page: Page): Promise<number> {
  return (await getObjectsFromStore(page)).length;
}

/** Click a structure row to open its editor. */
export async function selectObject(page: Page, index: number = 0): Promise<void> {
  await expandObjectsPanel(page);
  const row = objectRows(page).nth(index);
  if (!(await row.evaluate((el) => el.classList.contains('open')))) {
    await row.locator('.row-main').click();
  }
  await expect(row.locator('.object-editor')).toBeVisible({ timeout: 5_000 });
}

/** Close the open structure's editor by clicking its row header. */
export async function closeObjectEditor(page: Page): Promise<void> {
  await page.locator('.structures-part .editor-row.open .row-main').click();
  await expect(page.locator('.structures-part .editor-row.open')).toHaveCount(0);
}

/** The Geometry fold-out's fields, by the editor's field names. */
const GEOMETRY_FIELDS: Record<string, string> = {
  x: 'X', y: 'Y', width: 'Width', length: 'Length', yaw: 'Rotation', pitch: 'Pitch', roll: 'Roll',
};

/** Open a fold-out (Geometry, Display) of the open object editor, if it is closed. */
export async function openObjectFold(page: Page, name: 'Geometry' | 'Display'): Promise<void> {
  const disc = objectEditor(page).getByRole('button', { name, exact: true });
  if ((await disc.getAttribute('aria-expanded')) !== 'true') await disc.click();
  await expect(disc).toHaveAttribute('aria-expanded', 'true');
}

/** A field of the open object editor: bottom / top by id, the rest in Geometry by label. */
export async function objectField(page: Page, field: string) {
  const editor = objectEditor(page);
  const label = GEOMETRY_FIELDS[field];
  if (!label) return editor.locator(`input#object-${field}`);
  await openObjectFold(page, 'Geometry');
  return editor.getByLabel(label, { exact: true });
}

/** Commit a numeric field of the open object editor (bottom, top; x, y, width, length, yaw, pitch, roll). */
export async function setObjectField(page: Page, field: string, value: number): Promise<void> {
  const editor = objectEditor(page);
  // Bottom and Top are greyed out while the obstacle is floor to ceiling
  if (field === 'bottom' || field === 'top') {
    const full = editor.locator('input#object-full-height');
    if (await full.isChecked().catch(() => false)) await full.uncheck();
  }
  const input = await objectField(page, field);
  await input.click({ clickCount: 3 });
  await input.fill(String(value));
  await input.press('Tab');
  await waitForApiIdle(page);
}

/** Remove an object: select it, then the 2D toolbar's Delete (undo covers it; there is no confirm). */
export async function removeObject(page: Page, index: number = 0): Promise<void> {
  await selectObject(page, index);
  await planTool(page, 'Delete').click();
  await waitForApiIdle(page);
}

/** Fetch all objects from the backend API. */
export async function getObjectsFromBackend(page: Page): Promise<Record<string, any>[]> {
  const { sessionId, token } = await page.evaluate(() => {
    const store = (window as any).__illuminate_store__;
    return { sessionId: store?.sessionId ?? '', token: store?.token ?? '' };
  });
  const headers: Record<string, string> = { 'X-Session-ID': sessionId };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await page.request.get(`${API_BASE}/session/objects`, { headers });
  expect(response.ok(), `GET /session/objects failed (status ${response.status()})`).toBe(true);
  return (await response.json()).objects;
}

/** Read objects from the frontend Svelte store. */
export async function getObjectsFromStore(page: Page): Promise<Record<string, any>[]> {
  return page.evaluate(() => {
    const store = (window as any).__illuminate_store__;
    if (!store) throw new Error('Store not exposed on window');
    return JSON.parse(JSON.stringify(store.objects));
  });
}
