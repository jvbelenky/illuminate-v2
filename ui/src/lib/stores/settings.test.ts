/**
 * Tests for the user settings store's unit handling: the persisted unit
 * strings are validated on load so an unknown value can never reach the API.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

const STORAGE_KEY = 'illuminate-settings';

describe('settings store units', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('defaults to meters for both live and default units', async () => {
    const { userSettings } = await import('./settings');
    const s = get(userSettings);
    expect(s.units).toBe('meters');
    expect(s.defaultUnits).toBe('meters');
  });

  it('keeps every supported unit from localStorage', async () => {
    for (const u of ['centimeters', 'millimeters', 'feet', 'inches'] as const) {
      vi.resetModules();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ units: u, defaultUnits: u }));
      const { userSettings } = await import('./settings');
      expect(get(userSettings).units).toBe(u);
      expect(get(userSettings).defaultUnits).toBe(u);
    }
  });

  it('falls back to meters for an unknown stored unit', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ units: 'yards', defaultUnits: 'furlongs' }));
    const { userSettings } = await import('./settings');
    expect(get(userSettings).units).toBe('meters');
    expect(get(userSettings).defaultUnits).toBe('meters');
  });

  it('backfills defaultUnits from units for settings saved before it existed', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ units: 'inches' }));
    const { userSettings } = await import('./settings');
    expect(get(userSettings).defaultUnits).toBe('inches');
  });
});
