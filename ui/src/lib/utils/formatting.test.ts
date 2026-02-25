/**
 * Tests for formatting utilities.
 */

import { describe, it, expect } from 'vitest';
import { formatValue, displayDimension } from './formatting';

describe('formatValue', () => {
  it('returns dash for null', () => {
    expect(formatValue(null)).toBe('—');
  });

  it('returns dash for undefined', () => {
    expect(formatValue(undefined)).toBe('—');
  });

  it('returns exponential notation for very small values', () => {
    expect(formatValue(0.001)).toBe('1.00e-3');
    expect(formatValue(0.0001)).toBe('1.00e-4');
    expect(formatValue(0.00999)).toBe('9.99e-3');
  });

  it('uses extra precision for small values < 1', () => {
    expect(formatValue(0.01)).toBe('0.010');
    expect(formatValue(0.5)).toBe('0.500');
    expect(formatValue(0.999)).toBe('0.999');
  });

  it('uses default decimals for values < 100', () => {
    expect(formatValue(1)).toBe('1.00');
    expect(formatValue(50.5)).toBe('50.50');
    expect(formatValue(99.99)).toBe('99.99');
  });

  it('uses 1 decimal for large values >= 100', () => {
    expect(formatValue(100)).toBe('100.0');
    expect(formatValue(1000)).toBe('1000.0');
    expect(formatValue(999.99)).toBe('1000.0'); // Rounds
  });

  it('handles zero', () => {
    expect(formatValue(0)).toBe('0.00');
    expect(formatValue(0, 1)).toBe('0.0');
    expect(formatValue(0, 3)).toBe('0.000');
  });

  it('handles negative values', () => {
    expect(formatValue(-0.001)).toBe('-1.00e-3');
    expect(formatValue(-0.5)).toBe('-0.500');
    expect(formatValue(-50)).toBe('-50.00');
    expect(formatValue(-500)).toBe('-500.0');
  });

  it('respects custom decimal places for values < 1', () => {
    // For values < 1, always uses at least 3 decimals
    expect(formatValue(0.5, 1)).toBe('0.500');
    expect(formatValue(0.5, 4)).toBe('0.5000');
  });

  it('respects custom decimal places for medium values', () => {
    expect(formatValue(50, 4)).toBe('50.0000');
    expect(formatValue(50, 0)).toBe('50');
  });
});

describe('displayDimension', () => {
  it('shows at least minDecimals', () => {
    expect(displayDimension(3, 1)).toBe('3.0');
    expect(displayDimension(3, 2)).toBe('3.00');
  });

  it('preserves extra precision beyond minDecimals', () => {
    expect(displayDimension(2.54, 1)).toBe('2.54');
    expect(displayDimension(2.541, 1)).toBe('2.541');
    expect(displayDimension(0.005, 1)).toBe('0.005');
  });

  it('does not add unnecessary decimals', () => {
    expect(displayDimension(2.5, 1)).toBe('2.5');
    expect(displayDimension(10, 1)).toBe('10.0');
  });

  it('handles zero', () => {
    expect(displayDimension(0, 1)).toBe('0.0');
    expect(displayDimension(0, 2)).toBe('0.00');
  });

  it('handles negative values', () => {
    expect(displayDimension(-2.54, 1)).toBe('-2.54');
    expect(displayDimension(-3, 1)).toBe('-3.0');
  });
});
