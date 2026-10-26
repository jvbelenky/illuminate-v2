import { test, expect } from '@playwright/test';
import { waitForApiIdle } from '../helpers/network';
import { waitForSession } from '../helpers/session';
import { attachErrorGuard } from '../helpers/errors';
import { lampCount, lampEditor } from '../helpers/lamps';
import { finishEditing, openStep, planSvg, planTool } from '../helpers/workspace';

test.describe('Lamps on the plan', () => {
  test('add lamps by fixture and placement, select them with a box, delete them together, undo', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await waitForSession(page);
    await openStep(page, 'lamps');

    // No lamps yet: the toolbar's tools are greyed out
    await expect(planTool(page, 'Move')).toBeDisabled();
    await expect(planTool(page, 'Delete')).toBeDisabled();

    // Choose a fixture: the placements appear; each adds a lamp placed automatically
    const part = page.locator('.lamps-part');
    const fixture = part.getByLabel('Fixture', { exact: true });
    await expect(fixture.locator('option[value^="preset:"]')).not.toHaveCount(0, { timeout: 15_000 });
    await fixture.selectOption((await fixture.locator('option[value^="preset:"]').first().getAttribute('value'))!);
    const placements = page.getByRole('group', { name: 'Placement' });
    const lampRows = part.locator('.editor-row');
    await placements.getByRole('button', { name: 'Downlight' }).click();
    await expect(lampRows).toHaveCount(1);
    await placements.getByRole('button', { name: 'Corner' }).click();
    await expect(lampRows).toHaveCount(2);
    await waitForApiIdle(page);
    // Both came with the fixture; Move is on
    await expect(lampRows.nth(1).locator('.subtitle')).not.toHaveText('');
    await expect(planTool(page, 'Move')).toHaveAttribute('aria-pressed', 'true');
    // The last one added is selected, with its full editor in its row
    await expect(lampEditor(page).locator('select#preset')).toBeVisible();

    // A Shift + drag box over the whole plan selects both; Delete removes them in one step
    // (a plain drag on empty space follows the view's Hand / Zoom mode)
    const box = await planSvg(page).boundingBox();
    if (!box) throw new Error('plan canvas not visible');
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expect(part.locator('.ep-chip', { hasText: '2 selected' })).toBeVisible();
    await planTool(page, 'Delete').click();
    await expect(lampRows).toHaveCount(0);

    await finishEditing(page);
    await expect.poll(() => lampCount(page)).toBe(0);
    await page.locator('.app-status-bar').click();
    await page.keyboard.press('Control+z');
    await expect.poll(() => lampCount(page)).toBe(2);
    guard.assertClean();
  });
});
