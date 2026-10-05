import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

type Listener = (e: { matches: boolean }) => void;

function installMatchMedia(initialMatches: boolean) {
  const listeners = new Set<Listener>();
  const mql = {
    matches: initialMatches,
    media: '(max-width: 767px)',
    addEventListener: (_: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
  };
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql));
  return {
    setMatches(v: boolean) {
      mql.matches = v;
      listeners.forEach((fn) => fn({ matches: v }));
    },
  };
}

describe('isMobile', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('is false when the viewport is wider than the mobile breakpoint', async () => {
    installMatchMedia(false);
    const { isMobile } = await import('./viewport');
    expect(get(isMobile)).toBe(false);
  });

  it('is true on a narrow viewport and follows changes', async () => {
    const mm = installMatchMedia(true);
    const { isMobile } = await import('./viewport');
    const seen: boolean[] = [];
    const unsub = isMobile.subscribe((v) => seen.push(v));
    expect(seen).toEqual([true]);
    mm.setMatches(false);
    expect(seen).toEqual([true, false]);
    unsub();
  });

  it('is false when matchMedia is unavailable (SSR, old browsers)', async () => {
    vi.stubGlobal('matchMedia', undefined);
    const { isMobile } = await import('./viewport');
    expect(get(isMobile)).toBe(false);
  });
});
