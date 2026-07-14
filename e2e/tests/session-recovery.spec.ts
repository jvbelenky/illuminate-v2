import { test, expect } from '../fixtures';
import { waitForSession } from '../helpers/session';
import { addLampFromPreset, lampCount } from '../helpers/lamps';

test.describe('Session recovery', () => {
  test('recovers after backend session expires', async ({ page, errorGuard }) => {
    // This test induces 401s on purpose; the resulting console noise is expected.
    errorGuard.allow(/401/, /Session expired/, /Failed to load resource/);

    await waitForSession(page);

    await addLampFromPreset(page);
    await expect.poll(() => lampCount(page)).toBe(1);

    // Intercept session API calls to return 401 (session expired)
    let unauthorized = 0;
    page.on('response', (r) => {
      if (r.status() === 401) unauthorized++;
    });
    await page.route('**/api/v1/session/**', (route) => {
      route.fulfill({ status: 401, body: JSON.stringify({ detail: 'Session expired' }) });
    });

    // Trigger an action that makes an API call
    await page.locator('button:has-text("Add Lamp")').click();

    // The app must actually observe the expiry before we lift the intercept.
    // Recovery retries session/create then session/init, so more than one 401
    // lands; waiting for >= 2 proves the failed reinit ran rather than merely
    // that the first request bounced.
    await expect.poll(() => unauthorized, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);

    // Remove the intercept so recovery can succeed
    await page.unroute('**/api/v1/session/**');

    // Wait for the app to recover
    await expect(page.locator('text=Ready')).toBeVisible({ timeout: 15_000 });
  });
});
