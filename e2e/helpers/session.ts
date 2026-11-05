import { type Page, expect } from '@playwright/test';
import { waitForApiIdle } from './network';

/**
 * Navigate to the app and wait for session initialization to actually finish.
 * Call this in beforeEach for every test.
 *
 * NOTE: the status bar becoming visible does NOT mean the session is
 * initialized — POST /session/init, GET /session/zones and GET
 * /session/state-hashes all fire *after* it appears. Returning at that point
 * left tests acting on a half-initialized session: save-load's file import
 * would apply, and then the in-flight init response (carrying the default room)
 * would land and silently overwrite it. So wait for the API to go quiet too.
 */
export async function waitForSession(page: Page, opts: { mainView?: 'chosen-2d' | 'default' } = {}): Promise<void> {
  // A fresh project shows the start chooser; tests drive the sidebar directly.
  // A fresh open shows 3D; most tests work on the plan, so they start as a user
  // who chose 2D (once, before any stored layout: a reload keeps what the test did).
  const seed2d = (opts.mainView ?? 'chosen-2d') === 'chosen-2d';
  await page.addInitScript((seed: boolean) => {
    const key = 'illuminate-settings';
    const s = JSON.parse(localStorage.getItem(key) || '{}');
    s.showStartChooser = false;
    if (seed && !s.workspaceDock) {
      s.workspaceDock = { left: ['editor', 'mini'], right: ['results'], minimized: [], main: '2d', mainChosen: true };
    }
    localStorage.setItem(key, JSON.stringify(s));
  }, seed2d);
  await page.goto('/');
  await waitForAppReady(page);
}

/**
 * Reload the page for a fresh project and wait for it to initialise.
 *
 * Only a reload clears the stored project: the app does that when it boots on a
 * 'reload' navigation, and restores the project on any other. So this must not
 * be followed by waitForSession, whose goto could land before the reloaded app
 * has booted and bring the old project back.
 */
export async function reloadSession(page: Page): Promise<void> {
  await page.reload();
  await waitForAppReady(page);
}

async function waitForAppReady(page: Page): Promise<void> {
  await expect(page.locator('.app-status-bar')).toBeVisible({ timeout: 15_000 });
  await waitForApiIdle(page);
}
