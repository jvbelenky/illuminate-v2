import { test, expect } from '@playwright/test';

test.describe('Mobile layout', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('app renders at mobile viewport', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 15_000 });
  });
});
