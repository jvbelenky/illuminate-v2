/**
 * Tests for export utilities.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateZoneCSV } from './export';
import type { ZoneResult } from '$lib/types/project';

// Helper to create a minimal ZoneResult for testing
function createZoneResult(values: number[][] | number[][][] | undefined, stats?: { min: number; max: number; mean: number }): ZoneResult {
  return {
    zone_id: 'zone-1',
    zone_type: 'plane',
    statistics: stats ?? { min: 0, max: 0, mean: 0 },
    values: values as number[][],
  };
}

describe('generateZoneCSV', () => {
  it('returns empty string for null values', () => {
    const result = createZoneResult(undefined, { min: 0, max: 10, mean: 5 });
    expect(generateZoneCSV(result)).toBe('');
  });

  it('handles 1D array', () => {
    const result = createZoneResult([1, 2, 3] as unknown as number[][], { min: 1, max: 3, mean: 2 });
    expect(generateZoneCSV(result)).toBe('1\n2\n3');
  });

  it('handles 2D array (plane)', () => {
    const result = createZoneResult([
      [1, 2, 3],
      [4, 5, 6],
    ], { min: 1, max: 6, mean: 3.5 });
    expect(generateZoneCSV(result)).toBe('1,2,3\n4,5,6');
  });

  it('handles 3D array (volume)', () => {
    const result = createZoneResult([
      [[1, 2], [3, 4]],
      [[5, 6], [7, 8]],
      [[9, 10], [11, 12]],
    ], { min: 1, max: 12, mean: 6.5 });

    const csv = generateZoneCSV(result);
    const expected = '1,2\n3,4\n\n5,6\n7,8\n\n9,10\n11,12';
    expect(csv).toBe(expected);
  });

  it('handles decimal values', () => {
    const result = createZoneResult([
      [0.1, 0.2, 0.3],
      [0.7, 0.8, 0.9],
    ], { min: 0.1, max: 0.9, mean: 0.5 });
    expect(generateZoneCSV(result)).toBe('0.1,0.2,0.3\n0.7,0.8,0.9');
  });

  it('handles single row', () => {
    const result = createZoneResult([[1, 2, 3, 4, 5]], { min: 1, max: 5, mean: 3 });
    expect(generateZoneCSV(result)).toBe('1,2,3,4,5');
  });

  it('handles single cell', () => {
    const result = createZoneResult([[42]], { min: 42, max: 42, mean: 42 });
    expect(generateZoneCSV(result)).toBe('42');
  });

  it('handles empty 2D array', () => {
    const result = createZoneResult([], { min: 0, max: 0, mean: 0 });
    expect(generateZoneCSV(result)).toBe('');
  });

  it('handles 3D array with single plane', () => {
    const result = createZoneResult([[[1, 2], [3, 4]]], { min: 1, max: 4, mean: 2.5 });
    expect(generateZoneCSV(result)).toBe('1,2\n3,4');
  });
});
