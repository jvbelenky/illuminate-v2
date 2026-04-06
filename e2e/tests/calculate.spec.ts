import { test, expect } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { addLampFromPreset } from '../helpers/lamps';
import { addZone } from '../helpers/zones';
import { calculate, waitForResults } from '../helpers/calculations';

test.describe('Calculation workflow', () => {
  test.beforeEach(async ({ page }) => {
    await waitForSession(page);
  });

  test('full flow: add lamp + zone, calculate, see results', async ({ page }) => {
    await addLampFromPreset(page);
    await addZone(page);

    // Click away from zone editor to collapse it
    await page.locator('h3:has-text("Room")').click();

    await calculate(page);
    await waitForResults(page);

    const statLabels = page.locator('.stat-label');
    const count = await statLabels.count();
    expect(count).toBeGreaterThan(0);
  });

  test('status bar shows last calculated time after calculation', async ({ page }) => {
    await addLampFromPreset(page);
    await addZone(page);
    await page.locator('h3:has-text("Room")').click();

    await calculate(page);
    await waitForResults(page);

    await expect(page.locator('text=Last calculated:')).toBeVisible();
  });
});
