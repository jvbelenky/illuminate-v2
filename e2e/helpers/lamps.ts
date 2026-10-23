import { type Locator, type Page, expect } from '@playwright/test';
import { waitForApiIdle } from './network';
import { getLampsFromStore } from './api';
import { openStep } from './workspace';

/** Open the Lamps stage. */
async function expandLampsPanel(page: Page): Promise<void> {
  await openStep(page, 'lamps');
}

/** The lamp rows in the Lamps stage. */
function lampRows(page: Page) {
  return page.locator('.lamps-part .editor-row');
}

/** The open lamp's editor. */
export function lampEditor(page: Page) {
  return page.locator('.lamps-part .editor-row.open .lamp-editor');
}

/**
 * Add a lamp: choose a fixture (the nth preset, default the first) and press a
 * placement. The new lamp is selected, with its editor open.
 */
export async function addLampFromPreset(page: Page, presetIndex: number = 0): Promise<void> {
  await expandLampsPanel(page);
  const before = await lampCount(page);

  const fixture = page.locator('.lamps-part').getByLabel('Fixture', { exact: true });
  const presets = fixture.locator('option[value^="preset:"]');
  // Options load from the API
  await expect(presets).not.toHaveCount(0, { timeout: 15_000 });
  const value = await presets.nth(presetIndex).getAttribute('value');
  await fixture.selectOption(value!);

  await page.getByRole('group', { name: 'Placement' }).getByRole('button', { name: 'Downlight' }).click();
  await expect.poll(() => lampCount(page)).toBe(before + 1);
  await expect(lampEditor(page)).toBeVisible({ timeout: 15_000 });
  await expect(lampEditor(page).locator('select#preset')).toBeVisible();
  await waitForApiIdle(page);
}

/** Remove a lamp through its editor's Delete button and the confirm dialog. Index is 0-based. */
export async function removeLamp(page: Page, index: number = 0): Promise<void> {
  await selectLamp(page, index);
  await lampEditor(page).locator('.editor-actions .delete-btn').click();
  // Confirm deletion in the dialog (button.confirm-btn is unique to the dialog)
  const confirmBtn = page.locator('button.confirm-btn');
  await expect(confirmBtn).toBeVisible({ timeout: 2_000 });
  await confirmBtn.click();
}

/** Count lamps in the project (read from the store, so any step can ask). */
export async function lampCount(page: Page): Promise<number> {
  return (await getLampsFromStore(page)).length;
}

/**
 * Add a lamp and switch it to a lamp type. The lamp starts from a preset, and a
 * type change drops it to a custom (modelless) lamp of that type.
 */
export async function addLampWithType(
  page: Page,
  lampType: 'krcl_222' | 'lp_254' | 'other'
): Promise<void> {
  await addLampFromPreset(page);
  const typeSelect = lampEditor(page).locator('select#lamp-type');
  await expect(typeSelect).toBeVisible({ timeout: 15_000 });
  await typeSelect.selectOption(lampType);
  await waitForApiIdle(page);
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
  /** Housing face the beam leaves through (fixture editor). */
  face?: 'bottom' | 'top' | 'front' | 'back' | 'left' | 'right';
  /** Photometric center's distance from the mounting point, in the form's units (fixture editor). */
  mountDistance?: number;
  /**
   * Photometric axis token to pick before saving. The picker offers Ceiling /
   * Wall / Floor (down / horizontal / up); a horizontal token clicks Wall and
   * then picks that horizontal angle as the one pointing into the room.
   */
  axis?: string;
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
/** Open the fixture editor's collapsed Advanced section (no-op when open). */
export async function openFixtureAdvanced(scope: Locator): Promise<void> {
  const adv = scope.locator('details.adjust');
  if (!(await adv.evaluate((d: HTMLDetailsElement) => d.open))) await adv.locator('summary').click();
}

export async function createCustomLamp(page: Page, opts: CustomLampOptions): Promise<void> {
  await page.locator('select#preset').selectOption('__add_custom__');

  const form = page.locator('.lamp-form');
  await expect(form).toBeVisible({ timeout: 15_000 });

  if (opts.lampType) {
    await form.locator('select#lamp-type-select').selectOption(opts.lampType);
  }

  await form.locator('#ies-file-input').setInputFiles(opts.ies);
  await expect(form.locator('.facet-card[data-facet="photometry"] .file-link .name')).toBeVisible({ timeout: 15_000 });

  // The fixture is auto-detected from the file; open its page (Edit on the
  // Fixture card) only when this lamp needs fixture changes.
  const changesFixture = !!(opts.axis || opts.face || opts.mountDistance != null);
  if (changesFixture) {
    await form.locator('[data-facet-open="fixture"]').click({ timeout: 15_000 });
  }

  if (opts.axis) {
    // The picker asks how the fixture is mounted; the beam points away from
    // the mount (ceiling = down, floor = up, wall = the opposite side faces it)
    const horizontal = opts.axis.startsWith('horizontal_');
    const group = horizontal ? 'wall' : opts.axis === 'up' ? 'floor' : 'ceiling';
    const btn = form.locator(`.mount-btn[data-group="${group}"]`);
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    if (horizontal) {
      await openFixtureAdvanced(form);
      await form.locator('#room-direction').selectOption(opts.axis);
    }
  }

  if (opts.face || opts.mountDistance != null) {
    // mounting face and offset live in the fixture editor's Advanced section
    await openFixtureAdvanced(form);
  }
  if (opts.face) {
    const btn = form.locator(`button[data-face="${opts.face}"]`);
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  }
  if (opts.mountDistance != null) {
    const input = form.locator('#mount-distance');
    await input.fill(String(opts.mountDistance));
    await input.press('Tab');
  }
  if (changesFixture) {
    // back to the three cards, where the spectrum and wavelength fields are
    await form.getByRole('button', { name: '‹ Back' }).click();
  }

  // Wavelength BEFORE spectrum: once a spectrum is attached its peak is the
  // wavelength, and the field is gone.
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
    const attached = form.locator('.spectrum-file-field .file-link .name');
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
  await lampEditor(page).locator('.placement-buttons button').filter({ hasText: preset }).click();
  await waitForApiIdle(page);
}

/** Click an aim preset button in the open lamp editor. */
export async function clickAimPreset(
  page: Page,
  preset: 'Down' | 'Corner' | 'Edge' | 'Horizontal'
): Promise<void> {
  await lampEditor(page).locator('.aim-presets button').filter({ hasText: preset }).click();
  await waitForApiIdle(page);
}

/** Click the tilt/orientation mode toggle button. */
export async function toggleTiltMode(page: Page): Promise<void> {
  await page.locator('button.mode-switch').click();
}

/** Open the advanced lamp settings modal (click "Details..." button). */
export async function openAdvancedSettings(page: Page): Promise<void> {
  await lampEditor(page).locator('button.secondary').filter({ hasText: 'Details...' }).click();
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

/** Click a lamp row to open its editor. */
export async function selectLamp(page: Page, index: number = 0): Promise<void> {
  await expandLampsPanel(page);
  const row = lampRows(page).nth(index);
  if (!(await row.evaluate((el) => el.classList.contains('open')))) {
    await row.locator('.row-main').click();
  }
  await expect(row.locator('.lamp-editor')).toBeVisible({ timeout: 5_000 });
}

/** Copy the currently open lamp via the editor's Copy button. */
export async function copyLamp(page: Page): Promise<void> {
  await lampEditor(page).locator('.editor-actions button').filter({ hasText: 'Copy' }).click();
  await waitForApiIdle(page);
}
