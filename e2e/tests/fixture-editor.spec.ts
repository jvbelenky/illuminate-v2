import { test, expect } from '../fixtures';
import { waitForSession } from '../helpers/session';
import { addLampWithType, createCustomLamp, openAdvancedSettings, selectAdvancedTab } from '../helpers/lamps';
import { getLampsFromStore } from '../helpers/api';
import path from 'path';

const IES_FIXTURE = path.resolve(__dirname, '../fixtures/test-lamp.ies');

test('fixture layout set on upload reaches the advanced tab and the backend', async ({ page }) => {
  await waitForSession(page);
  await addLampWithType(page, 'other');
  await createCustomLamp(page, { ies: IES_FIXTURE, wavelength: 280, face: 'front', offset: [0, 0, -0.02] });

  await expect.poll(async () => (await getLampsFromStore(page))[0].beam_face).toBe('front');
  const lamp = (await getLampsFromStore(page))[0];
  expect(lamp.emitter_offset).toEqual([0, 0, -0.02]);

  await openAdvancedSettings(page);
  await selectAdvancedTab(page, 'Lamp Fixture');
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog.locator('button[data-face="front"]')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  await expect(dialog.locator('#emitter-offset-z')).toHaveValue('-0.02');

  const saved = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().includes(`/session/lamps/${lamp.id}`)
      && r.request().postDataJSON()?.emitter_offset?.[0] === 0.05
  );
  const x = dialog.locator('#emitter-offset-x');
  await x.fill('0.05');
  await x.press('Tab');
  await saved;
  await expect.poll(async () => (await getLampsFromStore(page))[0].emitter_offset?.[0]).toBe(0.05);
});
