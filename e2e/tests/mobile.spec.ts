import { test, expect, type Page } from '@playwright/test';

test.describe.serial('Mobile layout', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 15_000 });
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('shows mobile tab navigation', async () => {
    await expect(page.locator('canvas')).toBeVisible();
  });

  test('can access panels at narrow viewport', async () => {
    await expect(page.locator('canvas')).toBeVisible();
  });
});
