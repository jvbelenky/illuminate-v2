import { test, expect, type Page } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { addZone, switchZoneType, zoneCount } from '../helpers/zones';

test.describe.serial('Zone management', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await waitForSession(page);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('can add a zone', async () => {
    expect(await zoneCount(page)).toBe(0);
    await addZone(page);
    expect(await zoneCount(page)).toBe(1);
  });

  test('zone editor opens when zone is added', async () => {
    await expect(page.locator('button.zone-type-btn').first()).toBeVisible();
  });

  test('can switch zone type and editor stays open', async () => {
    await expect(page.locator('button.zone-type-btn[title="CalcPlane"]')).toHaveClass(/active/);

    await switchZoneType(page, 'volume');
    await expect(page.locator('button.zone-type-btn').first()).toBeVisible();
    await expect(page.locator('button.zone-type-btn[title="CalcVol"]')).toHaveClass(/active/);

    await switchZoneType(page, 'point');
    await expect(page.locator('button.zone-type-btn').first()).toBeVisible();
    await expect(page.locator('button.zone-type-btn[title="CalcPoint"]')).toHaveClass(/active/);

    await switchZoneType(page, 'plane');
    await expect(page.locator('button.zone-type-btn[title="CalcPlane"]')).toHaveClass(/active/);
  });

  test('can delete a zone', async () => {
    const zoneItem = page.locator('.item-list-item[data-zone-id]:not(.standard-zone)').first();
    await zoneItem.locator('button[aria-label*="Delete"]').click();
    const confirmBtn = page.locator('button.confirm-btn');
    await expect(confirmBtn).toBeVisible({ timeout: 2_000 });
    await confirmBtn.click();
    await expect(page.locator('.item-list-item[data-zone-id]:not(.standard-zone)')).toHaveCount(0);
  });
});
