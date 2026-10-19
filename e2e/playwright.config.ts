import { execFileSync } from 'node:child_process';
import { defineConfig, devices } from '@playwright/test';

// Per-checkout ports, so each worktree runs (or reuses) its own servers rather
// than another checkout's. API_PORT / UI_PORT override; see scripts/dev-ports.sh.
const port = (which: 'api' | 'ui') =>
  Number(execFileSync('bash', ['../scripts/dev-ports.sh', which], { encoding: 'utf8' }).trim());
const API_PORT = port('api');
const UI_PORT = port('ui');

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
    baseURL: `http://localhost:${UI_PORT}`,
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
      command: `cd ../api && ../scripts/guv-calcs.sh exec uv run uvicorn app.main:app --port ${API_PORT}`,
      port: API_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `cd ../ui && VITE_API_URL=http://localhost:${API_PORT}/api/v1 pnpm dev --port ${UI_PORT} --strictPort`,
      port: UI_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
