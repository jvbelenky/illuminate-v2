import { type Page, expect } from '@playwright/test';

/** Ensure the Reflectance step is expanded. */
async function expandReflectancePanel(page: Page): Promise<void> {
  const header = page.locator('.panel-header').filter({ hasText: 'Reflectance' });
  const content = header.locator('..').locator('.panel-content');
  if (!(await content.isVisible().catch(() => false))) {
    await header.click();
    await expect(content).toBeVisible();
  }
}

/** Check the "Enable reflections" checkbox (idempotent — no-op if already checked). */
export async function enableReflections(page: Page): Promise<void> {
  await expandReflectancePanel(page);
  const checkbox = page.locator('label').filter({ hasText: 'Enable reflections' }).locator('input[type="checkbox"]');
  if (!(await checkbox.isChecked())) {
    await checkbox.check();
  }
}

/** Read whether reflections are enabled. */
export async function isReflectionsEnabled(page: Page): Promise<boolean> {
  await expandReflectancePanel(page);
  return page.locator('label').filter({ hasText: 'Enable reflections' }).locator('input[type="checkbox"]').isChecked();
}

/** Open the Reflectance Settings modal. */
export async function openReflectanceModal(page: Page): Promise<void> {
  await expandReflectancePanel(page);
  await page.getByRole('button', { name: 'Edit surfaces…' }).click();
  await expect(page.locator('.modal-backdrop')).toBeVisible({ timeout: 5_000 });
}

/** Close the Reflectance Settings modal via the close button. */
export async function closeReflectanceModal(page: Page): Promise<void> {
  await page.locator('.header-btn.close-btn').click();
  await expect(page.locator('.modal-backdrop')).not.toBeVisible({ timeout: 5_000 });
}

/**
 * The modal row for a plane: a room surface id ("floor", "south", "wall_0")
 * or an obstacle face ("object-1:top"). Rows carry a data-plane attribute.
 */
function surfaceRow(page: Page, surface: string) {
  return page.locator(`[data-plane="${surface}"]`);
}

/** Set a specific surface's reflectance value. Modal must be open. */
export async function setSurfaceReflectance(
  page: Page,
  surface: string,
  value: number
): Promise<void> {
  const row = surfaceRow(page, surface);
  const input = row.locator('input').first();
  await input.click({ clickCount: 3 });
  await input.fill(String(value));
  await input.press('Tab');
}

/** Read a specific surface's reflectance value. Modal must be open. */
export async function getSurfaceReflectance(
  page: Page,
  surface: string
): Promise<number> {
  const row = surfaceRow(page, surface);
  const val = await row.locator('input').first().inputValue();
  return parseFloat(val);
}
