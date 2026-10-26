import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { openStep, planSvg } from '../helpers/workspace';

/** The open ceiling item's X and Y (detectors, vents and sensors). */
async function itemXY(page: Page): Promise<[number, number]> {
  const row = page.locator('.ceiling-part .editor-row.open');
  return [Number(await row.getByLabel('X', { exact: true }).inputValue()), Number(await row.getByLabel('Y', { exact: true }).inputValue())];
}

test.describe('Ceiling designer', () => {
  test('a detector and a keep-out area are added, the detector dragged, and both come back from the saved file', async ({ page }) => {
    await waitForSession(page);
    await openStep(page, 'room', 'ceiling');
    const part = page.locator('.ceiling-part');

    await part.getByRole('button', { name: 'Detector', exact: true }).click();
    await expect(part.locator('.editor-row[data-id="ceiling-1"]')).toHaveClass(/open/);
    const before = await itemXY(page);

    // Drag the detector across the plan: it lands in the middle of another tile
    const detector = planSvg(page).getByRole('button', { name: 'Smoke detector 1' });
    const box = (await detector.boundingBox())!;
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy - 40, { steps: 6 });
    await page.mouse.move(cx + 90, cy - 70, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await itemXY(page))[0]).toBeGreaterThan(before[0]);
    const moved = await itemXY(page);
    expect(moved[1]).toBeGreaterThan(before[1]);

    await part.getByRole('button', { name: 'Keep-out', exact: true }).click();
    await expect(part.locator('.editor-row[data-id="ceiling-2"]')).toHaveClass(/open/);
    await expect(part.getByLabel('Width', { exact: true })).toHaveValue('1.2');
    await expect(planSvg(page).getByRole('button', { name: 'Corner 1', exact: true })).toBeVisible();

    const fileMenu = page.locator('.menu-bar-item').filter({ hasText: 'File' }).locator('span[role="button"]');
    await fileMenu.click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'Save', exact: true }).click(),
    ]);
    const filePath = await download.path();

    // A fresh page starts with an empty ceiling; only the file brings the items back
    await page.reload();
    await waitForSession(page);
    await openStep(page, 'room', 'ceiling');
    await expect(part.locator('.editor-row')).toHaveCount(0);

    await page.locator('input#load-file').setInputFiles(filePath!);
    await expect(part.locator('.editor-row')).toHaveCount(2, { timeout: 15_000 });
    await expect(part.locator('.editor-row[data-id="ceiling-1"]')).toContainText('Smoke detector 1');
    await expect(part.locator('.editor-row[data-id="ceiling-2"]')).toContainText('Keep-out area 1');
    await part.locator('.editor-row[data-id="ceiling-1"] .row-main').click();
    expect(await itemXY(page)).toEqual(moved);
    await expect(planSvg(page).getByRole('button', { name: 'Keep-out area 1' })).toBeVisible();
  });
});
