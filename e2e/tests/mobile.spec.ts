import { type Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { waitForApiIdle } from '../helpers/network';
import { addLampFromPreset } from '../helpers/lamps';
import { clickPlan, finishEditing, planSvg } from '../helpers/workspace';

// The phone layout: a top bar (☰, file name, Calculate), the Design tab (one
// view pinned over the editor, ⤢ for full screen) and the Results tab.

/** Load the app on a phone and wait for the session (the status bar is hidden there). */
async function openMobile(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const key = 'illuminate-settings';
    const s = JSON.parse(localStorage.getItem(key) || '{}');
    s.showStartChooser = false;
    localStorage.setItem(key, JSON.stringify(s));
  });
  await page.goto('/');
  await expect(page.locator('.mobile-tab-bar')).toBeVisible({ timeout: 15_000 });
  await waitForApiIdle(page);
}

const view = (page: Page) => page.locator('.mobile-view');
const editor = (page: Page) => page.locator('.mobile-editor');
const fullButton = (page: Page) => page.getByRole('button', { name: 'Full screen view' });
const exitButton = (page: Page) => page.getByRole('button', { name: 'Exit full screen' });

/** Drag one finger across the plan canvas (real touch events, via CDP). */
async function touchDrag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const point = ([x, y]: [number, number]) => [{ x, y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from) });
  for (let i = 1; i <= 5; i++) {
    const p: [number, number] = [from[0] + ((to[0] - from[0]) * i) / 5, from[1] + ((to[1] - from[1]) * i) / 5];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(p) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** One finger pans the plan: the canvas's viewBox moves. */
async function expectTouchPans(page: Page): Promise<void> {
  const svg = planSvg(page);
  const box = (await svg.boundingBox())!;
  const before = await svg.getAttribute('viewBox');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await touchDrag(page, [cx + 40, cy + 10], [cx - 40, cy - 10]);
  await expect.poll(() => svg.getAttribute('viewBox')).not.toBe(before);
}

test.describe('Mobile layout', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

  test.beforeEach(({ errorGuard }) => {
    // KNOWN PRE-EXISTING BUG (not caused by this suite; reproduces on main).
    // @threlte/extras <Grid> reads `material.uniforms.worldCamProjPosition` in a
    // useTask that can run before the mesh's ShaderMaterial is initialised, so
    // `material.uniforms` is undefined and the task throws. Only reproduces at
    // this viewport. Remove this allowance once the Grid mount race is fixed.
    errorGuard.allow(/worldCamProjPosition/);
  });

  test('top bar, two tabs, and one view with a 2D | 3D toggle', async ({ page }) => {
    await openMobile(page);

    // Top bar: ☰, the file name, Calculate; no app title
    const bar = page.locator('.menu-bar');
    await expect(bar.getByRole('button', { name: 'Open menu' })).toBeVisible();
    await expect(bar.getByRole('button', { name: /Calculate/ })).toBeVisible();
    await expect(bar).not.toContainText('Illuminate v2');
    await expect(page.locator('.mobile-calculate-bar')).toHaveCount(0);

    // Two tabs, Design first and active
    const tabs = page.locator('.mobile-tab-bar .mobile-tab');
    await expect(tabs).toHaveText(['Design', 'Results']);
    await expect(tabs.first()).toHaveClass(/active/);

    // One view at a time: 2D shows, 3D waits hidden (mounted)
    const toggle = view(page).getByRole('group', { name: 'Main view' });
    await expect(toggle.getByRole('button', { name: '2D', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(planSvg(page)).toBeVisible();
    await expect(view(page).locator('.view-slot[data-view="3d"] canvas')).toBeHidden();
    await expect(view(page).getByRole('button', { name: 'Fit' })).toBeVisible();
    await expect(view(page).getByRole('combobox', { name: 'Surface' })).toBeAttached();
    // No Pan / Zoom / − + and no units on the view
    await expect(view(page).locator('.view-controls')).toHaveCount(0);
    await expect(view(page).getByRole('button', { name: 'Pan' })).toHaveCount(0);

    await toggle.getByRole('button', { name: '3D', exact: true }).click();
    await expect(view(page).locator('.view-slot[data-view="3d"] canvas')).toBeVisible();
    await expect(planSvg(page)).toBeHidden();
    await expect(view(page).getByRole('combobox', { name: 'Surface' })).toHaveCount(0);
    await expect(view(page).getByRole('button', { name: 'Fit' })).toBeVisible();

    // The editor sits below the view
    await expect(editor(page)).toBeVisible();

    // Units live in the ☰ menu
    await bar.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.locator('.mobile-menu-overlay').getByLabel('Units')).toBeVisible();
  });

  test('⤢ takes the view full screen and ⤡, Escape or Back leave it', async ({ page }) => {
    await openMobile(page);
    const viewHeight = async () => (await view(page).boundingBox())!.height;
    const pinned = await viewHeight();

    await fullButton(page).click();
    await expect(exitButton(page)).toBeVisible();
    await expect(editor(page)).toBeHidden();
    expect(await viewHeight()).toBeGreaterThan(pinned + 100);
    // The edit strip shows bottom-left
    await expect(view(page).locator('.plan-toolbar')).toBeVisible();
    await exitButton(page).click();
    await expect(editor(page)).toBeVisible();
    await expect(fullButton(page)).toBeVisible();

    await fullButton(page).click();
    await page.keyboard.press('Escape');
    await expect(editor(page)).toBeVisible();

    await fullButton(page).click();
    await expect(editor(page)).toBeHidden();
    await page.goBack();
    await expect(editor(page)).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test('Draw outline goes full screen and returns when the drawing ends', async ({ page }) => {
    await openMobile(page);
    // A new project opens the editor at Room › Floorplan
    await editor(page).getByRole('button', { name: 'Draw outline' }).click();
    await expect(exitButton(page)).toBeVisible();
    await expect(editor(page)).toBeHidden();
    await clickPlan(page, [[0.25, 0.3], [0.75, 0.3], [0.75, 0.7], [0.25, 0.7]], { close: true });
    await expect(editor(page)).toBeVisible();
    await expect(fullButton(page)).toBeVisible();

    // A full screen the user chose stays after a drawing ends
    await fullButton(page).click();
    await view(page).locator('.plan-toolbar').getByRole('button', { name: 'Draw', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(exitButton(page)).toBeVisible();
  });

  test('one finger pans the plan, in the editor and in the summary', async ({ page }) => {
    await openMobile(page);
    await expectTouchPans(page);
    await finishEditing(page);
    await expectTouchPans(page);
  });

  test('Calculate in the top bar opens Results', async ({ page }) => {
    await openMobile(page);
    await addLampFromPreset(page);
    await page.locator('.menu-bar').getByRole('button', { name: /Calculate/ }).click();
    const results = page.locator('.mobile-tab-bar .mobile-tab', { hasText: 'Results' });
    await expect(results).toHaveClass(/active/, { timeout: 60_000 });
    await expect(page.locator('.mobile-panel.active').getByText('Average fluence')).toBeVisible({ timeout: 15_000 });
    await expect(view(page)).toBeHidden();

    // Back to Design: the same view, never remounted
    await page.locator('.mobile-tab-bar .mobile-tab', { hasText: 'Design' }).click();
    await expect(planSvg(page)).toBeVisible();
  });
});
