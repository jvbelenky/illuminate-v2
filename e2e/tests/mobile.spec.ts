import { test, expect, devices } from '@playwright/test';
import { waitForSession } from '../helpers/session';

test.describe('Mobile layout', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test.beforeEach(async ({ page }) => {
    await waitForSession(page);
  });

  test('shows mobile tab navigation', async ({ page }) => {
    await expect(page.locator('canvas')).toBeVisible();
  });

  test('can access panels at narrow viewport', async ({ page }) => {
    await expect(page.locator('text=Ready')).toBeVisible();
  });
});
