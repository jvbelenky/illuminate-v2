import { test, expect } from '../fixtures';
import { waitForSession } from '../helpers/session';
import { openStep, planSvg } from '../helpers/workspace';

test.describe('Smoke tests', () => {
  test('app loads, session initializes, UI renders', async ({ page }) => {
    await waitForSession(page);

    // Canvas renders
    await expect(page.locator('canvas')).toBeVisible();

    // A new project opens on the summary; the editor has the three stages, and the
    // 2D plan sits beside the 3D view
    await expect(page.locator('.summary-panel')).toBeVisible();
    await openStep(page, 'room', 'floorplan');
    for (const stage of ['room', 'lamps', 'zones']) {
      await expect(page.locator(`button.editor-stage[data-stage="${stage}"]`)).toBeVisible();
    }
    await expect(planSvg(page)).toBeVisible();

    // Status bar shows the version (the lamp/zone counts left it in 0.5.x)
    await expect(page.locator('.app-status-bar')).toContainText('illuminate v');
  });
});
