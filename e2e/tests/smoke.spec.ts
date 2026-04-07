import { test, expect, type Page } from '@playwright/test';
import { waitForSession } from '../helpers/session';

test.describe.serial('Smoke tests', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await waitForSession(page);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('app loads and session initializes', async () => {
    await expect(page.locator('text=Ready')).toBeVisible();
  });

  test('3D room canvas renders', async () => {
    await expect(page.locator('canvas')).toBeVisible();
  });

  test('left panel sections are visible', async () => {
    await expect(page.locator('h3:has-text("Room")')).toBeVisible();
    await expect(page.locator('h3:has-text("Lamps")')).toBeVisible();
    await expect(page.locator('h3:has-text("Calc Zones")')).toBeVisible();
  });

  test('status bar shows lamp and zone counts', async () => {
    await expect(page.locator('text=Lamps:')).toBeVisible();
    await expect(page.locator('text=Zones:')).toBeVisible();
  });
});
