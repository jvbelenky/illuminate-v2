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

/** Commit a numeric field of the open object editor (ids like object-width, object-x, object-yaw). */
export async function setObjectField(page: Page, field: string, value: number): Promise<void> {
  const editor = objectEditor(page);
  // Bottom and Top are hidden while the obstacle is floor to ceiling
  if (field === 'bottom' || field === 'top') {
    const full = editor.locator('input#object-full-height');
    if (await full.isChecked().catch(() => false)) await full.uncheck();
  }
  const input = editor.locator(`input#object-${field}`);
  await input.click({ clickCount: 3 });
  await input.fill(String(value));
  await input.press('Tab');
  await waitForApiIdle(page);
}

/** Remove an object through its editor's Delete button and the confirm dialog. */
export async function removeObject(page: Page, index: number = 0): Promise<void> {
  await selectObject(page, index);
  await objectEditor(page).locator('.editor-actions .delete-btn').click();
  const confirmBtn = page.locator('button.confirm-btn');
  await expect(confirmBtn).toBeVisible({ timeout: 2_000 });
  await confirmBtn.click();
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
