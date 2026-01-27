/**
 * Tests for SyncErrorToast component.
 *
 * These tests focus on the syncErrors store which the toast displays.
 * Full component rendering tests with Svelte 5 require additional setup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

describe('SyncErrorToast integration', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  describe('syncErrors store', () => {
    it('starts with empty errors', async () => {
      const { syncErrors } = await import('$lib/stores/project');

      let errors: unknown[] = [];
      const unsubscribe = syncErrors.subscribe((e) => { errors = e; });

      expect(errors).toHaveLength(0);

      unsubscribe();
    });

    it('adds errors with proper structure', async () => {
      const { syncErrors } = await import('$lib/stores/project');

      let errors: { id: string; message: string; operation: string; timestamp: number }[] = [];
      const unsubscribe = syncErrors.subscribe((e) => { errors = e; });

      syncErrors.add('Test operation', new Error('Test error'));

      expect(errors).toHaveLength(1);
      expect(errors[0].operation).toBe('Test operation');
      expect(errors[0].message).toBe('Test error');
      expect(errors[0].id).toBeDefined();
      expect(errors[0].timestamp).toBeGreaterThan(0);

      unsubscribe();
    });

    it('handles string errors', async () => {
      const { syncErrors } = await import('$lib/stores/project');

      let errors: { message: string }[] = [];
      const unsubscribe = syncErrors.subscribe((e) => { errors = e; });

      syncErrors.add('Test', 'String error message');

      expect(errors[0].message).toBe('String error message');

      unsubscribe();
    });

    it('dismisses error by ID', async () => {
      const { syncErrors } = await import('$lib/stores/project');

      let errors: { id: string }[] = [];
      const unsubscribe = syncErrors.subscribe((e) => { errors = e; });

      syncErrors.add('Op1', new Error('Error 1'));
      syncErrors.add('Op2', new Error('Error 2'));

      expect(errors).toHaveLength(2);

      const firstId = errors[0].id;
      syncErrors.dismiss(firstId);

      expect(errors).toHaveLength(1);
      expect(errors.find(e => e.id === firstId)).toBeUndefined();

      unsubscribe();
    });

    it('clears all errors', async () => {
      const { syncErrors } = await import('$lib/stores/project');

      let errors: unknown[] = [];
      const unsubscribe = syncErrors.subscribe((e) => { errors = e; });

      syncErrors.add('Op1', new Error('Error 1'));
      syncErrors.add('Op2', new Error('Error 2'));
      syncErrors.add('Op3', new Error('Error 3'));

      expect(errors).toHaveLength(3);

      syncErrors.clear();

      expect(errors).toHaveLength(0);

      unsubscribe();
    });

    it('assigns unique IDs to each error', async () => {
      const { syncErrors } = await import('$lib/stores/project');

      let errors: { id: string }[] = [];
      const unsubscribe = syncErrors.subscribe((e) => { errors = e; });

      syncErrors.add('Op1', new Error('Error 1'));
      syncErrors.add('Op2', new Error('Error 2'));

      const ids = errors.map(e => e.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);

      unsubscribe();
    });

    it('preserves order of errors', async () => {
      const { syncErrors } = await import('$lib/stores/project');

      let errors: { operation: string }[] = [];
      const unsubscribe = syncErrors.subscribe((e) => { errors = e; });

      syncErrors.add('First', new Error('1'));
      syncErrors.add('Second', new Error('2'));
      syncErrors.add('Third', new Error('3'));

      expect(errors[0].operation).toBe('First');
      expect(errors[1].operation).toBe('Second');
      expect(errors[2].operation).toBe('Third');

      unsubscribe();
    });
  });

  describe('toast display conditions', () => {
    it('toast should display when errors exist', async () => {
      const { syncErrors } = await import('$lib/stores/project');

      let errors: unknown[] = [];
      const unsubscribe = syncErrors.subscribe((e) => { errors = e; });

      // Component would show when errors.length > 0
      expect(errors.length > 0).toBe(false);

      syncErrors.add('Test', new Error('test'));

      expect(errors.length > 0).toBe(true);

      unsubscribe();
    });

    it('toast should hide when all errors dismissed', async () => {
      const { syncErrors } = await import('$lib/stores/project');

      let errors: { id: string }[] = [];
      const unsubscribe = syncErrors.subscribe((e) => { errors = e; });

      syncErrors.add('Test', new Error('test'));
      expect(errors.length).toBe(1);

      syncErrors.dismiss(errors[0].id);
      expect(errors.length).toBe(0);

      unsubscribe();
    });
  });
});
