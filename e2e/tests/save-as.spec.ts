import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { waitForSession } from '../helpers/session';
import { addLampFromPreset, lampCount } from '../helpers/lamps';

async function fileMenu(page: Page, item: string) {
  await page.locator('.menu-bar-item').filter({ hasText: 'File' }).locator('span[role="button"]').click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

const projectName = (page: Page) => page.locator('.menu-title-name').first();

/** Lamps in a saved .guv text. */
function savedLampCount(text: string): number {
  const rooms = JSON.parse(text).data.rooms as Record<string, { lamps: Record<string, unknown> }>;
  return Object.values(rooms).reduce((n, room) => n + Object.keys(room.lamps).length, 0);
}

test.describe('Save As', () => {
  test('without the File System Access API, Save As asks for a name and downloads under it', async ({ page }) => {
    await waitForSession(page);

    await fileMenu(page, 'Save As...');
    const nameInput = page.getByLabel('File name');
    await expect(nameInput).toHaveValue(await projectName(page).innerText());
    await nameInput.fill('lab-3-final');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Save', exact: true }).click(),
    ]);

    expect(download.suggestedFilename()).toBe('lab-3-final.guv');
    await expect(projectName(page)).toHaveText('lab-3-final');
    await expect(nameInput).toHaveCount(0);
  });

  test('with the File System Access API, Save writes back to the file that Save As or Open chose', async ({ page }) => {
    // Fake pickers backed by an in-page "disk", installed after the fixture removes the real ones
    await page.addInitScript(() => {
      const w = window as unknown as { __files: Record<string, string>; __pickerCalls: string[] };
      w.__files = {};
      w.__pickerCalls = [];
      const handle = (name: string) => ({
        kind: 'file',
        name,
        queryPermission: async () => 'granted',
        requestPermission: async () => 'granted',
        createWritable: async () => {
          let buffer = '';
          return {
            write: async (data: string) => { buffer += data; },
            close: async () => { w.__files[name] = buffer; },
          };
        },
        getFile: async () => new File([w.__files[name] ?? ''], name),
      });
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true, writable: true,
        value: async (options?: { suggestedName?: string }) => {
          w.__pickerCalls.push(`save:${options?.suggestedName}`);
          return handle('lab-a.guv');
        },
      });
      Object.defineProperty(window, 'showOpenFilePicker', {
        configurable: true, writable: true,
        value: async () => { w.__pickerCalls.push('open'); return [handle('lab-a.guv')]; },
      });
    });
    const disk = () => page.evaluate(() => (window as unknown as { __files: Record<string, string> }).__files);
    const pickerCalls = () => page.evaluate(() => (window as unknown as { __pickerCalls: string[] }).__pickerCalls);
    await waitForSession(page);
    const startName = await projectName(page).innerText();

    // Save with no file yet asks where to save, via the keyboard shortcut
    await page.keyboard.press('Control+s');
    await expect.poll(async () => Object.keys(await disk())).toEqual(['lab-a.guv']);
    expect(await pickerCalls()).toEqual([`save:${startName}.guv`]);
    expect(savedLampCount((await disk())['lab-a.guv'])).toBe(0);
    await expect(projectName(page)).toHaveText('lab-a');
    await expect(page).toHaveTitle(/^lab-a\.guv/);

    // Save again overwrites the same file without asking
    await addLampFromPreset(page);
    await page.locator('.inline-editor .close-x').click();
    await fileMenu(page, 'Save');
    await expect.poll(async () => savedLampCount((await disk())['lab-a.guv'])).toBe(1);
    expect(await pickerCalls()).toEqual([`save:${startName}.guv`]);

    // Open reads the file back and keeps it as the save target
    await fileMenu(page, 'Open...');
    await expect.poll(() => lampCount(page), { timeout: 15_000 }).toBe(1);
    expect(await pickerCalls()).toEqual([`save:${startName}.guv`, 'open']);
    await expect(page).toHaveTitle(/^lab-a\.guv/);
  });
});
