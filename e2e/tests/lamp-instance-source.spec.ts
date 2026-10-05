import { test, expect } from '../fixtures';
import { waitForSession } from '../helpers/session';
import { addLampWithType, createCustomLamp, openAdvancedSettings } from '../helpers/lamps';
import { getLampsFromStore, getLampInfoFromBackend } from '../helpers/api';
import path from 'path';

const IES_FIXTURE = path.resolve(__dirname, '../fixtures/test-lamp.ies');
const SPECTRUM_FIXTURE = path.resolve(__dirname, '../fixtures/test-spectrum.csv');

test.describe('Custom lamp instance source editing', () => {
  test('wavelength and spectrum are editable per instance in Advanced Lamp Settings', async ({ page }) => {
    test.setTimeout(60_000);
    await waitForSession(page);

    await addLampWithType(page, 'other');
    await createCustomLamp(page, { ies: IES_FIXTURE, wavelength: 280 });
    await openAdvancedSettings(page);

    const dialog = page.locator('[role="dialog"]');
    const wavelength = dialog.locator('#source-wavelength');
    await expect(wavelength).toHaveValue('280', { timeout: 15_000 });

    // Wavelength edit lands on this instance (store and backend).
    await wavelength.fill('265');
    await wavelength.press('Tab');
    await expect.poll(async () => (await getLampsFromStore(page))[0].wavelength).toBe(265);
    const lampId = (await getLampsFromStore(page))[0].id;

    // Attaching a spectrum uploads to the instance; the peak then owns the wavelength.
    await dialog.locator('.spectrum-file-field input[type="file"]').setInputFiles(SPECTRUM_FIXTURE);
    const useSelected = page.locator('.column-picker-actions button.primary');
    const attached = dialog.locator('.spectrum-file-field .file-status.success');
    await expect(useSelected.or(attached).first()).toBeVisible({ timeout: 15_000 });
    if (await useSelected.isVisible()) await useSelected.click();
    await expect(attached).toContainText('test-spectrum.csv', { timeout: 15_000 });
    await expect(wavelength).toBeDisabled({ timeout: 15_000 });
    await expect.poll(async () => (await getLampInfoFromBackend(page, lampId)).has_spectrum, { timeout: 15_000 }).toBe(true);

    // Removing it clears the instance's spectrum and frees the wavelength.
    await dialog.getByTitle('Remove spectrum file').click();
    await expect(wavelength).toBeEnabled();
    await expect.poll(async () => (await getLampInfoFromBackend(page, lampId)).has_spectrum, { timeout: 15_000 }).toBe(false);
    await expect(dialog.getByText('Select Spectrum File')).toBeVisible();
  });
});
