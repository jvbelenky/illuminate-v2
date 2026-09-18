import { test, expect } from '@playwright/test';
import { waitForApiIdle } from '../helpers/network';
import { setSidebarLayout } from '../helpers/layout';
import { waitForSession } from '../helpers/session';
import { attachErrorGuard } from '../helpers/errors';

test.describe('Guided sidebar', () => {
  test('start chooser: typical room places a lamp and calculates', async ({ page }) => {
    const guard = attachErrorGuard(page);
    // No init script here: this test wants the chooser.
    await page.goto('/');
    await expect(page.locator('span.status-indicator')).toBeVisible({ timeout: 15_000 });
    await waitForApiIdle(page);

    const chooser = page.getByRole('dialog').or(page.locator('.modal-content')).filter({ hasText: 'Start a design' });
    await expect(chooser.first()).toBeVisible({ timeout: 10_000 });
    await chooser.first().locator('.option').filter({ hasText: 'Typical room' }).click();

    await expect(page.locator('button.calculate-btn')).toHaveClass(/up-to-date/, { timeout: 60_000 });
    await expect(page.locator('.item-list-item[data-lamp-id]')).toHaveCount(1);
    await expect(page.locator('.stat-value, .summary-value').first()).toBeVisible({ timeout: 10_000 });
    // The card moves on to the results-level advice
    await expect(page.locator('.next-step')).toHaveAttribute('data-next-step', /compliant|near-limit|non-compliant|warnings|up-to-date/);
    guard.assertClean();
  });

  test('next-step card walks from no lamps to a calculation', async ({ page }) => {
    await waitForSession(page);

    const card = page.locator('.next-step');
    await expect(card).toHaveAttribute('data-next-step', 'no-lamps');
    await card.locator('.next-step-action').click();

    // A new lamp has no model yet: the card asks for one and the editor hides placement
    await expect(card).toHaveAttribute('data-next-step', 'lamp-needs-model', { timeout: 15_000 });
    const preset = page.locator('select#preset');
    await expect(preset).toBeVisible();
    await expect(page.locator('.lamp-editor .placement-hint')).toBeVisible();

    await expect(preset.locator('option:not([disabled])')).not.toHaveCount(0, { timeout: 15_000 });
    const value = await preset.locator('option:not([disabled])').first().getAttribute('value');
    await preset.selectOption(value!);

    await expect(card).toHaveAttribute('data-next-step', 'never-calculated', { timeout: 15_000 });
    await expect(page.locator('.lamp-editor .placement-hint')).toHaveCount(0);
    await card.locator('.next-step-action').click();
    await expect(page.locator('button.calculate-btn')).toHaveClass(/up-to-date/, { timeout: 60_000 });
    await expect(card).not.toHaveAttribute('data-next-step', 'never-calculated');
  });

  test('expert layout flattens the sidebar and shows standard-zone toggles', async ({ page }) => {
    await waitForSession(page);
    await expect(page.locator('.next-step')).toBeVisible();
    await expect(page.locator('.item-list-item.standard-zone')).toHaveCount(0);

    await setSidebarLayout(page, 'expert');
    await expect(page.locator('.next-step')).toHaveCount(0);
    await expect(page.locator('.item-list-item.standard-zone').first()).toBeVisible();
    await expect(page.locator('.item-list-item.standard-zone').first().locator('button.icon-toggle[aria-label*="Exclude"]')).toBeVisible();

    await setSidebarLayout(page, 'guided');
    await expect(page.locator('.next-step')).toBeVisible();
  });
});
