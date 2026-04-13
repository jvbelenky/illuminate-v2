import { type Page, expect } from '@playwright/test';

const API_BASE = 'http://localhost:8000/api/v1';

/** Fetch all zones from the backend API. */
export async function getZonesFromBackend(page: Page): Promise<Record<string, any>[]> {
  const response = await page.request.get(`${API_BASE}/session/zones`, {
    headers: { 'X-Session-Id': await getSessionId(page) },
  });
  expect(response.ok()).toBe(true);
  const data = await response.json();
  return data.zones;
}

/** Read lamp instances from the frontend Svelte store. */
export async function getLampsFromStore(page: Page): Promise<Record<string, any>[]> {
  return page.evaluate(() => {
    const storeModule = (window as any).__illuminate_store__;
    if (!storeModule) throw new Error('Store not exposed on window');
    return JSON.parse(JSON.stringify(storeModule.lamps));
  });
}

/**
 * Compare two objects, asserting all fields match except excluded keys.
 * Throws descriptive assertion errors for mismatched fields.
 */
export function assertObjectsMatch(
  original: Record<string, any>,
  copy: Record<string, any>,
  excludeKeys: string[]
): void {
  const allKeys = new Set([...Object.keys(original), ...Object.keys(copy)]);
  for (const key of allKeys) {
    if (excludeKeys.includes(key)) continue;
    const origVal = JSON.stringify(original[key]);
    const copyVal = JSON.stringify(copy[key]);
    expect(copyVal, `Field "${key}" should match: original=${origVal}`).toBe(origVal);
  }
}

/** Get the session ID from the page's session state. */
async function getSessionId(page: Page): Promise<string> {
  return page.evaluate(() => {
    return (window as any).__illuminate_store__?.sessionId ?? '';
  });
}
