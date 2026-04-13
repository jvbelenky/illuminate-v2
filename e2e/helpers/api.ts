import { type Page, expect } from '@playwright/test';

const API_BASE = 'http://localhost:8000/api/v1';

/** Fetch all zones from the backend API. */
export async function getZonesFromBackend(page: Page): Promise<Record<string, any>[]> {
  const { sessionId, token } = await getSessionCredentials(page);
  const headers: Record<string, string> = { 'X-Session-ID': sessionId };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await page.request.get(`${API_BASE}/session/zones`, { headers });
  expect(response.ok(), `GET /session/zones failed (status ${response.status()}): sessionId=${sessionId.slice(0, 8)}...`).toBe(true);
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

/** Get session credentials from the page's exposed store. */
async function getSessionCredentials(page: Page): Promise<{ sessionId: string; token: string }> {
  return page.evaluate(() => {
    const store = (window as any).__illuminate_store__;
    return {
      sessionId: store?.sessionId ?? '',
      token: store?.token ?? '',
    };
  });
}
