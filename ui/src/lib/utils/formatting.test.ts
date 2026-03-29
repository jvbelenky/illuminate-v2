/**
 * Tests for formatting utilities.
 */

import { describe, it, expect } from 'vitest';
import { formatValue, displayDimension, formatFloat, cleanFloat } from './formatting';

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
  it('rounds to exactly the specified decimals', () => {
    expect(displayDimension(3, 1)).toBe('3.0');
    expect(displayDimension(3, 2)).toBe('3.00');
  });

  it('rounds conversion artifacts to specified decimals', () => {
    expect(displayDimension(3.6576, 1)).toBe('3.7');
    expect(displayDimension(2.54, 1)).toBe('2.5');
    expect(displayDimension(6.096, 1)).toBe('6.1');
  });

  it('respects higher precision settings', () => {
    expect(displayDimension(3.6576, 2)).toBe('3.66');
    expect(displayDimension(3.6576, 3)).toBe('3.658');
  });

  it('pads to specified decimals', () => {
    expect(displayDimension(2.5, 1)).toBe('2.5');
    expect(displayDimension(10, 1)).toBe('10.0');
    expect(displayDimension(10, 2)).toBe('10.00');
  });

  it('handles zero', () => {
    expect(displayDimension(0, 1)).toBe('0.0');
    expect(displayDimension(0, 2)).toBe('0.00');
  });

  it('handles negative values', () => {
    expect(displayDimension(-2.54, 1)).toBe('-2.5');
    expect(displayDimension(-3, 1)).toBe('-3.0');
  });
});

describe('formatFloat', () => {
  it('pads to minimum decimal places', () => {
    expect(formatFloat(0.5, 2)).toBe('0.50');
    expect(formatFloat(2, 2)).toBe('2.00');
    expect(formatFloat(10, 1)).toBe('10.0');
  });

  it('preserves additional meaningful digits', () => {
    expect(formatFloat(0.50234, 2)).toBe('0.50234');
    expect(formatFloat(3.14159, 1)).toBe('3.14159');
  });

  it('strips floating-point noise', () => {
    expect(formatFloat(1.9999999999, 2)).toBe('2.00');
    expect(formatFloat(0.30000000000000004, 2)).toBe('0.30');
  });

  it('handles zero', () => {
    expect(formatFloat(0, 2)).toBe('0.00');
  });

  it('handles integers', () => {
    expect(formatFloat(5, 2)).toBe('5.00');
  });
});

describe('cleanFloat', () => {
  it('strips float noise', () => {
    expect(cleanFloat(1.9999999999)).toBe(2);
    expect(cleanFloat(0.30000000000000004)).toBe(0.3);
  });

  it('preserves meaningful precision', () => {
    expect(cleanFloat(0.50234)).toBe(0.50234);
    expect(cleanFloat(3.14159265)).toBe(3.14159265);
  });

  it('handles zero and special values', () => {
    expect(cleanFloat(0)).toBe(0);
    expect(cleanFloat(Infinity)).toBe(Infinity);
    expect(cleanFloat(-Infinity)).toBe(-Infinity);
  });
});
