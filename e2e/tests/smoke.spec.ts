import { test, expect } from '@playwright/test';
import { waitForSession } from '../helpers/session';

test.describe('Smoke tests', () => {
  test('app loads, session initializes, UI renders', async ({ page }) => {
    await waitForSession(page);

    // Canvas renders
    await expect(page.locator('canvas')).toBeVisible();

    // Left panel sections visible
    await expect(page.locator('h3:has-text("Room")')).toBeVisible();
    await expect(page.locator('h3:has-text("Lamps")')).toBeVisible();
    await expect(page.locator('h3:has-text("Calc Zones")')).toBeVisible();

    // Status bar shows counts
    await expect(page.locator('text=Lamps:')).toBeVisible();
    await expect(page.locator('text=Zones:')).toBeVisible();
  });
});
