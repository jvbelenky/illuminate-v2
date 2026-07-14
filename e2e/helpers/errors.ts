import { type Page } from '@playwright/test';

/**
 * Captures page errors and console errors so they fail the test instead of
 * disappearing.
 *
 * The app routes every sync failure through `syncErrors.add()`, which renders a
 * toast rather than rethrowing (see the 12 catch sites in stores/project.ts).
 * A schema validation throw therefore leaves the store without backend state
 * while the page keeps running, so a test waiting on that state spins until its
 * timeout and reports as a slow/flaky test rather than as the error it is.
 */

/** Never treated as failures — noise the app doesn't control. */
const ALWAYS_IGNORED: RegExp[] = [/favicon/i];

/**
 * KNOWN PRE-EXISTING BUG — surfaced by this error capture, not caused by it.
 *
 * A zone's type cannot be changed in place (the backend uses distinct CalcPlane
 * / CalcVol / CalcPoint classes), so `syncUpdateZone` DELETEs the zone and ADDs
 * a replacement with a new id (ui/src/lib/stores/project.ts:676-695). While that
 * round-trip is in flight, ZoneEditor's 100ms debounced save re-arms against the
 * OLD id and fires, yielding:
 *
 *   [http 404] PATCH /session/zones/CalcPlane-N   — zone already deleted
 *   [http 400] PATCH /session/zones/CalcVol       — plane fields sent to a volume
 *
 * Both are swallowed into toasts by the app's sync error handling, which is why
 * they went unnoticed. Adding latency widens the window and makes it reproduce
 * far more reliably (`E2E_SLOW_NETWORK=1`), so users on slow connections will hit
 * this routinely — the pending edit is silently dropped.
 *
 * Fix: suppress editor saves while a type change is in flight, then delete this.
 */
export const ZONE_TYPE_SWITCH_BUG: RegExp[] = [
  /PATCH \/session\/zones\//,
  /Failed to load resource/,
];

export type ErrorGuard = {
  /** Un-allowed errors recorded so far. */
  errors(): string[];
  /** Suppress matching errors. Applied retroactively, so it may be called after the fact. */
  allow(...patterns: (RegExp | string)[]): void;
  /** Throw if any un-allowed errors were recorded, then clear the buffer. */
  assertClean(): void;
  /** Clear the buffer without asserting. */
  drain(): string[];
};

export function attachErrorGuard(page: Page): ErrorGuard {
  const recorded: string[] = [];
  const allowed: (RegExp | string)[] = [...ALWAYS_IGNORED];

  const isAllowed = (msg: string) =>
    allowed.some((p) => (typeof p === 'string' ? msg.includes(p) : p.test(msg)));

  page.on('pageerror', (err) => {
    recorded.push(`[pageerror] ${err.message}`);
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') recorded.push(`[console.error] ${msg.text()}`);
  });

  // A failed API call is a defect unless a test explicitly says otherwise. The
  // app funnels these into toasts, so without this they are invisible to tests.
  page.on('response', (res) => {
    if (res.status() < 400) return;
    if (!res.url().includes('/api/v1/')) return;
    const path = res.url().split('/api/v1')[1] ?? res.url();
    recorded.push(`[http ${res.status()}] ${res.request().method()} ${path}`);
  });

  const current = () => recorded.filter((m) => !isAllowed(m));

  return {
    errors: current,
    allow: (...patterns) => allowed.push(...patterns),
    drain: () => {
      const out = current();
      recorded.length = 0;
      return out;
    },
    assertClean: () => {
      const found = current();
      recorded.length = 0;
      if (found.length === 0) return;
      throw new Error(
        `Page reported ${found.length} error(s) the test did not expect:\n` +
          found.map((e) => `  - ${e}`).join('\n')
      );
    },
  };
}
