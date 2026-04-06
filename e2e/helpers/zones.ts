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
  await expect(page.locator('.item-list-item[data-zone-id] .inline-editor').last()).toBeVisible({ timeout: 5_000 });
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
  const summary = page.locator('.illustrated-selector button.summary-title, .illustrated-selector .summary-title').first();
  await summary.click();
  await page.locator(`.illustrated-option:has-text("${mode}")`).click();
}

/** Count non-standard zones in the list. */
export async function zoneCount(page: Page): Promise<number> {
  return page.locator('.item-list-item[data-zone-id]:not(.standard-zone)').count();
}
