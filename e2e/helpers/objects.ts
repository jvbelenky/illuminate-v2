import { type Page, expect } from '@playwright/test';
import { waitForApiIdle } from './network';

const API_BASE = 'http://localhost:8000/api/v1';

/** Ensure the Objects panel is expanded. */
export async function expandObjectsPanel(page: Page): Promise<void> {
  // Guided layout: objects sit inside the Room step. Expert layout: their own panel.
  const addRow = page.locator('button.add-object-btn');
  if (await addRow.isVisible().catch(() => false)) return;
  for (const title of ['Floorplan', 'Obstacles']) {
    const header = page.locator('.panel-header').filter({ hasText: title });
    if (!(await header.count())) continue;
    const content = header.locator('..').locator('.panel-content');
    if (!(await content.isVisible().catch(() => false))) await header.click();
    if (await addRow.isVisible().catch(() => false)) return;
  }
  await expect(addRow).toBeVisible();
}

/**
 * Add an object by drawing a rectangle on the plan canvas (the only way the
 * sidebar offers), then open its editor. The rectangle covers the middle of
 * the canvas so it lands inside any room.
 */
export async function addObject(page: Page): Promise<void> {
  await expandObjectsPanel(page);
  const before = await objectCount(page);
  await page.locator('button:has-text("Add obstacle")').click();
  const modal = page.locator('.floor-plan-modal');
  await expect(modal).toBeVisible();
  const plan = modal.locator('svg.plan');
  await expect(modal.locator('svg.plan.drawing')).toHaveCount(1);
  const box = await plan.boundingBox();
  if (!box) throw new Error('plan canvas not visible');
  const corners: [number, number][] = [[0.4, 0.6], [0.6, 0.6], [0.6, 0.4], [0.4, 0.4]];
  for (const [fx, fy] of corners) {
    await plan.click({ position: { x: box.width * fx, y: box.height * fy } });
  }
  await page.keyboard.press('Enter');
  await expect(modal.locator('.obstacle-row')).toHaveCount(before + 1);
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(modal).toHaveCount(0);
  await expect.poll(() => objectCount(page)).toBe(before + 1);
  await waitForApiIdle(page);
  const item = page.locator('.item-list-item[data-object-id]').last();
  if (!(await item.locator('.inline-editor').isVisible().catch(() => false))) {
    await item.locator('.item-list-row').click();
  }
  await expect(item.locator('.inline-editor')).toBeVisible({ timeout: 5_000 });
}

/** Count objects currently in the list. */
export async function objectCount(page: Page): Promise<number> {
  return page.locator('.item-list-item[data-object-id]').count();
}

/** Click an object list item to open its editor. */
export async function selectObject(page: Page, index: number = 0): Promise<void> {
  await expandObjectsPanel(page);
  const item = page.locator('.item-list-item[data-object-id]').nth(index);
  await item.locator('.item-list-row').click();
  await expect(item.locator('.inline-editor')).toBeVisible({ timeout: 5_000 });
}

/** Commit a numeric field of the open object editor (ids like object-width, object-x, object-yaw). */
export async function setObjectField(page: Page, field: string, value: number): Promise<void> {
  // Bottom and Top are hidden while the obstacle is floor to ceiling
  if (field === 'bottom' || field === 'top') {
    const full = page.locator('.inline-editor input#object-full-height');
    if (await full.isChecked().catch(() => false)) await full.uncheck();
  }
  const input = page.locator(`.inline-editor input#object-${field}`);
  await input.click({ clickCount: 3 });
  await input.fill(String(value));
  await input.press('Tab');
  await waitForApiIdle(page);
}

/** Remove an object through its row delete button and the confirm dialog. */
export async function removeObject(page: Page, index: number = 0): Promise<void> {
  const item = page.locator('.item-list-item[data-object-id]').nth(index);
  await item.locator('button[aria-label*="Delete"]').click();
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
