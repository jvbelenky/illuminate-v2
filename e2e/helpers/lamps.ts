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

/** Add a lamp and select a specific lamp type (does NOT select a preset). */
export async function addLampWithType(
  page: Page,
  lampType: 'krcl_222' | 'lp_254' | 'other'
): Promise<void> {
  await expandLampsPanel(page);
  await page.locator('button:has-text("Add Lamp")').click();
  const typeSelect = page.locator('select#lamp-type');
  await expect(typeSelect).toBeVisible({ timeout: 15_000 });
  await typeSelect.selectOption(lampType);
}

/** Upload an IES file in the currently-open lamp editor. */
export async function uploadLampIes(page: Page, filePath: string): Promise<void> {
  const fileInput = page.locator('.inline-editor input[type="file"][accept=".ies"]');
  await fileInput.setInputFiles(filePath);
  await expect(page.locator('.inline-editor .file-status')).toBeVisible({ timeout: 15_000 });
}

/** Upload a spectrum file in the currently-open lamp editor. */
export async function uploadLampSpectrum(page: Page, filePath: string): Promise<void> {
  const fileInput = page.locator('.inline-editor input[type="file"][accept=".csv,.xls,.xlsx"]');
  await fileInput.setInputFiles(filePath);
  await expect(page.locator('.inline-editor .file-status').last()).toBeVisible({ timeout: 15_000 });
}

/** Set the wavelength input for an "other" type lamp. */
export async function setLampWavelength(page: Page, value: number): Promise<void> {
  const input = page.locator('#wavelength');
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.click({ clickCount: 3 });
  await input.fill(String(value));
  await input.press('Tab');
}

/** Click a placement preset button in the open lamp editor. */
export async function clickPlacementPreset(
  page: Page,
  preset: 'Downlight' | 'Corner' | 'Edge' | 'Horizontal'
): Promise<void> {
  await page.locator('.placement-buttons button').filter({ hasText: preset }).click();
  await page.waitForTimeout(500);
}

/** Click an aim preset button in the open lamp editor. */
export async function clickAimPreset(
  page: Page,
  preset: 'Down' | 'Corner' | 'Edge' | 'Horizontal'
): Promise<void> {
  await page.locator('.aim-presets button').filter({ hasText: preset }).click();
  await page.waitForTimeout(500);
}

/** Click the tilt/orientation mode toggle button. */
export async function toggleTiltMode(page: Page): Promise<void> {
  await page.locator('button.mode-switch').click();
}

/** Open the advanced lamp settings modal (click "Details..." button). */
export async function openAdvancedSettings(page: Page): Promise<void> {
  await page.locator('.inline-editor button.secondary').filter({ hasText: 'Details...' }).click();
  await expect(page.locator('.modal-backdrop')).toBeVisible({ timeout: 5_000 });
}

/** Click a tab in the advanced settings modal. */
export async function selectAdvancedTab(
  page: Page,
  tabText: string
): Promise<void> {
  const tab = page.locator('button[role="tab"]').filter({ hasText: tabText });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** Close the advanced lamp settings modal. */
export async function closeAdvancedSettings(page: Page): Promise<void> {
  await page.locator('.header-btn.close-btn').click();
  await expect(page.locator('.modal-backdrop')).not.toBeVisible({ timeout: 5_000 });
}

/** Click a lamp list item to open its editor. */
export async function selectLamp(page: Page, index: number = 0): Promise<void> {
  await expandLampsPanel(page);
  const item = page.locator('.item-list-item[data-lamp-id]').nth(index);
  await item.locator('button.name-display').click();
  await expect(item.locator('.inline-editor')).toBeVisible({ timeout: 5_000 });
}

/** Copy the currently open lamp via the editor's Copy button. */
export async function copyLamp(page: Page): Promise<void> {
  await page.locator('.inline-editor .editor-actions button').filter({ hasText: 'Copy' }).click();
  await page.waitForTimeout(1_000);
}
