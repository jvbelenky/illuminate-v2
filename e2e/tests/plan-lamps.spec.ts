import { test, expect } from '@playwright/test';
import { waitForApiIdle } from '../helpers/network';
import { waitForSession } from '../helpers/session';
import { attachErrorGuard } from '../helpers/errors';
import { lampCount } from '../helpers/lamps';

test.describe('Lamps on the plan', () => {
  test('add lamps by fixture and placement, select them with a box, delete them together, undo', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await waitForSession(page);
    const header = page.locator('.panel-header').filter({ hasText: 'Lamps' });
    const content = header.locator('..').locator('.panel-content');
    if (!(await content.isVisible().catch(() => false))) await header.click();
    await page.getByRole('button', { name: 'Place on plan…' }).click();

    const modal = page.locator('.floor-plan-modal');
    await expect(modal).toBeVisible();
    // No lamps yet: the ribbon's tools are greyed out
    await expect(modal.getByRole('button', { name: 'Move' })).toBeDisabled();
    await expect(modal.getByRole('button', { name: 'Delete' })).toBeDisabled();

    // Choose a fixture: the placements appear; each adds a lamp placed automatically
    const fixture = modal.getByLabel('Fixture', { exact: true });
    await expect(fixture.locator('option[value^="preset:"]')).not.toHaveCount(0, { timeout: 15_000 });
    await fixture.selectOption((await fixture.locator('option[value^="preset:"]').first().getAttribute('value'))!);
    const placements = modal.getByRole('group', { name: 'Placement' });
    const lampRows = modal.getByRole('listbox', { name: 'Lamps' }).getByRole('option');
    await placements.getByRole('button', { name: 'Downlight' }).click();
    await expect(lampRows).toHaveCount(1);
    await placements.getByRole('button', { name: 'Corner' }).click();
    await expect(lampRows).toHaveCount(2);
    await waitForApiIdle(page);
    // Both came with the fixture; Move is on
    await expect(lampRows.nth(1)).not.toContainText('choose a fixture');
    await expect(modal.getByRole('button', { name: 'Move' })).toHaveClass(/active/);
    // The last one added is selected, with its full editor beside the plan
    await expect(modal.locator('.lamp-panel select#preset')).toBeVisible();

    // A box over the whole plan selects both; Delete removes them in one step
    const plan = modal.locator('svg.plan');
    const box = await plan.boundingBox();
    if (!box) throw new Error('plan canvas not visible');
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4, { steps: 6 });
    await page.mouse.up();
    await expect(modal.getByText(/^2 lamps selected\./)).toBeVisible();
    await modal.getByRole('button', { name: 'Delete' }).click();
    await expect(lampRows).toHaveCount(0);

    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(modal).toHaveCount(0);
    await expect.poll(() => lampCount(page)).toBe(0);
    await page.locator('.app-status-bar').click();
    await page.keyboard.press('Control+z');
    await expect.poll(() => lampCount(page)).toBe(2);
    guard.assertClean();
  });
});
