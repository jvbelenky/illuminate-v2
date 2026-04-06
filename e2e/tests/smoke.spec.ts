import { test, expect } from '@playwright/test';
import { waitForSession } from '../helpers/session';

test.describe('Smoke tests', () => {
  test.beforeEach(async ({ page }) => {
    await waitForSession(page);
  });

  test('app loads and session initializes', async ({ page }) => {
    // Status bar shows Ready
    await expect(page.locator('text=Ready')).toBeVisible();
  });

  test('3D room canvas renders', async ({ page }) => {
    await expect(page.locator('canvas')).toBeVisible();
  });

  test('left panel sections are visible', async ({ page }) => {
    await expect(page.locator('h3:has-text("Room")')).toBeVisible();
    await expect(page.locator('h3:has-text("Lamps")')).toBeVisible();
    await expect(page.locator('h3:has-text("Calc Zones")')).toBeVisible();
  });

  test('status bar shows lamp and zone counts', async ({ page }) => {
    await expect(page.locator('text=Lamps:')).toBeVisible();
    await expect(page.locator('text=Zones:')).toBeVisible();
  });
});
