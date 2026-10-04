import { type Page, expect } from '@playwright/test';

/** Ensure the Room step is expanded (the guided sidebar collapses it by default). */
export async function expandRoomPanel(page: Page): Promise<void> {
  const header = page.locator('.panel-header').filter({ hasText: 'Floorplan' });
  const content = header.locator('..').locator('.panel-content');
  if (!(await content.isVisible().catch(() => false))) {
    await header.click();
    await expect(content).toBeVisible();
  }
}

/** Get a room dimension input by its label (X, Y, or Z) */
function dimInput(page: Page, label: 'X' | 'Y' | 'Z') {
  return page
    .locator('.room-editor .input-with-label')
    .filter({ has: page.locator(`.input-label:text-is("${label}")`) })
    .locator('input');
}

/** Set room dimensions. Only changes dimensions that are provided. */
export async function setRoomDimensions(
  page: Page,
  dims: { x?: number; y?: number; z?: number }
): Promise<void> {
  await expandRoomPanel(page);
  for (const [label, value] of Object.entries(dims)) {
    if (value == null) continue;
    const input = dimInput(page, label.toUpperCase() as 'X' | 'Y' | 'Z');
    await input.click({ clickCount: 3 });
    await input.fill(String(value));
    await input.press('Tab');
  }
}

/** Read the current value of a room dimension input. */
export async function getRoomDimension(page: Page, label: 'X' | 'Y' | 'Z'): Promise<string> {
  await expandRoomPanel(page);
  return dimInput(page, label).inputValue();
}

/** Apply the Plan editor; when it offers to add obstacles, decline. */
export async function applyPlan(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Apply' }).click();
  const skip = page.getByRole('button', { name: 'No obstacles to add' });
  if (await skip.isVisible({ timeout: 1_500 }).catch(() => false)) await skip.click();
}
