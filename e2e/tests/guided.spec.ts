import { test, expect } from '@playwright/test';
import { waitForApiIdle } from '../helpers/network';
import { waitForSession } from '../helpers/session';
import { attachErrorGuard } from '../helpers/errors';
import { expandRoomPanel, setRoomDimensions } from '../helpers/room';
import { addObject, setObjectField, getObjectsFromBackend } from '../helpers/objects';

test.describe('Guided sidebar', () => {
  test('start chooser: typical room places a lamp and calculates', async ({ page }) => {
    const guard = attachErrorGuard(page);
    // No init script here: this test wants the chooser.
    await page.goto('/');
    await expect(page.locator('.app-status-bar')).toBeVisible({ timeout: 15_000 });
    await waitForApiIdle(page);

    const chooser = page.getByRole('dialog').or(page.locator('.modal-content')).filter({ hasText: 'Start a design' });
    await expect(chooser.first()).toBeVisible({ timeout: 10_000 });
    await chooser.first().locator('.option').filter({ hasText: 'Example room' }).click();

    // The chooser stays up (busy) until the lamp is placed and calculated
    await expect(chooser.first()).toHaveCount(0, { timeout: 90_000 });
    await expect(page.locator('button.calculate-btn')).toHaveClass(/up-to-date/, { timeout: 60_000 });
    await expect(page.locator('.room-editor input').first()).toHaveValue('13.0');
    await expect(page.locator('.item-list-item[data-lamp-id]')).toHaveCount(1);
    await expect(page.locator('.results-section').first()).toBeVisible({ timeout: 10_000 });
    // The status-bar hint moves on to the results-level advice
    await expect(page.locator('.app-status-bar[data-next-step]')).toHaveAttribute('data-next-step', /compliant|near-limit|non-compliant|warnings|up-to-date/);
    guard.assertClean();
  });

  test('start chooser: empty room opens the floor-plan editor', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.app-status-bar')).toBeVisible({ timeout: 15_000 });
    await waitForApiIdle(page);
    const chooser = page.locator('.modal-content').filter({ hasText: 'Start a design' }).first();
    await expect(chooser).toBeVisible({ timeout: 10_000 });
    await chooser.locator('.option').filter({ hasText: 'Empty room' }).click();
    await expect(page.locator('.floor-plan-modal')).toBeVisible({ timeout: 10_000 });
    await expect(chooser).toHaveCount(0);
  });

  test('status-bar hint walks from no lamps to a calculation', async ({ page }) => {
    await waitForSession(page);

    const card = page.locator('.app-status-bar[data-next-step]');
    await expect(card).toHaveAttribute('data-next-step', 'no-lamps');
    await page.locator('button.add-btn:has-text("Add lamp")').click();

    // A new lamp has no model yet: the hint asks for one and the editor hides placement
    await expect(card).toHaveAttribute('data-next-step', 'lamp-needs-model', { timeout: 15_000 });
    const preset = page.locator('select#preset');
    await expect(preset).toBeVisible();
    await expect(page.locator('.lamp-editor .placement-hint')).toBeVisible();

    await expect(preset.locator('option:not([disabled])')).not.toHaveCount(0, { timeout: 15_000 });
    const value = await preset.locator('option:not([disabled])').first().getAttribute('value');
    await preset.selectOption(value!);

    await expect(card).toHaveAttribute('data-next-step', 'never-calculated', { timeout: 15_000 });
    await expect(page.locator('.lamp-editor .placement-hint')).toHaveCount(0);
    await page.locator('button.calculate-btn').click();
    await expect(page.locator('button.calculate-btn')).toHaveClass(/up-to-date/, { timeout: 60_000 });
    await expect(card).not.toHaveAttribute('data-next-step', 'never-calculated');
  });

  test('objects are step 2; floor-to-ceiling follows the room height', async ({ page }) => {
    await waitForSession(page);
    await expandRoomPanel(page);
    // Objects are step 2, an optional step of their own
    const objectsStep = page.locator('.step[data-step="objects"]');
    await objectsStep.locator('.panel-header').click();
    await expect(objectsStep.locator('button.add-object-btn')).toBeVisible();

    await addObject(page);
    const editor = page.locator('[data-object-id] .inline-editor');
    // A drawn obstacle starts floor to ceiling
    await expect(editor.locator('#object-full-height')).toBeChecked();
    await expect(page.locator('[data-object-id] .lamp-subtitle')).toContainText('floor to ceiling');
    await editor.locator('#object-full-height').uncheck();
    await expect(editor.locator('#object-bottom')).toHaveValue('0.0');

    // Bottom and top map onto z and height
    await setObjectField(page, 'top', 2.2);
    await setObjectField(page, 'bottom', 0.7);
    await expect.poll(async () => {
      const [o] = await getObjectsFromBackend(page);
      return [o.z, Number(o.height.toFixed(6))];
    }).toEqual([0.7, 1.5]);
    await expect(page.locator('[data-object-id] .lamp-subtitle')).toContainText('0.7 to 2.2 m');

    // Floor to ceiling spans the room and hides the fields
    await editor.locator('#object-full-height').check();
    await expect(editor.locator('#object-bottom')).toHaveCount(0);
    await expect(page.locator('[data-object-id] .lamp-subtitle')).toContainText('floor to ceiling');
    await expect.poll(async () => (await getObjectsFromBackend(page))[0].height).toBe(2.7);

    // A taller room keeps the object full height
    await setRoomDimensions(page, { z: 3.2 });
    await expect.poll(async () => (await getObjectsFromBackend(page))[0].height, { timeout: 10_000 }).toBe(3.2);
    await expect(page.locator('[data-object-id] .lamp-subtitle')).toContainText('floor to ceiling');
  });

  test('outline apply offers obstacles; drawing one lands it in the room', async ({ page }) => {
    await waitForSession(page);
    await expandRoomPanel(page);
    await page.locator('.room-editor').getByRole('button', { name: 'Edit floor plan' }).click();
    const modal = page.locator('.floor-plan-modal');
    await expect(modal).toBeVisible();
    await page.getByRole('button', { name: 'Apply' }).click();
    // The prompt, then the Obstacles layer with Draw armed
    await page.getByRole('button', { name: 'Add obstacles' }).click();
    await expect(modal.locator('svg.plan.drawing')).toHaveCount(1);
    const plan = modal.locator('svg.plan');
    const box = await plan.boundingBox();
    if (!box) throw new Error('plan canvas not visible');
    for (const [fx, fy] of [[0.4, 0.6], [0.6, 0.6], [0.6, 0.4], [0.4, 0.4]] as [number, number][]) {
      await plan.click({ position: { x: box.width * fx, y: box.height * fy } });
    }
    await page.keyboard.press('Enter');
    await expect(modal.locator('.obstacle-row')).toHaveCount(1);
    // Draw stays armed; Apply still works and closes the editor
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(modal).toHaveCount(0);
    await expect.poll(async () => (await getObjectsFromBackend(page)).length).toBe(1);
    const [o] = await getObjectsFromBackend(page);
    expect(o.height).toBeCloseTo(2.7, 6);
    expect(o.name).toBe('Obstacle 1');
  });
});
