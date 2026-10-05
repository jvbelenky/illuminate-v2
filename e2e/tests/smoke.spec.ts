import { test, expect } from '../fixtures';
import { waitForSession } from '../helpers/session';

test.describe('Smoke tests', () => {
  test('app loads, session initializes, UI renders', async ({ page }) => {
    await waitForSession(page);

    // Canvas renders
    await expect(page.locator('canvas')).toBeVisible();

    // Left panel sections visible
    await expect(page.locator('h3:has-text("Floorplan")')).toBeVisible();
    await expect(page.locator('h3:has-text("Lamps")')).toBeVisible();
    await expect(page.locator('h3:has-text("Calc Zones")')).toBeVisible();

    // Status bar shows the version (the lamp/zone counts left it in 0.5.x)
    await expect(page.locator('.app-status-bar')).toContainText('illuminate v');
  });
});
