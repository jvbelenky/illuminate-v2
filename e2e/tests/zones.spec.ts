import { test, expect } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { addZone, switchZoneType, zoneCount } from '../helpers/zones';

test.describe('Zone management', () => {
  test.beforeEach(async ({ page }) => {
    await waitForSession(page);
  });

  test('can add a zone', async ({ page }) => {
    expect(await zoneCount(page)).toBe(0);
    await addZone(page);
    expect(await zoneCount(page)).toBe(1);
  });

  test('zone editor opens when zone is added', async ({ page }) => {
    await addZone(page);
    await expect(page.locator('button.zone-type-btn').first()).toBeVisible();
  });

  test('can switch zone type and editor stays open', async ({ page }) => {
    await addZone(page);
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

  test('can delete a zone', async ({ page }) => {
    await addZone(page);
    expect(await zoneCount(page)).toBe(1);
    const zoneItem = page.locator('.item-list-item[data-zone-id]:not(.standard-zone)').first();
    await zoneItem.locator('button[aria-label*="Delete"]').click();
    const confirmBtn = page.locator('button:has-text("Delete")');
    if (await confirmBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await confirmBtn.click();
    }
    await expect(page.locator('.item-list-item[data-zone-id]:not(.standard-zone)')).toHaveCount(0);
  });
});
