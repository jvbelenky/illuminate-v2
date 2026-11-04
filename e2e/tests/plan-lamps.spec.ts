import { test, expect } from '@playwright/test';
import { waitForApiIdle } from '../helpers/network';
import { waitForSession } from '../helpers/session';
import { attachErrorGuard } from '../helpers/errors';
import { lampCount, lampEditor } from '../helpers/lamps';
import { getLampsFromStore } from '../helpers/api';
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
    // Both came with the fixture; Move is offered, not armed
    await expect(lampRows.nth(1).locator('.subtitle')).not.toHaveText('');
    await expect(planTool(page, 'Move')).toHaveAttribute('aria-pressed', 'false');
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

  test("opening a lamp's row selects that lamp on the plan, in the selection cyan, and Move moves it", async ({ page }) => {
    const guard = attachErrorGuard(page);
    await waitForSession(page);
    await openStep(page, 'lamps');
    const part = page.locator('.lamps-part');
    const fixture = part.getByLabel('Fixture', { exact: true });
    await expect(fixture.locator('option[value^="preset:"]')).not.toHaveCount(0, { timeout: 15_000 });
    const placements = page.getByRole('group', { name: 'Placement' });
    await fixture.selectOption({ label: 'Aerolamp DevKit' });
    await placements.getByRole('button', { name: 'Downlight' }).click();
    await waitForApiIdle(page);
    await fixture.selectOption({ label: 'Beacon' });
    await placements.getByRole('button', { name: 'Corner' }).click();
    await waitForApiIdle(page);

    // Open Lamp 1 (Lamp 2, added last, was open)
    await part.locator('.editor-row .row-main').first().click();
    await expect(part.locator('.editor-row.open .name')).toHaveText('Lamp 1');
    const plan = planSvg(page);
    const lamp1 = plan.locator('circle.plan-lamp[aria-label="Lamp Lamp 1"]');
    const lamp2 = plan.locator('circle.plan-lamp[aria-label="Lamp Lamp 2"]');
    await expect(lamp1).toHaveClass(/\bselected\b/);
    await expect(lamp2).not.toHaveClass(/\bselected\b/);
    const cyan = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.color = 'var(--color-scene-selected)';
      document.body.append(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    expect(await lamp1.evaluate((e) => getComputedStyle(e).stroke)).toBe(cyan);
    expect(await lamp2.evaluate((e) => getComputedStyle(e).stroke)).not.toBe(cyan);

    // Move: one drag on the plan moves Lamp 1, not Lamp 2
    const before = await getLampsFromStore(page);
    await planTool(page, 'Move').click();
    const b = (await lamp1.boundingBox())!;
    const [x, y] = [b.x + b.width / 2 + 120, b.y + b.height / 2 + 60];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 40, y + 20, { steps: 5 });
    await page.mouse.up();
    await waitForApiIdle(page);
    const after = await getLampsFromStore(page);
    const at = (ls: Record<string, any>[], name: string) => ls.find((l) => l.name === name)!;
    expect([at(after, 'Lamp 1').x, at(after, 'Lamp 1').y]).not.toEqual([at(before, 'Lamp 1').x, at(before, 'Lamp 1').y]);
    expect([at(after, 'Lamp 2').x, at(after, 'Lamp 2').y]).toEqual([at(before, 'Lamp 2').x, at(before, 'Lamp 2').y]);
    guard.assertClean();
  });

  test("the lamp editor's Copy opens the copy and Delete removes it; undo brings it back", async ({ page }) => {
    await waitForSession(page);
    await openStep(page, 'lamps');
    const part = page.locator('.lamps-part');
    const fixture = part.getByLabel('Fixture', { exact: true });
    await expect(fixture.locator('option[value^="preset:"]')).not.toHaveCount(0, { timeout: 15_000 });
    await fixture.selectOption((await fixture.locator('option[value^="preset:"]').first().getAttribute('value'))!);
    await page.getByRole('group', { name: 'Placement' }).getByRole('button', { name: 'Downlight' }).click();
    const lampRows = part.locator('.editor-row');
    await expect(lampRows).toHaveCount(1);
    await waitForApiIdle(page);
    const open = part.locator('.editor-row.open');
    const firstId = await open.getAttribute('data-id');

    await open.getByRole('button', { name: 'Copy (Ctrl+D)' }).click();
    await expect(lampRows).toHaveCount(2);
    await expect(open).not.toHaveAttribute('data-id', firstId!);
    await waitForApiIdle(page);

    await open.getByRole('button', { name: 'Delete (Del)' }).click();
    await expect(lampRows).toHaveCount(1);
    await waitForApiIdle(page);

    await page.locator('.app-status-bar').click();
    await page.keyboard.press('Control+z');
    await expect.poll(() => lampCount(page)).toBe(2);
  });

  test('Ctrl+C then Ctrl+V pastes a copy of the selected lamp, selected; one undo removes it', async ({ page }) => {
    await waitForSession(page);
    await openStep(page, 'lamps');
    const part = page.locator('.lamps-part');
    const fixture = part.getByLabel('Fixture', { exact: true });
    await expect(fixture.locator('option[value^="preset:"]')).not.toHaveCount(0, { timeout: 15_000 });
    await fixture.selectOption((await fixture.locator('option[value^="preset:"]').first().getAttribute('value'))!);
    await page.getByRole('group', { name: 'Placement' }).getByRole('button', { name: 'Downlight' }).click();
    const lampRows = part.locator('.editor-row');
    await expect(lampRows).toHaveCount(1);
    await waitForApiIdle(page);
    const firstId = await part.locator('.editor-row.open').getAttribute('data-id');

    await page.locator('.app-status-bar').click();
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await expect(lampRows).toHaveCount(2);
    await expect(part.locator('.editor-row.open')).not.toHaveAttribute('data-id', firstId!);
    await waitForApiIdle(page);

    await page.locator('.app-status-bar').click();
    await page.keyboard.press('Control+z');
    await expect.poll(() => lampCount(page)).toBe(1);
  });

  test('double-click a lamp to type its height; double-click its name to rename it', async ({ page }) => {
    await waitForSession(page);
    await openStep(page, 'lamps');
    const part = page.locator('.lamps-part');
    const fixture = part.getByLabel('Fixture', { exact: true });
    await expect(fixture.locator('option[value^="preset:"]')).not.toHaveCount(0, { timeout: 15_000 });
    await fixture.selectOption((await fixture.locator('option[value^="preset:"]').first().getAttribute('value'))!);
    await page.getByRole('group', { name: 'Placement' }).getByRole('button', { name: 'Downlight' }).click();
    await expect(part.locator('.editor-row')).toHaveCount(1);
    await waitForApiIdle(page);
    const [before] = await getLampsFromStore(page);

    // X / Y / Z at the lamp (a downlight's aim dot sits on it and opens the same); Tab to Z, type a height
    const plan = planSvg(page);
    const rb = (await plan.locator('circle.plan-lamp').first().boundingBox())!;
    await page.mouse.dblclick(rb.x + rb.width / 2, rb.y + rb.height / 2);
    const name = before.name || before.id;
    const x = page.getByRole('textbox', { name: `${name} X` });
    await expect(x).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('textbox', { name: `${name} Z` })).toBeFocused();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('2.1');
    await page.keyboard.press('Enter');
    await expect(x).toHaveCount(0);
    await expect.poll(async () => (await getLampsFromStore(page))[0].z).toBeCloseTo(2.1, 6);
    const [moved] = await getLampsFromStore(page);
    expect(moved.x).toBeCloseTo(before.x, 6);
    expect(moved.aimz - moved.z).toBeCloseTo(before.aimz - before.z, 6);

    // Rename from the plan label
    await plan.locator('text.plan-lamp-label').first().dblclick();
    const field = page.getByRole('textbox', { name: 'Name' });
    await expect(field).toBeFocused();
    await page.keyboard.type('Over desk');
    await page.keyboard.press('Enter');
    await expect(plan.locator('text.plan-lamp-label').first()).toHaveText('Over desk');
    await expect(part.locator('.editor-row .name').first()).toHaveText('Over desk');
  });
});
