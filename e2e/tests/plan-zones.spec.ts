import { test, expect, type Page } from '@playwright/test';
import { waitForApiIdle } from '../helpers/network';
import { waitForSession } from '../helpers/session';
import { attachErrorGuard } from '../helpers/errors';
import { expandRoomPanel } from '../helpers/room';

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

test.describe('Calc zones on the plan', () => {
  test('draw an L-shaped plane and place a point; the backend has the outline', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await waitForSession(page);
    await expandRoomPanel(page);
    await page.locator('.room-editor').getByRole('button', { name: 'Edit floor plan' }).click();
    const modal = page.locator('.floor-plan-modal');
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: /Calc zones/ }).click();

    const rows = modal.getByRole('listbox', { name: 'Calc zones' }).getByRole('option');
    const before = await rows.count();
    await modal.getByRole('button', { name: 'Draw plane' }).click();
    const plan = modal.locator('svg.plan');
    const box = await plan.boundingBox();
    if (!box) throw new Error('plan canvas not visible');
    for (const [fx, fy] of [[0.15, 0.85], [0.5, 0.85], [0.5, 0.6], [0.32, 0.6], [0.32, 0.4], [0.15, 0.4]] as [number, number][]) {
      await plan.click({ position: { x: box.width * fx, y: box.height * fy } });
    }
    await page.keyboard.press('Enter');
    await expect(rows).toHaveCount(before + 1);
    await expect(modal.locator('.lamp-panel #plane-height')).toBeVisible();

    await modal.getByRole('button', { name: 'Place point' }).click();
    await plan.click({ position: { x: box.width * 0.4, y: box.height * 0.5 } });
    await expect(rows).toHaveCount(before + 2);
    await waitForApiIdle(page);

    const zones = (await backendZones(page)).filter((z) => !z.is_standard);
    const drawn = zones.find((z) => z.type === 'plane' && z.vertices);
    expect(drawn?.vertices).toHaveLength(6);
    expect(zones.some((z) => z.type === 'point')).toBe(true);
    guard.assertClean();
  });
});
