import { type Page, expect } from '@playwright/test';
import { waitForApiIdle } from './network';
import { openStep, planTool } from './workspace';

/** Open the Zones stage. */
async function expandZonesPanel(page: Page): Promise<void> {
  await openStep(page, 'zones');
}

/** Open the Standard zones fold-out (a no-op while it is open). */
export async function openStandardZones(page: Page): Promise<void> {
  await openStep(page, 'zones');
  const fold = page.getByRole('button', { name: 'Standard zones' });
  if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
}

/** The open zone's editor. */
export function zoneEditor(page: Page) {
  return page.locator('.zones-part .editor-row.open .zone-panel');
}

/** Close the open zone's editor with its row header (the panel has no Close). */
export async function closeZone(page: Page): Promise<void> {
  await page.locator('.zones-part .editor-row.open .row-main').click();
  await expect(zoneEditor(page)).toHaveCount(0);
}

/** Open one of the zone editor's fold-outs (Geometry, Grid points, Display, Advanced); a no-op while open. */
export async function openZoneFold(page: Page, name: 'Geometry' | 'Grid points' | 'Display' | 'Advanced'): Promise<void> {
  const fold = zoneEditor(page).locator('button.ep-disc').filter({ hasText: new RegExp(`^\\s*${name}`) });
  if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
}

/** Rows of the zones the user made (the standard zones keep fixed ids). */
export function userZoneRows(page: Page) {
  return page.locator(
    '.zones-part .editor-row:not([data-id="WholeRoomFluence"]):not([data-id="EyeLimits"]):not([data-id="SkinLimits"])'
  );
}

/** Add a new calc zone from the Add zone card (a plane by default); its editor opens. */
export async function addZone(page: Page, type: 'plane' | 'volume' | 'point' = 'plane'): Promise<void> {
  await expandZonesPanel(page);
  const label = { plane: 'Plane', volume: 'Volume', point: 'Point' }[type];
  const before = await zoneCount(page);
  await page.getByRole('region', { name: 'Add zone' }).getByRole('button', { name: label }).click();
  await expect(zoneEditor(page)).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => zoneCount(page)).toBe(before + 1);
  // The editor renders before the backend-assigned zone id arrives; when it
  // lands the row (and its open fold-outs) re-render. Let creation settle.
  await waitForApiIdle(page);
}

/** Set the open plane's Calculation by its title (e.g. 'Fluence Rate'). */
export async function setCalcMode(page: Page, mode: string): Promise<void> {
  const group = zoneEditor(page).getByRole('group', { name: 'Calculation type' });
  const summary = group.locator('.calc-summary');
  if ((await summary.getAttribute('aria-expanded')) !== 'true') await summary.click();
  await group.locator('.calc-option', { has: page.locator('.calc-option-title', { hasText: new RegExp(`^${mode.replace(/[()]/g, '\\$&')}$`) }) }).click();
  await expect(summary.locator('.calc-summary-title')).toHaveText(mode);
}

/** Count the zones the user made (read from the store, so any step can ask). */
export async function zoneCount(page: Page): Promise<number> {
  const zones: Record<string, any>[] = await page.evaluate(() => {
    const store = (window as any).__illuminate_store__;
    if (!store) throw new Error('Store not exposed on window');
    return JSON.parse(JSON.stringify(store.zones));
  });
  return zones.filter((z) => !z.isStandard).length;
}

/** Click a zone row (user zones by index) to open its editor. */
export async function selectZone(page: Page, index: number = 0): Promise<void> {
  await expandZonesPanel(page);
  const row = userZoneRows(page).nth(index);
  if (!(await row.evaluate((el) => el.classList.contains('open')))) {
    await row.locator('.row-main').click();
  }
  await expect(row.locator('.zone-panel')).toBeVisible({ timeout: 5_000 });
}

/** Copy the selected zone with the plan toolbar's Copy. */
export async function copyZone(page: Page): Promise<void> {
  await planTool(page, 'Copy').click();
  await waitForApiIdle(page);
}

/** Delete a custom zone by index: select it, then the plan toolbar's Delete. */
export async function removeZone(page: Page, index: number = 0): Promise<void> {
  await selectZone(page, index);
  await planTool(page, 'Delete').click();
  await waitForApiIdle(page);
}

/** Click the segment of a segmented control in the open editor that is not pressed. */
async function pressOther(page: Page, group: string): Promise<void> {
  const seg = zoneEditor(page).getByRole('group', { name: group });
  const label = (await seg.locator('button[aria-pressed="false"]').first().textContent())!.trim();
  // By name: once clicked, the other segment is the one not pressed
  const other = seg.getByRole('button', { name: label, exact: true });
  await other.click();
  await expect(other).toHaveAttribute('aria-pressed', 'true');
}

/** Toggle the grid resolution mode (Points <-> Spacing). */
export async function toggleResolutionMode(page: Page): Promise<void> {
  await openZoneFold(page, 'Grid points');
  await pressOther(page, 'Grid resolution');
}

/** The open editor's grid-point fields (counts, or spacings in Spacing mode). */
export function gridInputs(page: Page) {
  return zoneEditor(page).locator('.grid-dims input');
}

/** Toggle the grid offset (Inset <-> On edge). */
export async function toggleOffset(page: Page): Promise<void> {
  await openZoneFold(page, 'Grid points');
  await pressOther(page, 'Grid offset');
}

/** Set the display mode for a zone (Heatmap, Numeric, Contours, Markers, None; Iso for volumes). */
export async function setDisplayMode(
  page: Page,
  mode: 'Heatmap' | 'Iso' | 'Numeric' | 'Contours' | 'Markers' | 'None'
): Promise<void> {
  await openZoneFold(page, 'Display');
  const btn = zoneEditor(page).getByRole('group', { name: 'Display mode' }).getByRole('button', { name: mode, exact: true });
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
}

/** Enable dose mode and set time values. */
export async function setDose(
  page: Page,
  hours: number,
  minutes: number,
  seconds: number
): Promise<void> {
  await openZoneFold(page, 'Display');
  const valueType = zoneEditor(page).locator('select#value-type');
  await valueType.selectOption({ value: 'true' });
  await expect(page.locator('#dose-hours')).toBeVisible({ timeout: 2_000 });

  for (const [id, val] of [['dose-hours', hours], ['dose-minutes', minutes], ['dose-seconds', seconds]]) {
    const input = page.locator(`#${id}`);
    await input.click({ clickCount: 3 });
    await input.fill(String(val));
    await input.press('Tab');
  }
}

/** Disable dose mode (switch back to irradiance/fluence). */
export async function disableDose(page: Page): Promise<void> {
  await openZoneFold(page, 'Display');
  await zoneEditor(page).locator('select#value-type').selectOption({ value: 'false' });
}
