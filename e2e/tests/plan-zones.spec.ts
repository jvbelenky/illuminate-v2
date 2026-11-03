import { test, expect, type Page } from '@playwright/test';
import { waitForApiIdle } from '../helpers/network';
import { waitForSession } from '../helpers/session';
import { attachErrorGuard } from '../helpers/errors';
import { addZone, userZoneRows, zoneCount, zoneEditor } from '../helpers/zones';
import { clickPlan, openStep, planSvg, planTool, showMain } from '../helpers/workspace';
import { addLampFromPreset } from '../helpers/lamps';
import { calculate } from '../helpers/calculations';

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

// The Zones stage adds zones from the Add zone card, on the surface the 2D view
// shows; the plan's toolbar draws a plane there and copies or deletes the selected zone.
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

  test("the zone editor's Copy opens the copy and Delete removes it; undo brings it back", async ({ page }) => {
    await waitForSession(page);
    await addZone(page, 'point');
    await expect(userZoneRows(page)).toHaveCount(1);
    const open = page.locator('.zones-part .editor-row.open');
    const firstId = await open.getAttribute('data-id');
    await open.getByRole('button', { name: 'Copy (Ctrl+D)' }).click();
    await expect.poll(() => zoneCount(page)).toBe(2);
    await expect(open).not.toHaveAttribute('data-id', firstId!);
    await waitForApiIdle(page);
    expect((await backendZones(page)).filter((z) => !z.is_standard && z.type === 'point')).toHaveLength(2);

    await open.getByRole('button', { name: 'Delete (Del)' }).click();
    await expect.poll(() => zoneCount(page)).toBe(1);
    await waitForApiIdle(page);
    expect((await backendZones(page)).filter((z) => !z.is_standard && z.type === 'point')).toHaveLength(1);

    await page.locator('.app-status-bar').click();
    await page.keyboard.press('Control+z');
    await expect.poll(() => zoneCount(page)).toBe(2);
  });

  test('Polygon on the plan adds a zone with its box; its editor toggles Edit corners; Rectangle adds another', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await waitForSession(page);
    await showMain(page, '2d');
    await openStep(page, 'zones');
    const before = await zoneCount(page);
    await planTool(page, 'Polygon').click();
    await expect(planTool(page, 'Polygon')).toHaveAttribute('aria-pressed', 'true');
    await clickPlan(page, [[0.3, 0.6], [0.5, 0.6], [0.5, 0.4], [0.3, 0.4]], { close: true });
    await expect.poll(() => zoneCount(page)).toBe(before + 1);
    await waitForApiIdle(page);
    await expect(zoneEditor(page)).toBeVisible();
    const plan = planSvg(page);
    await expect(plan.getByRole('button', { name: 'Rotate' })).toBeVisible();
    await expect(planTool(page, 'Rotate 90°')).toBeVisible();

    // The editor's Redraw outline and Edit corners; Edit corners toggles the corners
    await expect(zoneEditor(page).getByRole('button', { name: 'Redraw outline' })).toBeVisible();
    const corners = zoneEditor(page).getByRole('button', { name: 'Edit corners' });
    await corners.click();
    await expect(corners).toHaveAttribute('aria-pressed', 'true');
    await expect(plan.getByRole('button', { name: 'Corner 1', exact: true })).toBeVisible();
    await expect(planTool(page, 'Done')).toBeVisible();
    await corners.click();
    await expect(corners).toHaveAttribute('aria-pressed', 'false');
    await expect(plan.getByRole('button', { name: 'Rotate' })).toBeVisible();

    // Esc deselects; with nothing selected, Rectangle drags out another
    await page.locator('.app-status-bar').click();
    await page.keyboard.press('Escape');
    await expect(zoneEditor(page)).toHaveCount(0);
    await planTool(page, 'Rectangle').click();
    const box = (await plan.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.5, { steps: 4 });
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => zoneCount(page)).toBe(before + 2);
    await waitForApiIdle(page);
    const planes = (await backendZones(page)).filter((z) => !z.is_standard && z.type === 'plane');
    expect(planes).toHaveLength(2);
    guard.assertClean();
  });

  test('add a plane on Wall 2, calculate, and it has results', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await waitForSession(page);
    await addLampFromPreset(page);

    await showMain(page, '2d');
    await page.getByRole('combobox', { name: 'Walls' }).selectOption({ label: 'Wall 2' });
    await addZone(page, 'plane');
    await expect(userZoneRows(page)).toHaveCount(1);

    // A whole-wall plane on the backend's second wall
    await waitForApiIdle(page);
    const plane = (await backendZones(page)).find((z) => !z.is_standard && z.type === 'plane');
    expect(plane?.wall?.wall_id).toBe('east');

    await calculate(page);
    const card = page.locator('.zone-card', { has: page.locator('.zone-name', { hasText: plane!.name }) });
    await expect(card.locator('.stat-value').first()).toHaveText(/\d/, { timeout: 15_000 });
    guard.assertClean();
  });

  test('the Reference surface select moves a plane to a wall and the ceiling, the 2D view following; undo puts the backend back', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await waitForSession(page);
    await showMain(page, '2d');
    await addZone(page, 'plane');
    const surface = zoneEditor(page).getByLabel('Reference surface');
    await expect(surface).toHaveValue('floor');

    await surface.selectOption({ label: 'Wall 2' });
    await expect(page.getByRole('combobox', { name: 'Walls' })).toHaveValue('wall:1');
    await expect(zoneEditor(page)).toBeVisible();
    await expect(zoneEditor(page).getByRole('switch', { name: 'Fit to wall' })).toBeChecked();
    await waitForApiIdle(page);
    let plane = (await backendZones(page)).find((z) => !z.is_standard && z.type === 'plane');
    expect(plane?.wall?.wall_id).toBe('east');

    await surface.selectOption({ label: 'Ceiling' });
    await expect(surface).toHaveValue('ceiling');
    await waitForApiIdle(page);
    plane = (await backendZones(page)).find((z) => !z.is_standard && z.type === 'plane');
    expect(plane?.wall ?? null).toBeNull();
    expect(plane?.ref_surface).toBe('xy');

    // Keyboard focus off any field, so the shortcut means "undo the scene"
    await page.locator('.app-status-bar').click();
    await page.keyboard.press('Control+z');
    await waitForApiIdle(page);
    await expect.poll(async () => (await backendZones(page)).find((z) => !z.is_standard && z.type === 'plane')?.wall?.wall_id).toBe('east');
    guard.assertClean();
  });
});
