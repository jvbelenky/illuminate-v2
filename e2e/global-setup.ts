import { chromium, type FullConfig } from '@playwright/test';

/**
 * Warm the Vite dev server before any test runs.
 *
 * A freshly started dev server compiles the app's module graph (and optimises
 * dependencies) on the first page load. On a busy machine that took longer than
 * waitForSession's 15s, so the first test of each worker (ceiling.spec.ts and
 * fixture-editor.spec.ts, alphabetically) failed at page load whichever commit
 * was checked out. Loading the app once here, with a generous ceiling, means
 * every test meets a warm server. The web servers are up before this runs.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0].use.baseURL;
  if (!baseURL) return;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      const key = 'illuminate-settings';
      const s = JSON.parse(localStorage.getItem(key) || '{}');
      s.showStartChooser = false;
      localStorage.setItem(key, JSON.stringify(s));
    });
    await page.goto(baseURL, { timeout: 120_000 });
    await page.locator('.app-status-bar').waitFor({ state: 'visible', timeout: 120_000 });
  } finally {
    await browser.close();
  }
}
