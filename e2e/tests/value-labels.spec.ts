import { test, expect } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { addZone, setCalcMode } from '../helpers/zones';

test.describe('Value Display labels', () => {
  test.beforeEach(async ({ page }) => {
    await waitForSession(page);
    await addZone(page);
  });

  test('default plane zone shows Irradiance', async ({ page }) => {
    const valueDisplay = page.locator('select#value-type');
    await expect(valueDisplay.locator('option[value="false"]')).toContainText('Irradiance');
  });

  test('Fluence Rate calc mode shows Irradiance label', async ({ page }) => {
    await setCalcMode(page, 'Fluence Rate');
    const valueDisplay = page.locator('select#value-type');
    await expect(valueDisplay.locator('option[value="false"]')).toContainText('Irradiance');
  });

  test('volume zone shows Irradiance by default', async ({ page }) => {
    await page.locator('button.zone-type-btn[title="CalcVol"]').click();
    await expect(page.locator('button.zone-type-btn[title="CalcVol"]')).toHaveClass(/active/, { timeout: 5_000 });
    const valueDisplay = page.locator('select#value-type');
    await expect(valueDisplay.locator('option[value="false"]')).toContainText('Irradiance');
  });
});
