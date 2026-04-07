import { type Page, expect } from '@playwright/test';

/** Click the Calculate button and wait for results to appear. */
export async function calculate(page: Page): Promise<void> {
  const calcBtn = page.locator('button.calculate-btn');
  await calcBtn.click();

  // Wait for calculation to complete — button transitions to 'up-to-date'.
  // Skipping the intermediate 'calculating' check avoids races where the
  // transition happens faster than the assertion can observe it.
  await expect(calcBtn).toHaveClass(/up-to-date/, { timeout: 60_000 });
}

/** Wait for the results panel to show zone statistics. */
export async function waitForResults(page: Page): Promise<void> {
  await expect(page.locator('.stat-value').first()).toBeVisible({ timeout: 10_000 });
}
