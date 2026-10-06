import { test, expect } from '@playwright/test';
import { waitForApiIdle } from '../helpers/network';
import { waitForSession } from '../helpers/session';
import { attachErrorGuard } from '../helpers/errors';
import { lampCount } from '../helpers/lamps';

test.describe('Lamps on the plan', () => {
  test('place two lamps by clicking, edit one beside the plan, undo the second', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await waitForSession(page);
    const header = page.locator('.panel-header').filter({ hasText: 'Lamps' });
    const content = header.locator('..').locator('.panel-content');
    if (!(await content.isVisible().catch(() => false))) await header.click();
    await page.getByRole('button', { name: 'Place on plan…' }).click();

    const modal = page.locator('.floor-plan-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Place' })).toHaveClass(/active/);
    const lampRows = modal.getByRole('listbox', { name: 'Lamps' }).getByRole('option');
    const plan = modal.locator('svg.plan');
    const box = await plan.boundingBox();
    if (!box) throw new Error('plan canvas not visible');

    await plan.click({ position: { x: box.width * 0.3, y: box.height * 0.5 } });
    await expect(lampRows).toHaveCount(1);
    // The selected lamp's full editor sits beside the plan
    const preset = modal.locator('.lamp-panel select#preset');
    await expect(preset).toBeVisible();
    await expect(preset.locator('option:not([disabled])')).not.toHaveCount(0, { timeout: 15_000 });
    await preset.selectOption((await preset.locator('option:not([disabled])').first().getAttribute('value'))!);
    // With photometry, height and aim appear beside the plan
    await expect(modal.locator('.lamp-panel').getByText(/^Position/)).toBeVisible({ timeout: 15_000 });
    await plan.click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
    await expect(lampRows).toHaveCount(2);
    // The second lamp copied the first one's fixture
    await expect(lampRows.nth(1)).not.toContainText('choose a fixture');
    await expect(modal.locator('circle.plan-lamp:not(.ghost)')).toHaveCount(2);
    await waitForApiIdle(page);

    await page.keyboard.press('Escape'); // stop placing
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(modal).toHaveCount(0);
    await expect.poll(() => lampCount(page)).toBe(2);

    await page.locator('.app-status-bar').click();
    await page.keyboard.press('Control+z');
    await expect.poll(() => lampCount(page)).toBe(1);
    guard.assertClean();
  });
});
