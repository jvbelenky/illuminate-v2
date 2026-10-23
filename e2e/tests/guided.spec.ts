import { test, expect } from '@playwright/test';
import { waitForApiIdle } from '../helpers/network';
import { waitForSession } from '../helpers/session';
import { attachErrorGuard } from '../helpers/errors';
import { setRoomDimensions } from '../helpers/room';
import { addLampWithType, lampEditor } from '../helpers/lamps';
import { drawObject, expandObjectsPanel, objectEditor, setObjectField, getObjectsFromBackend } from '../helpers/objects';
import { clickPlan, finishEditing, planTool } from '../helpers/workspace';

test.describe('Guided workspace', () => {
  test('start chooser: See an example places a lamp, calculates and lands on the summary', async ({ page }) => {
    const guard = attachErrorGuard(page);
    // No init script here: this test wants the chooser.
    await page.goto('/');
    await expect(page.locator('.app-status-bar')).toBeVisible({ timeout: 15_000 });
    await waitForApiIdle(page);

    const card = page.locator('button.landing-card[data-choice="typical"]');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText('See an example');
    await card.click();

    // The chooser stays up (busy) until the lamp is placed and calculated
    await expect(card).toHaveCount(0, { timeout: 90_000 });
    await expect(page.locator('button.calculate-btn')).toHaveClass(/up-to-date/, { timeout: 60_000 });
    const summary = page.locator('.summary-panel');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('13 × 20 × 9 ft');
    await expect(summary.locator('.summary-block').filter({ has: page.locator('[data-edit="lamps"]') }).locator('.editor-row')).toHaveCount(1);
    await expect(page.locator('.results-section').first()).toBeVisible({ timeout: 10_000 });
    // The status-bar hint moves on to the results-level advice
    await expect(page.locator('.app-status-bar[data-next-step]')).toHaveAttribute('data-next-step', /compliant|near-limit|non-compliant|warnings|up-to-date/);
    guard.assertClean();
  });

  test('start chooser: Start designing opens the editor at the floor plan', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.app-status-bar')).toBeVisible({ timeout: 15_000 });
    await waitForApiIdle(page);
    const card = page.locator('button.landing-card[data-choice="empty"]');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText('Start designing');
    await card.click();
    await expect(page.locator('.editor-part[data-part="floorplan"][aria-selected="true"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('button.landing-card')).toHaveCount(0);
  });

  test('status-bar hint walks from no lamps to a calculation', async ({ page }) => {
    await waitForSession(page);

    const card = page.locator('.app-status-bar[data-next-step]');
    await expect(card).toHaveAttribute('data-next-step', 'no-lamps');

    // A lamp of another type has no model yet: the hint asks for one and the editor hides placement
    await addLampWithType(page, 'lp_254');
    await expect(card).toHaveAttribute('data-next-step', 'lamp-needs-model', { timeout: 15_000 });
    const preset = lampEditor(page).locator('select#preset');
    await expect(preset).toBeVisible();
    await expect(lampEditor(page).locator('.section-label', { hasText: 'Position' })).toHaveCount(0);

    // Only 222 nm lamps have presets: back to that type, then pick one
    await lampEditor(page).locator('select#lamp-type').selectOption('krcl_222');
    await expect(preset.locator('option:not([disabled])')).not.toHaveCount(0, { timeout: 15_000 });
    const value = await preset.locator('option:not([disabled])').first().getAttribute('value');
    await preset.selectOption(value!);

    await expect(card).toHaveAttribute('data-next-step', 'never-calculated', { timeout: 15_000 });
    await expect(lampEditor(page).locator('.section-label', { hasText: 'Position' })).toBeVisible();
    await page.locator('button.calculate-btn').click();
    await expect(page.locator('button.calculate-btn')).toHaveClass(/up-to-date/, { timeout: 60_000 });
    await expect(card).not.toHaveAttribute('data-next-step', 'never-calculated');
  });

  test('structures are a Room part; floor-to-ceiling follows the room height', async ({ page }) => {
    await waitForSession(page);
    await expandObjectsPanel(page);
    await expect(page.getByRole('button', { name: '+ Add structure' })).toBeVisible();

    await drawObject(page);
    const editor = objectEditor(page);
    const row = page.locator('.structures-part .editor-row');
    // A drawn obstacle starts floor to ceiling
    await expect(editor.locator('#object-full-height')).toBeChecked();
    await expect(row.locator('.subtitle')).toContainText('floor to ceiling');
    await editor.locator('#object-full-height').uncheck();
    await expect(editor.locator('#object-bottom')).toHaveValue(/^0(\.0+)?$/);

    // Bottom and top map onto z and height
    await setObjectField(page, 'top', 2.2);
    await setObjectField(page, 'bottom', 0.7);
    await expect.poll(async () => {
      const [o] = await getObjectsFromBackend(page);
      return [o.z, Number(o.height.toFixed(6))];
    }).toEqual([0.7, 1.5]);
    await expect(row.locator('.subtitle')).toContainText('0.7 to 2.2 m');

    // Floor to ceiling spans the room and hides the fields
    await editor.locator('#object-full-height').check();
    await expect(editor.locator('#object-bottom')).toHaveCount(0);
    await expect(row.locator('.subtitle')).toContainText('floor to ceiling');
    await expect.poll(async () => (await getObjectsFromBackend(page))[0].height).toBe(2.7);

    // A taller room keeps the object full height
    await setRoomDimensions(page, { z: 3.2 });
    await expect.poll(async () => (await getObjectsFromBackend(page))[0].height, { timeout: 10_000 }).toBe(3.2);
    await expandObjectsPanel(page);
    await expect(row.locator('.subtitle')).toContainText('floor to ceiling');
  });

  test('Next leads from the floor plan to structures; a drawn one lands in the room at once', async ({ page }) => {
    await waitForSession(page);
    await page.locator('.editor-nav .editor-next').click();
    await expect(page.locator('.editor-part[data-part="structures"][aria-selected="true"]')).toBeVisible();
    await planTool(page, 'Draw').click();
    await expect(page.locator('.plan-pane svg.plan.drawing')).toHaveCount(1);
    await clickPlan(page, [[0.4, 0.6], [0.6, 0.6], [0.6, 0.4], [0.4, 0.4]], { close: true });
    await expect(page.locator('.structures-part .editor-row')).toHaveCount(1);
    // Applied as soon as it closed, before the editor is left
    await expect.poll(async () => (await getObjectsFromBackend(page)).length).toBe(1);
    await finishEditing(page);
    const [o] = await getObjectsFromBackend(page);
    expect(o.height).toBeCloseTo(2.7, 6);
    expect(o.name).toBe('Obstacle 1');
  });
});
