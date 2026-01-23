/**
 * Formatting utilities for displaying values in the UI.
 */

/**
 * Format a numeric value with appropriate precision.
 * Uses exponential notation for very small values and limits decimal places for larger values.
 */
export function formatValue(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return '—';
  if (Math.abs(value) < 0.01) return value.toExponential(2);
  if (Math.abs(value) < 1) return value.toFixed(Math.max(decimals, 3));
  if (Math.abs(value) < 100) return value.toFixed(decimals);
  return value.toFixed(1);
}

/**
 * Format a number as a percentage string.
 */
export function formatPercentage(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined) return '—';
  return `${(value * 100).toFixed(decimals)}%`;
}
