import { type Page, expect } from '@playwright/test';
import { waitForApiIdle } from './network';

/**
 * Navigate to the app and wait for session initialization to actually finish.
 * Call this in beforeEach for every test.
 *
 * NOTE: `.status-indicator` becoming visible does NOT mean the session is
 * initialized — POST /session/init, GET /session/zones and GET
 * /session/state-hashes all fire *after* it appears. Returning at that point
 * left tests acting on a half-initialized session: save-load's file import
 * would apply, and then the in-flight init response (carrying the default room)
 * would land and silently overwrite it. So wait for the API to go quiet too.
 */
export async function waitForSession(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('span.status-indicator')).toBeVisible({ timeout: 15_000 });
  await waitForApiIdle(page);
}
