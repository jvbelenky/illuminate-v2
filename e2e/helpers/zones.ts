import { type Page, expect } from '@playwright/test';

/** Ensure the Calc Zones panel is expanded. */
async function expandZonesPanel(page: Page): Promise<void> {
  const header = page.locator('.panel-header').filter({ hasText: 'Calc Zones' });
  const content = header.locator('..').locator('.panel-content');
  if (!(await content.isVisible().catch(() => false))) {
    await header.click();
    await expect(content).toBeVisible();
  }
}

/** Add a new calc zone. Returns the zone's list item locator. */
export async function addZone(page: Page): Promise<void> {
  await expandZonesPanel(page);
  await page.locator('button:has-text("Add Zone")').click();
  await expect(page.locator('.item-list-item[data-zone-id] .inline-editor').last()).toBeVisible({ timeout: 15_000 });
}

/**
 * Switch the currently-open zone editor to a different type.
 * Clicks the type button (Plane, Volume, or Point) inside the open editor.
 */
export async function switchZoneType(
  page: Page,
  newType: 'plane' | 'volume' | 'point'
): Promise<void> {
  const titleMap = { plane: 'CalcPlane', volume: 'CalcVol', point: 'CalcPoint' };
  const btn = page.locator(`button.zone-type-btn[title="${titleMap[newType]}"]`);
  await btn.click();
  await expect(btn).toHaveClass(/active/, { timeout: 5_000 });
}

/**
 * Set the calc mode on a plane zone via the illustrated selector.
 * The zone editor must already be open.
 */
export async function setCalcMode(page: Page, mode: string): Promise<void> {
  // Target the Calculation Type form-group's illustrated selector button
  const calcTypeGroup = page.locator('.form-group').filter({ has: page.locator('label:text-is("Calculation Type")') });
  await calcTypeGroup.locator('button.illustrated-selector-summary').click();
  // Click the option whose title matches the mode name
  await page.locator('.illustrated-option').filter({ hasText: mode }).click();
}

/** Count non-standard zones in the list. */
export async function zoneCount(page: Page): Promise<number> {
  return page.locator('.item-list-item[data-zone-id]:not(.standard-zone)').count();
}

/** Click a zone list item to open its editor. */
export async function selectZone(page: Page, index: number = 0): Promise<void> {
  await expandZonesPanel(page);
  const item = page.locator('.item-list-item[data-zone-id]:not(.standard-zone)').nth(index);
  await item.locator('button.name-display').click();
  await expect(item.locator('.inline-editor')).toBeVisible({ timeout: 5_000 });
}

/** Copy the currently open zone via the editor's Copy button. */
export async function copyZone(page: Page): Promise<void> {
  await page.locator('.inline-editor .editor-actions button').filter({ hasText: 'Copy' }).click();
  await page.waitForTimeout(1_000);
}

/** Delete a custom zone by index. */
export async function removeZone(page: Page, index: number = 0): Promise<void> {
  const zoneItem = page.locator('.item-list-item[data-zone-id]:not(.standard-zone)').nth(index);
  await zoneItem.locator('button[aria-label*="Delete"]').click();
  const confirmBtn = page.locator('button.confirm-btn');
  await expect(confirmBtn).toBeVisible({ timeout: 2_000 });
  await confirmBtn.click();
}

/**
 * Set the reference surface for a plane zone via the illustrated selector.
 * The zone editor must be open and the zone must be a plane type.
 */
export async function setRefSurface(page: Page, surface: 'XY' | 'XZ' | 'YZ'): Promise<void> {
  const editor = page.locator('.inline-editor');
  const refSurfaceGroups = editor.locator('.form-group').filter({
    has: page.locator('label:text-is("Reference Surface")')
  });
  await refSurfaceGroups.locator('button.illustrated-selector-summary').click();
  await page.locator('.illustrated-option').filter({ hasText: surface }).click();
}

/** Toggle the grid resolution mode (spacing <-> num_points). */
export async function toggleResolutionMode(page: Page): Promise<void> {
  await page.locator('button.mode-switch-btn').click();
}

/** Toggle the offset via illustrated selector. */
export async function toggleOffset(page: Page): Promise<void> {
  const editor = page.locator('.inline-editor');
  const offsetGroups = editor.locator('.form-group').filter({
    has: page.locator('.illustrated-selector-summary')
  }).last();
  await offsetGroups.locator('button.illustrated-selector-summary').click();
  const options = page.locator('.illustrated-option');
  const count = await options.count();
  for (let i = 0; i < count; i++) {
    const opt = options.nth(i);
    const classes = await opt.getAttribute('class') || '';
    if (!classes.includes('active')) {
      await opt.click();
      return;
    }
  }
}

/**
 * Set the display mode for a zone.
 * These are the buttons in the display section (Heatmap, Numeric, Markers, None).
 */
export async function setDisplayMode(
  page: Page,
  mode: 'Heatmap' | 'Iso' | 'Numeric' | 'Markers' | 'None'
): Promise<void> {
  const editor = page.locator('.inline-editor');
  const btn = editor.locator('.zone-type-buttons').last().locator('button.zone-type-btn').filter({ hasText: mode });
  await btn.click();
  await expect(btn).toHaveClass(/active/, { timeout: 2_000 });
}

/** Enable dose mode and set time values. */
export async function setDose(
  page: Page,
  hours: number,
  minutes: number,
  seconds: number
): Promise<void> {
  const valueType = page.locator('select#value-type');
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
  await page.locator('select#value-type').selectOption({ value: 'false' });
}
