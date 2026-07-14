import { test, expect } from '../fixtures';

test.describe('Mobile layout', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('app renders at mobile viewport', async ({ page, errorGuard }) => {
    // KNOWN PRE-EXISTING BUG (not caused by this suite; reproduces on main).
    // @threlte/extras <Grid> reads `material.uniforms.worldCamProjPosition` in a
    // useTask that can run before the mesh's ShaderMaterial is initialised, so
    // `material.uniforms` is undefined and the task throws. Only reproduces at
    // this viewport. Remove this allowance once the Grid mount race is fixed.
    errorGuard.allow(/worldCamProjPosition/);

    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 15_000 });
  });
});
