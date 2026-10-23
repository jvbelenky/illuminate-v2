import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { openStep } from '../helpers/workspace';
import { addLampFromPreset, lampCount } from '../helpers/lamps';
import { calculate } from '../helpers/calculations';

/** Open the eye safety plane's plot window. */
async function openEyePlot(page: Page) {
  // Expand the section only when it is collapsed (its toggle reads "▶ Photobiological Safety")
  const section = page.getByRole('button', { name: /photobiological safety/i });
  await expect(section).toBeVisible();
  if ((await section.textContent())?.includes('▶')) await section.click();
  await page.getByRole('button', { name: 'Show Plot', exact: true }).last().click();
  const panel = page.locator('.side-panel');
  await expect(panel).toBeVisible();
  return panel;
}

const modalBox = (page: Page) => page.locator('.modal-content').last().boundingBox();

test.describe('Plot settings', () => {
  test('a plane plot switches views at one window size, and its settings save with the project', async ({ page }) => {
    await waitForSession(page);
    await addLampFromPreset(page);
    await page.locator('.editor-row.open .close-x').click();
    await calculate(page);

    let panel = await openEyePlot(page);
    const before = await modalBox(page);

    await panel.getByRole('button', { name: 'Contours', exact: true }).click();
    // A percentage preset steps up to the room's own ICNIRP limit in as many levels
    await panel.getByLabel('Level preset').selectOption('pct-icnirp');
    await expect(panel.getByLabel(/^Level \d+$/)).toHaveCount(4);
    await expect(panel.getByLabel('Name for level 4')).toHaveValue('100% ICNIRP');
    await panel.getByLabel('Level preset').selectOption('limits');
    await expect(panel.getByLabel(/^Level \d+$/)).toHaveCount(3);
    await panel.getByRole('button', { name: '+ Add level' }).click();
    await expect(panel.getByLabel(/^Level \d+$/)).toHaveCount(4);
    await page.locator('.modal-footer').getByLabel('Values', { exact: true }).check();

    // Same window whatever the view or the number of levels
    expect(await modalBox(page)).toEqual(before);

    await panel.getByRole('button', { name: 'Contours', exact: true }).click();
    await page.keyboard.press('Escape');

    const fileMenu = page.locator('.menu-bar-item').filter({ hasText: 'File' }).locator('span[role="button"]');
    await fileMenu.click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'Save', exact: true }).click(),
    ]);
    const filePath = await download.path();

    // Change the view, so only the file can bring the contours back
    panel = await openEyePlot(page);
    await panel.getByRole('button', { name: 'Heatmap', exact: true }).click();
    await expect(panel.getByLabel(/^Level \d+$/)).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.locator('input#load-file').setInputFiles(filePath!);
    await expect.poll(() => lampCount(page), { timeout: 15_000 }).toBe(1);
    await calculate(page);

    panel = await openEyePlot(page);
    await expect(panel.getByRole('button', { name: 'Contours', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByLabel(/^Level \d+$/)).toHaveCount(4);
    await expect(page.locator('.modal-footer').getByLabel('Values', { exact: true })).toBeChecked();
  });

  test('the title switches the window between zones, listed by name', async ({ page }) => {
    await waitForSession(page);
    await addLampFromPreset(page);
    await page.locator('.editor-row.open .close-x').click();
    await calculate(page);

    await openEyePlot(page);
    const zoneSelect = page.getByRole('combobox', { name: 'Zone' });
    await expect(zoneSelect).toHaveValue('EyeLimits');
    const names = await zoneSelect.locator('option').allTextContents();
    expect(names).not.toContain('EyeLimits');
    expect(names.length).toBeGreaterThanOrEqual(3);
    const before = await modalBox(page);

    // To the whole-room volume and back to a plane, in the same window
    await zoneSelect.selectOption('WholeRoomFluence');
    await expect(page.getByRole('combobox', { name: 'Zone' })).toHaveValue('WholeRoomFluence');
    await expect(page.locator('.side-panel').getByLabel(/^Level \d+$/).first()).toBeVisible();
    expect((await modalBox(page))?.width).toBe(before?.width);
    await page.getByRole('combobox', { name: 'Zone' }).selectOption('SkinLimits');
    await expect(page.getByRole('combobox', { name: 'Zone' })).toHaveValue('SkinLimits');
    await expect(page.locator('.modal-content')).toHaveCount(1);
  });

  test('dragging a contour line sets its level to the value under the pointer', async ({ page }) => {
    await waitForSession(page);
    await addLampFromPreset(page);
    await page.locator('.editor-row.open .close-x').click();
    await calculate(page);

    const panel = await openEyePlot(page);
    await panel.getByRole('button', { name: 'Contours', exact: true }).click();
    const levels = panel.getByLabel(/^Level \d+$/);
    const before = await levels.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

    // Find a point on a line: hovering one shows the grab cursor
    const canvas = page.locator('.plot-area canvas');
    const box = (await canvas.boundingBox())!;
    let start: { x: number; y: number } | null = null;
    for (let fy = 0.1; fy < 0.95 && !start; fy += 0.02) {
      for (let fx = 0.1; fx < 0.7 && !start; fx += 0.02) {
        const x = box.x + box.width * fx;
        const y = box.y + box.height * fy;
        await page.mouse.move(x, y);
        if ((await canvas.evaluate((c) => (c as HTMLCanvasElement).style.cursor)) === 'grab') start = { x, y };
      }
    }
    expect(start).not.toBeNull();

    await page.mouse.down();
    await page.mouse.move(start!.x + 25, start!.y + 25, { steps: 5 });
    await page.mouse.up();

    // One level moved, and the list is now typed-in levels, still sorted
    const after = await levels.evaluateAll((els) => els.map((e) => Number((e as HTMLInputElement).value)));
    expect(after.map(String)).not.toEqual(before);
    expect(after).toEqual([...after].sort((a, b) => a - b));
    await expect(panel.getByLabel('Level preset')).toHaveValue('custom');
  });

  test('Export All sends each plane drawn as its plot window shows it', async ({ page }) => {
    await waitForSession(page);
    await addLampFromPreset(page);
    await page.locator('.editor-row.open .close-x').click();
    await calculate(page);

    const panel = await openEyePlot(page);
    await panel.getByRole('button', { name: 'Contours', exact: true }).click();
    await panel.getByLabel('Level preset').selectOption('limits');
    await panel.getByLabel('Title').fill('Office 3, eye level');
    await panel.getByLabel('Title').press('Tab');
    await page.keyboard.press('Escape');

    await page.getByText(/export results/i).first().click();
    await page.getByText('Include plots').click();
    const [request] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/session/export') && r.method() === 'POST'),
      page.getByRole('button', { name: 'Export All (ZIP)' }).click(),
    ]);
    const body = request.postDataJSON();
    expect(body.include_plots).toBe(true);
    const eye = body.plot_styles.EyeLimits;
    expect(eye.view).toBe('contours');
    expect(eye.title).toBe('Office 3, eye level');
    expect(eye.labels).toEqual(expect.arrayContaining(['ICNIRP', 'ACGIH Eye']));
    expect(eye.levels).toHaveLength(eye.labels.length);
    // Every plane goes with contour levels, so the zip has its contour plot beside its heatmap
    expect(body.plot_styles.SkinLimits.view).toBe('heatmap');
    expect(body.plot_styles.SkinLimits.levels.length).toBeGreaterThan(0);
  });

  test('a plane displayed as contours goes to the report as contours, plot window opened or not', async ({ page }) => {
    await waitForSession(page);
    await addLampFromPreset(page);
    await page.locator('.editor-row.open .close-x').click();
    await calculate(page);

    // Contours from the zone editor's Display, not the plot window
    await openStep(page, 'zones');
    await page.locator('.zones-part .editor-row[data-id="EyeLimits"] .row-main').click();
    await page.locator('.editor-row.open .row-body button.zone-type-btn').filter({ hasText: 'Contours' }).click();
    await page.locator('.editor-row.open .close-x').click();

    let body: { plot_styles?: Record<string, { view: string; levels: number[] }> } | null = null;
    await page.route('**/session/report/pdf', async (route) => {
      body = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4' });
    });
    await page.getByRole('button', { name: 'Generate Report' }).click();
    await page.getByRole('button', { name: 'Generate PDF' }).click();
    await expect.poll(() => body, { timeout: 60_000 }).not.toBeNull();
    const eye = body!.plot_styles?.EyeLimits;
    expect(eye?.view).toBe('contours');
    expect(eye?.levels.length).toBeGreaterThan(0);

    // And the plot window agrees
    await page.locator('.modal-content').filter({ hasText: 'Generate PDF' }).getByRole('button', { name: 'Close', exact: true }).last().click();
    const panel = await openEyePlot(page);
    await expect(panel.getByRole('button', { name: 'Contours', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });
});
