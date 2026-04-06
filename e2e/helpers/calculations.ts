import { type Page, expect } from '@playwright/test';

/** Click the Calculate button and wait for results to appear. */
export async function calculate(page: Page): Promise<void> {
  const calcBtn = page.locator('button.calculate-btn');
  await calcBtn.click();

  // Wait for button to enter calculating state
  await expect(calcBtn).toHaveClass(/calculating/, { timeout: 5_000 });

  // Wait for calculation to complete (button leaves calculating state)
  await expect(calcBtn).not.toHaveClass(/calculating/, { timeout: 60_000 });
}

/** Wait for the results panel to show zone statistics. */
export async function waitForResults(page: Page): Promise<void> {
  await expect(page.locator('.stat-value').first()).toBeVisible({ timeout: 10_000 });
}
