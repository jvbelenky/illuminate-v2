import { test, expect, type Page } from '@playwright/test';
import { waitForApiIdle } from '../helpers/network';
import { waitForSession } from '../helpers/session';
import { attachErrorGuard } from '../helpers/errors';
import { addZone, userZoneRows, zoneCount } from '../helpers/zones';
import { planSvg, planTool } from '../helpers/workspace';

const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1';

async function backendZones(page: Page): Promise<Record<string, any>[]> {
  const { sessionId, token } = await page.evaluate(() => {
    const store = (window as any).__illuminate_store__;
    return { sessionId: store?.sessionId ?? '', token: store?.token ?? '' };
  });
  const headers: Record<string, string> = { 'X-Session-ID': sessionId };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await page.request.get(`${API_BASE}/session/zones`, { headers });
  expect(response.ok()).toBe(true);
  return (await response.json()).zones;
}

// The Zones stage adds zones from the Add zone card; drawing a plane's outline
// on the plan comes later (polygon calc planes), so the plan's toolbar offers
// Copy and Delete for the selected zone.
test.describe('Calc zones in the workspace', () => {
  test('add a plane and a point, copy the point from the plan toolbar, delete it; the backend follows', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await waitForSession(page);

    await addZone(page, 'plane');
    await expect(userZoneRows(page)).toHaveCount(1);
    await addZone(page, 'point');
    await expect(userZoneRows(page)).toHaveCount(2);
    // The point shows on the plan as a marker
    await expect(planSvg(page).locator('circle.plan-lamp.point')).toHaveCount(1);

    let zones = (await backendZones(page)).filter((z) => !z.is_standard);
    expect(zones.some((z) => z.type === 'plane')).toBe(true);
    expect(zones.filter((z) => z.type === 'point')).toHaveLength(1);

    // The new point is selected: Copy makes a second one
    await planTool(page, 'Copy').click();
    await expect.poll(() => zoneCount(page)).toBe(3);
    await waitForApiIdle(page);
    zones = (await backendZones(page)).filter((z) => !z.is_standard);
    expect(zones.filter((z) => z.type === 'point')).toHaveLength(2);

    // Delete takes the selected copy away again
    await planTool(page, 'Delete').click();
    await expect.poll(() => zoneCount(page)).toBe(2);
    await waitForApiIdle(page);
    zones = (await backendZones(page)).filter((z) => !z.is_standard);
    expect(zones.filter((z) => z.type === 'point')).toHaveLength(1);
    expect(zones.some((z) => z.type === 'plane')).toBe(true);
    guard.assertClean();
  });
});
