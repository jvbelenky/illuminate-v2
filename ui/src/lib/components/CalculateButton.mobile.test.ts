import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const { isMobileStore, userSettingsStore, needsCalcStore, resultsStore, performCalculation } = vi.hoisted(() => {
  function createStore<T>(initial: T) {
    let value = initial;
    const subs = new Set<(v: T) => void>();
    return {
      subscribe(fn: (v: T) => void) {
        fn(value);
        subs.add(fn);
        return () => subs.delete(fn);
      },
      set(v: T) {
        value = v;
        subs.forEach((fn) => fn(value));
      },
      update(fn: (v: T) => T) {
        this.set(fn(value));
      },
    };
  }
  return {
    isMobileStore: createStore<boolean>(false),
    userSettingsStore: createStore<{ autoRecalculate: boolean }>({ autoRecalculate: true }),
    needsCalcStore: createStore<boolean>(true),
    resultsStore: createStore<null>(null),
    performCalculation: vi.fn().mockResolvedValue({ success: true }),
  };
});

vi.mock('$lib/stores/viewport', () => ({ isMobile: isMobileStore }));
vi.mock('$lib/stores/settings', () => ({ userSettings: userSettingsStore }));
vi.mock('$lib/stores/project', () => ({ needsCalculation: needsCalcStore, results: resultsStore }));
vi.mock('$lib/utils/calculate', () => ({ performCalculation }));

import CalculateButton from './CalculateButton.svelte';

describe('CalculateButton on mobile', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    performCalculation.mockClear();
    userSettingsStore.set({ autoRecalculate: true });
    needsCalcStore.set(true);
  });
  afterEach(() => vi.useRealTimers());

  it('hides the autorecalculate checkbox on a mobile viewport', () => {
    isMobileStore.set(true);
    render(CalculateButton);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('never auto-calculates on a mobile viewport, even with the preference on', async () => {
    isMobileStore.set(true);
    render(CalculateButton);
    await vi.advanceTimersByTimeAsync(2000);
    expect(performCalculation).not.toHaveBeenCalled();
  });

  it('keeps the checkbox and auto-calculation on a desktop viewport', async () => {
    isMobileStore.set(false);
    render(CalculateButton);
    expect(screen.getByRole('checkbox')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(2000);
    expect(performCalculation).toHaveBeenCalled();
  });
});
