import { test, expect } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { addLampFromPreset, lampCount } from '../helpers/lamps';

test.describe('Session recovery', () => {
  test('recovers after backend session expires', async ({ page }) => {
    await waitForSession(page);

    await addLampFromPreset(page);
    expect(await lampCount(page)).toBe(1);

    // Intercept session API calls to return 401 (session expired)
    await page.route('**/api/v1/session/**', (route) => {
      route.fulfill({ status: 401, body: JSON.stringify({ detail: 'Session expired' }) });
    });

    // Trigger an action that makes an API call
    await page.locator('button:has-text("Add Lamp")').click();

    // Wait for the error to be processed before removing intercept
    await page.waitForTimeout(2_000);

    // Remove the intercept so recovery can succeed
    await page.unroute('**/api/v1/session/**');

    // Wait for the app to recover
    await expect(page.locator('text=Ready')).toBeVisible({ timeout: 15_000 });
  });
});
