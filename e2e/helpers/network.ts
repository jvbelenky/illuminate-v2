import { type Page } from '@playwright/test';

/**
 * Waits until the app has stopped talking to the API.
 *
 * Replaces fixed sleeps that were hand-tuned to outlast the app's debounce
 * timers. A single UI action fans out into a *chain* of requests rather than
 * one, so waiting on any single response is not enough. Clicking a placement
 * preset, for example, does:
 *
 *   POST /lamps/{id}/place  ->  response updates the editor's inputs
 *                           ->  LampEditor's 100ms debounced effect fires
 *                           ->  PATCH /lamps/{id}
 *                           ->  state-hash fetch debounced 300ms (project.ts)
 *                           ->  GET /session/state-hashes
 *
 * so we wait for in-flight requests to drain AND for a quiet window long enough
 * to cover the longest API-triggering debounce in the app.
 *
 * QUIET_MS must stay greater than STATE_HASH_FETCH_DEBOUNCE_MS (300) in
 * ui/src/lib/stores/project.ts — the longest debounce that ends in a request.
 * (AUTOSAVE_DELAY_MS is 1000 but only writes sessionStorage, so it is not
 * relevant here.) If that constant changes, change this one.
 */
const QUIET_MS = 500;

type Tracker = { inFlight: number; lastActivity: number };
const trackers = new WeakMap<Page, Tracker>();

const isApi = (url: string) => url.includes('/api/v1/');

function trackerFor(page: Page): Tracker {
  const existing = trackers.get(page);
  if (existing) return existing;

  const t: Tracker = { inFlight: 0, lastActivity: Date.now() };
  trackers.set(page, t);

  page.on('request', (r) => {
    if (!isApi(r.url())) return;
    t.inFlight++;
    t.lastActivity = Date.now();
  });
  const settle = (r: { url(): string }) => {
    if (!isApi(r.url())) return;
    t.inFlight = Math.max(0, t.inFlight - 1);
    t.lastActivity = Date.now();
  };
  page.on('requestfinished', settle);
  page.on('requestfailed', settle);

  return t;
}

export async function waitForApiIdle(
  page: Page,
  { quietMs = QUIET_MS, timeout = 15_000 }: { quietMs?: number; timeout?: number } = {}
): Promise<void> {
  const t = trackerFor(page);
  const deadline = Date.now() + timeout;

  for (;;) {
    if (t.inFlight === 0 && Date.now() - t.lastActivity >= quietMs) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `API never went idle within ${timeout}ms (inFlight=${t.inFlight}, ` +
          `${Date.now() - t.lastActivity}ms since last activity)`
      );
    }
    await page.waitForTimeout(25); // poll interval, not a settling delay
  }
}
