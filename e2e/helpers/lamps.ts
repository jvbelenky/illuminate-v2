import { type Page, expect } from '@playwright/test';
import { waitForApiIdle } from './network';

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

export interface CustomLampOptions {
  /** Path to the IES fixture. Required — a definition needs photometry. */
  ies: string;
  /** Optional spectrum fixture, attached to the same definition. */
  spectrum?: string;
  /** Only settable on an 'other'-type definition, and only without a spectrum. */
  wavelength?: number;
  /** Overrides the type inherited from the launching lamp. */
  lampType?: 'krcl_222' | 'lp_254' | 'other';
  /** Overrides the name auto-populated from the IES filename. */
  name?: string;
}

/**
 * Build a custom lamp definition from the currently-open lamp editor and apply
 * it to that lamp.
 *
 * Replaces the old inline uploadLampIes/uploadLampSpectrum/setLampWavelength
 * helpers. Commit e8ad6eb ("replace file pool with custom lamp library") moved
 * every photometry input out of the inline editor and into the lamp manager
 * modal, reached through the preset dropdown's "Add custom lamp..." option. The
 * modal opens straight into its form, pre-typed from the launching lamp, and
 * saving auto-applies the new definition to that lamp and closes the manager.
 *
 * IES, spectrum and wavelength now belong to ONE definition built in a single
 * form, which is why they are one helper here rather than three sequential ones.
 */
export async function createCustomLamp(page: Page, opts: CustomLampOptions): Promise<void> {
  await page.locator('select#preset').selectOption('__add_custom__');

  const form = page.locator('.lamp-form');
  await expect(form).toBeVisible({ timeout: 15_000 });

  if (opts.lampType) {
    await form.locator('select#lamp-type-select').selectOption(opts.lampType);
  }

  await form.locator('#ies-file-input').setInputFiles(opts.ies);
  await expect(form.locator('.file-status.success').first()).toBeVisible({ timeout: 15_000 });

  // Wavelength BEFORE spectrum: the field is disabled once a spectrum is
  // attached, because the peak then derives the wavelength.
  if (opts.wavelength !== undefined) {
    const input = form.locator('#wavelength');
    await expect(input).toBeEnabled({ timeout: 15_000 });
    await input.click({ clickCount: 3 });
    await input.fill(String(opts.wavelength));
    await input.press('Tab');
  }

  if (opts.spectrum) {
    await form.locator('.spectrum-file-field input[type="file"]').setInputFiles(opts.spectrum);
    // A single-column file attaches straight away; a multi-column one interposes
    // a column picker. Wait for whichever lands rather than polling for the
    // picker — isVisible() does not wait, so a slow picker would be missed.
    const useSelected = page.locator('.column-picker-actions button.primary');
    const attached = form.locator('.spectrum-file-field .file-status.success');
    await expect(useSelected.or(attached).first()).toBeVisible({ timeout: 15_000 });
    if (await useSelected.isVisible()) {
      await useSelected.click();
    }
    await expect(attached).toBeVisible({ timeout: 15_000 });
  }

  if (opts.name) {
    const nameInput = form.locator('#lamp-name');
    await nameInput.click({ clickCount: 3 });
    await nameInput.fill(opts.name);
  }

  await form.locator('.form-actions button.primary').click();
  // The launch flow closes the manager once the definition is auto-applied.
  await expect(form).not.toBeVisible({ timeout: 15_000 });
  await waitForApiIdle(page);
}

/** Click a placement preset button in the open lamp editor. */
export async function clickPlacementPreset(
  page: Page,
  preset: 'Downlight' | 'Corner' | 'Edge' | 'Horizontal'
): Promise<void> {
  await page.locator('.placement-buttons button').filter({ hasText: preset }).click();
  await waitForApiIdle(page);
}

/** Click an aim preset button in the open lamp editor. */
export async function clickAimPreset(
  page: Page,
  preset: 'Down' | 'Corner' | 'Edge' | 'Horizontal'
): Promise<void> {
  await page.locator('.aim-presets button').filter({ hasText: preset }).click();
  await waitForApiIdle(page);
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
  await item.locator('.item-list-row').click();
  await expect(item.locator('.inline-editor')).toBeVisible({ timeout: 5_000 });
}

/** Copy the currently open lamp via the editor's Copy button. */
export async function copyLamp(page: Page): Promise<void> {
  await page.locator('.inline-editor .editor-actions button').filter({ hasText: 'Copy' }).click();
  await waitForApiIdle(page);
}
