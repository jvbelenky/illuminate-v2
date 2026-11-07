import { test, expect, type Page } from '@playwright/test';
import { waitForApiIdle } from '../helpers/network';
import { waitForSession } from '../helpers/session';
import { attachErrorGuard } from '../helpers/errors';
import { addLamp, fixtureSelect, lampEditor } from '../helpers/lamps';
import { getLampsFromStore } from '../helpers/api';
import { openStep, planSvg } from '../helpers/workspace';

/** Toggle a View menu item; the menu stays open for the next one. */
async function toggleView(page: Page, item: string): Promise<void> {
  const menu = page.locator('.menu-bar-item').filter({ hasText: 'View' });
  if (!(await menu.locator('div[role="menuitem"]', { hasText: item }).isVisible())) {
    await menu.locator('span[role="button"]').click();
  }
  await menu.locator('div[role="menuitem"]', { hasText: item }).first().click();
  await page.keyboard.press('Escape');
}

test.describe('View options apply to the 2D plan as to 3D', () => {
  test('Show Grid toggles the plan grid; the plan never draws dimension rulers or the XYZ marker', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await waitForSession(page);
    const plan = planSvg(page);
    await expect(plan).toBeVisible();

    await expect(plan.locator('line.grid-line.major').first()).toBeAttached();
    await expect(plan.locator('text.ruler-label')).toHaveCount(0);
    await expect(plan.locator('g.xyz-marker')).toHaveCount(0);

    await toggleView(page, 'Show Grid');
    await expect(plan.locator('line.grid-line')).toHaveCount(0);
    await toggleView(page, 'Show Grid');
    await expect(plan.locator('line.grid-line').first()).toBeAttached();

    // 3D-only options: switching them leaves the plan without rulers or marker
    await toggleView(page, 'Show Dimensions');
    await toggleView(page, 'Show XYZ Marker');
    await toggleView(page, 'Show Dimensions');
    await toggleView(page, 'Show XYZ Marker');
    await expect(plan.locator('.rulers')).toHaveCount(0);
    await expect(plan.locator('g.xyz-marker')).toHaveCount(0);
    guard.assertClean();
  });

  test('Show Lamp Labels sets every lamp\'s 2D and 3D label', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await waitForSession(page);
    await openStep(page, 'lamps');
    await addLamp(page);
    await fixtureSelect(page).selectOption({ label: 'Beacon' });
    const button = lampEditor(page).getByRole('group', { name: 'Placement' }).getByRole('button', { name: 'Downlight' });
    await expect(button).toBeEnabled({ timeout: 15_000 });
    await button.click();
    await waitForApiIdle(page);
    const plan = planSvg(page);
    // A new lamp's name shows on the plan (2D labels default on); the 3D one follows the option (off)
    await expect(plan.locator('text.plan-lamp-label', { hasText: 'Lamp 1' })).toBeVisible();

    await toggleView(page, 'Show Lamp Labels');
    await expect.poll(async () => (await getLampsFromStore(page)).map((l) => [l.show_label, l.show_label_2d])).toEqual([[true, true]]);
    await toggleView(page, 'Show Lamp Labels');
    await expect.poll(async () => (await getLampsFromStore(page)).map((l) => [l.show_label, l.show_label_2d])).toEqual([[false, false]]);
    await expect(plan.locator('text.plan-lamp-label')).toHaveCount(0);
    guard.assertClean();
  });
});
