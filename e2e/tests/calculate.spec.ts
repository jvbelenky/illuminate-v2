import { test, expect, type Page } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { addLampFromPreset } from '../helpers/lamps';
import { addZone } from '../helpers/zones';
import { calculate, waitForResults } from '../helpers/calculations';

test.describe.serial('Calculation workflow', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await waitForSession(page);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('full flow: add lamp + zone, calculate, see results', async () => {
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

  test('status bar shows last calculated time after calculation', async () => {
    // Calculation already ran in previous test
    await expect(page.locator('text=Last calculated:')).toBeVisible();
  });
});
