/**
 * Tests for theme store.
 *
 * Note: These tests focus on the store's reactive behavior.
 * The initial theme is determined at module load time from localStorage,
 * which makes testing initialization complex with dynamic imports.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

describe('theme store', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe('store operations', () => {
    it('can get current theme', async () => {
      const { theme } = await import('./theme');
      const current = get(theme);
      expect(['light', 'dark']).toContain(current);
    });

    it('toggle switches between light and dark', async () => {
      const { theme } = await import('./theme');
      const initial = get(theme);

      theme.toggle();
      const afterFirst = get(theme);
      expect(afterFirst).not.toBe(initial);

      theme.toggle();
      const afterSecond = get(theme);
      expect(afterSecond).toBe(initial);
    });

    it('set changes theme to specified value', async () => {
      const { theme } = await import('./theme');

      theme.set('light');
      expect(get(theme)).toBe('light');

      theme.set('dark');
      expect(get(theme)).toBe('dark');
    });

    it('notifies subscribers on toggle', async () => {
      const { theme } = await import('./theme');
      const values: string[] = [];

      const unsubscribe = theme.subscribe((value) => {
        values.push(value);
      });

      theme.toggle();
      theme.toggle();

      unsubscribe();

      // Should have initial value + 2 toggles
      expect(values.length).toBeGreaterThanOrEqual(3);
    });

    it('notifies subscribers on set', async () => {
      const { theme } = await import('./theme');
      const values: string[] = [];

      const unsubscribe = theme.subscribe((value) => {
        values.push(value);
      });

      theme.set('light');
      theme.set('dark');

      unsubscribe();

      expect(values).toContain('light');
      expect(values).toContain('dark');
    });

    it('init can be called without error', async () => {
      const { theme } = await import('./theme');

      expect(() => theme.init()).not.toThrow();
    });
  });

  describe('Theme type', () => {
    it('exports Theme type', async () => {
      const { theme } = await import('./theme');
      const value = get(theme);

      // Theme should be 'light' or 'dark'
      expect(value === 'light' || value === 'dark').toBe(true);
    });
  });
});
