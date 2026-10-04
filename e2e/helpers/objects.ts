import { type Page, expect } from '@playwright/test';
import { waitForApiIdle } from './network';

const API_BASE = 'http://localhost:8000/api/v1';

/** Ensure the Objects panel is expanded. */
export async function expandObjectsPanel(page: Page): Promise<void> {
  // Guided layout: objects sit inside the Room step. Expert layout: their own panel.
  const addRow = page.locator('.add-object-row');
  if (await addRow.isVisible().catch(() => false)) return;
  for (const title of ['Room', 'Objects']) {
    const header = page.locator('.panel-header').filter({ hasText: title });
    if (!(await header.count())) continue;
    const content = header.locator('..').locator('.panel-content');
    if (!(await content.isVisible().catch(() => false))) await header.click();
    if (await addRow.isVisible().catch(() => false)) return;
  }
  await expect(addRow).toBeVisible();
}

/** Add a new box object; its editor opens inline. */
export async function addObject(page: Page): Promise<void> {
  await expandObjectsPanel(page);
  await page.locator('button:has-text("Add box")').click();
  await expect(page.locator('.item-list-item[data-object-id] .inline-editor').last()).toBeVisible({ timeout: 15_000 });
  await waitForApiIdle(page);
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
