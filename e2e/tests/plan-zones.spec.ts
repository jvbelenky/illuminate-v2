import { test, expect, type Page } from '@playwright/test';
import { waitForApiIdle } from '../helpers/network';
import { waitForSession } from '../helpers/session';
import { attachErrorGuard } from '../helpers/errors';
import { addZone, selectZone, setDisplayMode2d, userZoneRows, zoneCount, zoneEditor } from '../helpers/zones';
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

  test('a calc point moves and aims on the plan as a lamp: Move keeps its aim target, Aim turns it; undo steps back', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await waitForSession(page);
    await addZone(page, 'point');
    await showMain(page, '2d');
    const plan = planSvg(page);
    const marker = plan.locator('circle.plan-lamp.point');
    await expect(marker).toHaveClass(/\bselected\b/);
    for (const name of ['Move', 'Aim', 'Copy', 'Delete']) await expect(planTool(page, name)).toBeVisible();
    // The zone editor's picks sit beside its rows, as a lamp's (no Place / Aim buttons)
    await expect(zoneEditor(page).getByRole('button', { name: 'Pick position' })).toBeVisible();
    await expect(zoneEditor(page).getByRole('button', { name: 'Place', exact: true })).toHaveCount(0);
    const point = async () => (await backendZones(page)).find((z) => !z.is_standard && z.type === 'point')!;
    const pos = (z: Record<string, any>) => [z.x, z.y, z.z];
    const aim = (z: Record<string, any>) => [z.aim_x, z.aim_y, z.aim_z];
    const start = await point();

    // Move: one drag anywhere moves the point; its aim target stays, so its direction turns
    await planTool(page, 'Move').click();
    await expect(planTool(page, 'Move')).toHaveAttribute('aria-pressed', 'true');
    const m = (await marker.boundingBox())!;
    const [x0, y0] = [m.x + m.width / 2 + 60, m.y + m.height / 2 + 40];
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + 40, y0 + 30, { steps: 5 });
    await page.mouse.up();
    await waitForApiIdle(page);
    await expect.poll(async () => pos(await point())).not.toEqual(pos(start));
    const moved = await point();
    expect(aim(moved)).toEqual(aim(start));
    await expect(planTool(page, 'Move')).toHaveAttribute('aria-pressed', 'false');
    // The editor's fields follow
    const xField = zoneEditor(page).getByRole('group', { name: /^Position/ }).getByLabel('X');
    await expect.poll(async () => Math.abs(parseFloat(await xField.inputValue()) - moved.x)).toBeLessThan(0.051);

    // Aim: the drag from the point ends where it now looks; its position stays
    await planTool(page, 'Aim').click();
    const p = (await marker.boundingBox())!;
    const [px, py] = [p.x + p.width / 2, p.y + p.height / 2];
    await page.mouse.move(px, py);
    await page.mouse.down();
    await page.mouse.move(px - 50, py + 70, { steps: 5 });
    await page.mouse.up();
    await waitForApiIdle(page);
    await expect.poll(async () => aim(await point())).not.toEqual(aim(start));
    const aimed = await point();
    expect(pos(aimed)).toEqual(pos(moved));
    expect(aimed.aim_z).toBe(start.aim_z);

    // One undo per gesture: the aim, then the move
    await page.locator('.app-status-bar').click();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => aim(await point())).toEqual(aim(start));
    expect(pos(await point())).toEqual(pos(moved));
    await page.keyboard.press('Control+z');
    await expect.poll(async () => pos(await point())).toEqual(pos(start));
    expect(aim(await point())).toEqual(aim(start));
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

  test('an added plane redrawn on the plan has its box; its editor toggles Edit vertices; no shape tools without a selection', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await waitForSession(page);
    await showMain(page, '2d');
    await openStep(page, 'zones');
    // Nothing selected: no Rectangle or Polygon in the strip
    for (const name of ['Rectangle', 'Polygon']) await expect(planTool(page, name)).toHaveCount(0);
    const before = await zoneCount(page);
    await addZone(page, 'plane');
    await zoneEditor(page).getByRole('button', { name: 'Redraw outline' }).click();
    await expect(page.locator('.plan-pane svg.plan.drawing')).toHaveCount(1);
    await clickPlan(page, [[0.3, 0.6], [0.5, 0.6], [0.5, 0.4], [0.3, 0.4]], { close: true });
    await expect.poll(() => zoneCount(page)).toBe(before + 1);
    await waitForApiIdle(page);
    await expect(zoneEditor(page)).toBeVisible();
    const plan = planSvg(page);
    await expect(plan.getByRole('button', { name: 'Rotate' })).toBeVisible();
    await expect(planTool(page, 'Rotate 90°')).toBeVisible();

    // The editor's Redraw outline and Edit vertices; Edit vertices toggles the vertices
    await expect(zoneEditor(page).getByRole('button', { name: 'Redraw outline' })).toBeVisible();
    const corners = zoneEditor(page).getByRole('button', { name: 'Edit vertices' });
    await corners.click();
    await expect(corners).toHaveAttribute('aria-pressed', 'true');
    await expect(plan.getByRole('button', { name: 'Vertex 1', exact: true })).toBeVisible();
    await expect(planTool(page, 'Done')).toBeVisible();
    await corners.click();
    await expect(corners).toHaveAttribute('aria-pressed', 'false');
    await expect(plan.getByRole('button', { name: 'Rotate' })).toBeVisible();

    // Esc deselects; with nothing selected, no shape tools
    await page.locator('.app-status-bar').click();
    await page.keyboard.press('Escape');
    await expect(zoneEditor(page)).toHaveCount(0);
    await expect(page.locator('.plan-toolbar')).toHaveCount(0);
    const planes = (await backendZones(page)).filter((z) => !z.is_standard && z.type === 'plane');
    expect(planes).toHaveLength(1);
    guard.assertClean();
  });

  test('add a plane on Wall 2, calculate, and it has results', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await waitForSession(page);
    await addLampFromPreset(page);

    await showMain(page, '2d');
    await page.getByRole('combobox', { name: '2D view' }).selectOption({ label: 'Wall 2' });
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
    await expect(page.getByRole('combobox', { name: '2D view' })).toHaveValue('wall:1');
    await expect(zoneEditor(page)).toBeVisible();
    await expect(zoneEditor(page).getByRole('switch', { name: 'Fit to wall' })).toBeChecked();
    await waitForApiIdle(page);
    let plane = (await backendZones(page)).find((z) => !z.is_standard && z.type === 'plane');
    expect(plane?.wall?.wall_id).toBe('east');

    await surface.selectOption({ label: 'Ceiling' });
    await expect(surface).toHaveValue('ceiling');
    // There is no Ceiling view: a ceiling plane shows on the plan view, still selected
    await expect(page.getByRole('combobox', { name: '2D view' })).toHaveValue('floor');
    await expect(zoneEditor(page)).toBeVisible();
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

  test("a plane's results show on the plan as its 2D display asks: heatmap, contours, then its markers", async ({ page }) => {
    const guard = attachErrorGuard(page);
    await waitForSession(page);
    await addLampFromPreset(page);
    await showMain(page, '2d');
    await addZone(page, 'plane');
    const plan = planSvg(page);
    const id = await userZoneRows(page).first().getAttribute('data-id');
    // Before a calculation the plane shows its grid points
    await expect(plan.locator(`path.zone-markers[data-zone-id="${id}"]`)).toHaveCount(1);

    await calculate(page);
    await setDisplayMode2d(page, 'Heatmap');
    const heat = plan.locator(`image.zone-field.heatmap[data-zone-id="${id}"]`);
    await expect(heat).toHaveCount(1);
    expect(await heat.getAttribute('href')).toMatch(/^data:image\/png/);
    await expect(plan.locator(`path.zone-markers[data-zone-id="${id}"]`)).toHaveCount(0);
    // Over the room's fill, under the room's outline
    const order = await plan.evaluate((svg) => {
      const all = [...svg.querySelectorAll('*')];
      return [all.findIndex((e) => e.matches('.context-fill')), all.findIndex((e) => e.matches('image.zone-field')), all.findIndex((e) => e.matches('.context-outline'))];
    });
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);

    await setDisplayMode2d(page, 'Contours');
    await expect(plan.locator(`image.zone-field.contours[data-zone-id="${id}"]`)).toHaveCount(1);

    await setDisplayMode2d(page, 'Markers');
    await expect(plan.locator('image.zone-field')).toHaveCount(0);
    const dots = plan.locator(`path.zone-markers[data-zone-id="${id}"]`);
    await expect(dots).toHaveCount(1);
    expect((await dots.getAttribute('d'))!.match(/h0/g)!.length).toBeGreaterThan(4);
    // The 3D display is its own setting
    const zone = await page.evaluate((zid) => (window as any).__illuminate_store__.zones.find((z: any) => z.id === zid), id);
    expect(zone.display_mode_2d).toBe('markers');
    expect(zone.display_mode ?? 'heatmap').toBe('heatmap');
    guard.assertClean();
  });

  test('no tint covers a zone\'s results: selected it is outlined only, the room tint sits under them, and they follow a drag', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await waitForSession(page);
    await addLampFromPreset(page);
    await showMain(page, '2d');
    await addZone(page, 'plane');
    const plan = planSvg(page);
    const id = await userZoneRows(page).first().getAttribute('data-id');
    // Without results the selected zone keeps its tint
    const draft = plan.locator('polygon.outline');
    await expect.poll(() => draft.evaluate((p) => getComputedStyle(p).fill)).not.toBe('none');

    await calculate(page);
    await setDisplayMode2d(page, 'Heatmap');
    const heat = plan.locator(`image.zone-field.heatmap[data-zone-id="${id}"]`);
    await expect(heat).toHaveCount(1);
    // Selected with results: its outline only
    await expect.poll(() => draft.evaluate((p) => getComputedStyle(p).fill)).toBe('none');

    // Editing the room: its tint goes under the results, its outline stays over them
    await openStep(page, 'room', 'floorplan');
    await expect(heat).toHaveCount(1);
    const order = await plan.evaluate((svg) => {
      const all = [...svg.querySelectorAll('*')];
      return [all.findIndex((e) => e.matches('.draft-fill')), all.findIndex((e) => e.matches('image.zone-field')), all.findIndex((e) => e.matches('polygon.outline'))];
    });
    expect(order[0]).toBeGreaterThanOrEqual(0);
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
    expect(await plan.locator('polygon.outline').evaluate((p) => getComputedStyle(p).fill)).toBe('none');

    // A drag carries the results with the zone until it lands; then they are stale and its markers show
    await openStep(page, 'zones');
    await selectZone(page, 0);
    const b = (await draft.boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.3 + 40, b.y + b.height * 0.3 + 25, { steps: 6 });
    await expect(heat).toHaveAttribute('transform', /^matrix\(1 0 0 1 [-\d.e]+ [-\d.e]+\)$/);
    await page.mouse.up();
    await expect(heat).toHaveCount(0);
    await expect(plan.locator(`path.zone-markers[data-zone-id="${id}"]`)).toHaveCount(1);
    await expect(plan.locator(`path.zone-markers[data-zone-id="${id}"]`)).not.toHaveAttribute('transform', /.+/);
    guard.assertClean();
  });

  test('Add zone makes a plane, a volume or a point, named CalcPlane N, CalcVol N, CalcPoint N; the editor has no type switch', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await waitForSession(page);
    for (const type of ['plane', 'volume', 'point', 'plane'] as const) {
      await addZone(page, type);
      // The type was chosen once, at creation: nothing in the editor changes it
      for (const name of ['Plane', 'Volume', 'Point']) await expect(zoneEditor(page).getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    const names = await userZoneRows(page).locator('.name').allTextContents();
    expect(names.map((n) => n.trim())).toEqual(['CalcPlane 1', 'CalcVol 1', 'CalcPoint 1', 'CalcPlane 2']);
    await waitForApiIdle(page);
    const zones = (await backendZones(page)).filter((z) => !z.is_standard);
    expect(zones.map((z) => [z.type, z.name])).toEqual([['plane', 'CalcPlane 1'], ['volume', 'CalcVol 1'], ['point', 'CalcPoint 1'], ['plane', 'CalcPlane 2']]);
    guard.assertClean();
  });

  test('a floor plane turns: Rotate 90° in the strip, then the rotate handle', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await waitForSession(page);
    await showMain(page, '2d');
    await addZone(page, 'plane');
    const plane = async () => page.evaluate(() => JSON.parse(JSON.stringify((window as any).__illuminate_store__.zones)).find((z: any) => !z.isStandard));

    // A whole-room plane in the 6 x 4 room: turned a quarter it is 4 wide, cut to the room's 4 deep
    await planTool(page, 'Rotate 90°').click();
    await expect.poll(async () => {
      const z = await plane();
      return [z.fit_room, z.x1, z.x2, z.y1, z.y2];
    }).toEqual([false, 1, 5, 0, 4]);

    // The rotate handle turns it off the axes: a drawn outline
    const handle = planSvg(page).getByRole('button', { name: 'Rotate' });
    const b = (await handle.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 80, b.y + b.height / 2 + 30, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await plane()).vertices?.length ?? 0).toBeGreaterThanOrEqual(4);
    const z = await plane();
    const xs = z.vertices.map((v: number[]) => v[0]);
    const ys = z.vertices.map((v: number[]) => v[1]);
    // Turned: not an axis rectangle, and kept in the room
    expect(new Set(xs.map((x: number) => x.toFixed(3))).size).toBeGreaterThan(2);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(6);
    expect(Math.max(...ys)).toBeLessThanOrEqual(4);
    await waitForApiIdle(page);
    const back = (await backendZones(page)).find((bz) => !bz.is_standard && bz.type === 'plane');
    expect(back?.vertices?.length).toBe(z.vertices.length);
    guard.assertClean();
  });
});
