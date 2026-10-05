import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // No retries: a test that only passes on retry is a defect, not a pass (the
  // previous timeout ratchet accumulated unnoticed by absorbing flakes), and a
  // retry only doubled the time before CI went red.
  retries: 0,
  // Stop at the first failure on CI so a red run reports in minutes, not after
  // the whole suite; locally keep going to see everything.
  maxFailures: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: process.env.CI ? 'html' : 'list',

  // A timeout is a backstop against a hang, not a wait mechanism. Measured p100
  // over 3 repeats: every test except save-load lands in 2-11s, so 60s is >5x
  // headroom. save-load is the one genuine outlier and carries its own ceiling.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: `cd ../api && uv run ${process.env.CI ? '--no-sources' : ''} uvicorn app.main:app --port 8000`,
      port: 8000,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'cd ../ui && pnpm dev',
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
