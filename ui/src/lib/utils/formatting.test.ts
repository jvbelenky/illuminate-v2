/**
 * Tests for formatting utilities.
 */

import { describe, it, expect } from 'vitest';
import { formatValue, formatPercentage } from './formatting';

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

describe('formatPercentage', () => {
  it('returns dash for null', () => {
    expect(formatPercentage(null)).toBe('—');
  });

  it('returns dash for undefined', () => {
    expect(formatPercentage(undefined)).toBe('—');
  });

  it('formats zero correctly', () => {
    expect(formatPercentage(0)).toBe('0.0%');
  });

  it('formats 1 as 100%', () => {
    expect(formatPercentage(1)).toBe('100.0%');
  });

  it('formats decimal values correctly', () => {
    expect(formatPercentage(0.5)).toBe('50.0%');
    expect(formatPercentage(0.25)).toBe('25.0%');
    expect(formatPercentage(0.333)).toBe('33.3%');
  });

  it('formats values > 1 correctly', () => {
    expect(formatPercentage(1.5)).toBe('150.0%');
    expect(formatPercentage(2)).toBe('200.0%');
  });

  it('handles negative values', () => {
    expect(formatPercentage(-0.1)).toBe('-10.0%');
  });

  it('respects custom decimal places', () => {
    expect(formatPercentage(0.333, 0)).toBe('33%');
    expect(formatPercentage(0.333, 2)).toBe('33.30%');
    expect(formatPercentage(0.3333, 3)).toBe('33.330%');
  });
});
