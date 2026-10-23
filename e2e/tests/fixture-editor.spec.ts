import { test, expect } from '../fixtures';
import { waitForSession } from '../helpers/session';
import { addLampWithType, createCustomLamp, openAdvancedSettings, openFixtureAdvanced, selectAdvancedTab } from '../helpers/lamps';
import { getLampsFromStore } from '../helpers/api';
import path from 'path';

const IES_FIXTURE = path.resolve(__dirname, '../fixtures/test-lamp.ies');

test('fixture layout set on upload reaches the advanced tab and the backend', async ({ page }) => {
  await waitForSession(page);
  await addLampWithType(page, 'other');
  // mounted by its front (+x) face, photometric center 2 cm from the mounting point
  await createCustomLamp(page, { ies: IES_FIXTURE, wavelength: 280, face: 'front', mountDistance: 0.02 });

  await expect.poll(async () => (await getLampsFromStore(page))[0].mount_face).toBe('front');
  const lamp = (await getLampsFromStore(page))[0];
  expect(lamp.emitter_offset[0]).toBeCloseTo(-0.02);

  await openAdvancedSettings(page);
  await selectAdvancedTab(page, 'Lamp Fixture');
  const dialog = page.locator('[role="dialog"]');
  await openFixtureAdvanced(dialog);
  await expect(dialog.locator('#mount-distance')).toHaveValue('0.02', { timeout: 15_000 });
  await expect(dialog.locator('button[data-face="front"]')).toHaveAttribute('aria-pressed', 'true');

  const saved = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().includes(`/session/lamps/${lamp.id}`)
      && Math.abs((r.request().postDataJSON()?.emitter_offset?.[0] ?? 0) + 0.05) < 1e-9
  );
  const distance = dialog.locator('#mount-distance');
  await distance.fill('0.05');
  await distance.press('Tab');
  await saved;
  await expect.poll(async () => (await getLampsFromStore(page))[0].emitter_offset?.[0]).toBeCloseTo(-0.05);
});
