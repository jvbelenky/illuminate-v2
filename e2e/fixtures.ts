import { test as base, expect } from '@playwright/test';
import { attachErrorGuard, type ErrorGuard } from './helpers/errors';

/**
 * Drop-in replacement for `@playwright/test`'s `test`, with page/console error
 * capture wired up automatically.
 *
 * Specs that create their own Page (e.g. the shared page in workflow.spec.ts)
 * should call `attachErrorGuard(page)` directly instead.
 */
export const test = base.extend<{ errorGuard: ErrorGuard; slowNetwork: void; downloadSaves: void }>({
  // Chromium's file pickers are native dialogs Playwright can't drive, so saves
  // and opens take the download / file-input path, as in Firefox and Safari.
  // A test can install its own pickers with a later addInitScript.
  downloadSaves: [
    async ({ page }, use) => {
      await page.addInitScript(() => {
        for (const name of ['showSaveFilePicker', 'showOpenFilePicker']) {
          Object.defineProperty(window, name, { value: undefined, configurable: true, writable: true });
        }
      });
      await use();
    },
    { auto: true },
  ],

  // Falsification harness. A wait is only deterministic if it survives a slower
  // app; one that merely happens to out-wait the app is indistinguishable from a
  // sleep. Run `E2E_SLOW_NETWORK=1 npx playwright test` to add 300ms to every API
  // call — if the suite still passes, the waits are genuinely condition-based.
  slowNetwork: [
    async ({ page }, use) => {
      if (process.env.E2E_SLOW_NETWORK) {
        await page.route('**/api/v1/**', async (route) => {
          await new Promise((r) => setTimeout(r, 300));
          await route.continue();
        });
      }
      await use();
    },
    { auto: true },
  ],

  errorGuard: [
    async ({ page }, use, testInfo) => {
      const guard = attachErrorGuard(page);
      await use(guard);
      // Only assert when the test otherwise passed — a captured console error
      // must not mask the real assertion failure.
      if (testInfo.status === testInfo.expectedStatus) guard.assertClean();
    },
    { auto: true },
  ],
});

export { expect };
