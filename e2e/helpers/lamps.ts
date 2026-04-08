import { type Page, expect } from '@playwright/test';

/** Ensure the Lamps panel is expanded. */
async function expandLampsPanel(page: Page): Promise<void> {
  const header = page.locator('.panel-header').filter({ hasText: 'Lamps' });
  const content = header.locator('..').locator('.panel-content');
  if (!(await content.isVisible().catch(() => false))) {
    await header.click();
    await expect(content).toBeVisible();
  }
}

/** Add a new lamp and select the first available preset. */
export async function addLampFromPreset(page: Page): Promise<void> {
  await expandLampsPanel(page);
  await page.locator('button:has-text("Add Lamp")').click();

  // Wait for lamp editor to appear with preset dropdown
  const presetSelect = page.locator('select#preset');
  await expect(presetSelect).toBeVisible({ timeout: 15_000 });

  // Wait for options to load from API (first real option after the disabled placeholder)
  await expect(presetSelect.locator('option:not([disabled])')).not.toHaveCount(0, { timeout: 15_000 });

  // Select the first available preset
  const firstOption = presetSelect.locator('option:not([disabled])').first();
  const value = await firstOption.getAttribute('value');
  if (value) {
    await presetSelect.selectOption(value);
  }
}

/** Remove a lamp by clicking its delete button. Index is 0-based. */
export async function removeLamp(page: Page, index: number = 0): Promise<void> {
  const lampItem = page.locator('.item-list-item[data-lamp-id]').nth(index);
  await lampItem.locator('button[aria-label*="Delete"]').click();
  // Confirm deletion in the dialog (button.confirm-btn is unique to the dialog)
  const confirmBtn = page.locator('button.confirm-btn');
  await expect(confirmBtn).toBeVisible({ timeout: 2_000 });
  await confirmBtn.click();
}

/** Count lamps currently in the list. */
export async function lampCount(page: Page): Promise<number> {
  return page.locator('.item-list-item[data-lamp-id]').count();
}
