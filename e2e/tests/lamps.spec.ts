import { test, expect } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { addLampFromPreset, removeLamp, lampCount } from '../helpers/lamps';

test.describe('Lamp management', () => {
  test.beforeEach(async ({ page }) => {
    await waitForSession(page);
  });

  test('can add a lamp from preset', async ({ page }) => {
    expect(await lampCount(page)).toBe(0);
    await addLampFromPreset(page);
    expect(await lampCount(page)).toBe(1);
  });

  test('lamp editor opens when lamp is added', async ({ page }) => {
    await addLampFromPreset(page);
    await expect(page.locator('.item-list-item[data-lamp-id] .inline-editor').first()).toBeVisible();
  });

  test('can toggle lamp enabled/disabled', async ({ page }) => {
    await addLampFromPreset(page);
    const lampItem = page.locator('.item-list-item[data-lamp-id]').first();
    const toggleBtn = lampItem.locator('button[aria-label*="Exclude"], button[aria-label*="Include"]');
    await toggleBtn.click();
    await expect(lampItem).toHaveClass(/calc-disabled/);
    await toggleBtn.click();
    await expect(lampItem).not.toHaveClass(/calc-disabled/);
  });

  test('can delete a lamp', async ({ page }) => {
    await addLampFromPreset(page);
    expect(await lampCount(page)).toBe(1);
    await removeLamp(page, 0);
    await expect(page.locator('.item-list-item[data-lamp-id]')).toHaveCount(0);
  });
});
