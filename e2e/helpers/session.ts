import { type Page, expect } from '@playwright/test';

/**
 * Navigate to the app and wait for session initialization.
 * Call this in beforeEach for every test.
 */
export async function waitForSession(page: Page): Promise<void> {
  await page.goto('/');
  // Wait for the status bar "Ready" indicator — means session is initialized
  await expect(page.locator('span.status-indicator')).toBeVisible({ timeout: 15_000 });
}
