import { test, expect, type Page } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { addZone, setCalcMode } from '../helpers/zones';

test.describe.serial('Value Display labels', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await waitForSession(page);
    await addZone(page);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('default plane zone shows Irradiance', async () => {
    const valueDisplay = page.locator('select#value-type');
    await expect(valueDisplay.locator('option[value="false"]')).toContainText('Irradiance');
  });

  test('Fluence Rate calc mode shows Irradiance label', async () => {
    await setCalcMode(page, 'Fluence Rate');
    const valueDisplay = page.locator('select#value-type');
    await expect(valueDisplay.locator('option[value="false"]')).toContainText('Irradiance');
  });

  test('volume zone shows Irradiance by default', async () => {
    await page.locator('button.zone-type-btn[title="CalcVol"]').click();
    await expect(page.locator('button.zone-type-btn[title="CalcVol"]')).toHaveClass(/active/, { timeout: 5_000 });
    const valueDisplay = page.locator('select#value-type');
    await expect(valueDisplay.locator('option[value="false"]')).toContainText('Irradiance');
  });
});
