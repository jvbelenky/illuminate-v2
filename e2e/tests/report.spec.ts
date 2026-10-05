import { test, expect } from '../fixtures';
import { waitForSession } from '../helpers/session';
import { addLampFromPreset } from '../helpers/lamps';
import { calculate } from '../helpers/calculations';

test.describe('PDF report', () => {
  test('generates and downloads a PDF from the Results panel', async ({ page }) => {
    // Calculate (standard zones at default resolution) + WeasyPrint render: measured
    // well under a minute locally; headroom for CI.
    test.setTimeout(120_000);
    await waitForSession(page);
    await addLampFromPreset(page);
    await page.locator('.inline-editor .close-x').click();
    await calculate(page);
    // Standard zones only: the Summary's occupancy card is the sign results are in
    await expect(page.getByTestId('occupancy-banner')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Generate Report' }).first().click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Generate report' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Title').fill('E2E room');
    await dialog.getByLabel('Client or site').fill('Playwright');
    await dialog.getByRole('radio', { name: 'Headline isometric' }).check({ force: true });

    const download = page.waitForEvent('download', { timeout: 90_000 });
    await dialog.getByRole('button', { name: 'Generate PDF' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('E2E_room_report.pdf');
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const buf = Buffer.concat(chunks);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(50_000);
  });
});
